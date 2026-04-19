const dotenv = require("dotenv");
dotenv.config();

const required = [
    "MONGO_DB_URL",
    "JWT_SECRET",
    "RESEND_MAILER_API_KEY",
    "RAZORPAY_WEBHOOK_SECRET",
];

required.forEach((key) => {
    if (!process.env[key]) {
        console.error(`Missing required env var: ${key}`);
        process.exit(1);
    }
});

const hasGemini = Boolean(
    process.env.GEMINI_AI_API_KEY || process.env.GEMINI_AI_API_KEYS,
);
const hasGroq = Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS);

if (!hasGemini && !hasGroq) {
    console.error(
        "Missing AI provider keys: set GEMINI_AI_API_KEY(S) and/or GROQ_API_KEY(S)",
    );
    process.exit(1);
}

const logger = require("./utils/logger");
const { csrfOriginCheckMiddleware } = require("./utils/csrfProtection");
const { startChatRetentionJob } = require("./utils/chatRetentionJob");

const { apiRouter } = require("./api/v1/routes");
const { errorHandler } = require("./api/v1/errorHandler");

if (process.env.NODE_ENV != "production") {
    const dns = require("dns");
    dns.setServers([process.env.DNS_SERVER, process.env.DNS_ALTERNATE_SERVER]);
}

require("./config/db.js");

const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const app = express();

const { webhookController } = require("./api/v1/payments/controllers");

const configuredFrontendOrigins = [
    process.env.FRONTEND_URL_LOCAL,
    process.env.FRONTEND_URL_VERCEL,
    process.env.FRONTEND_URL_CUSTOM_DOMAIN,
].filter(Boolean);

const localhostDevOriginPattern = /^http:\/\/localhost:\d+$/;

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow same-origin/non-browser tools where Origin may be undefined.
            if (!origin) return callback(null, true);

            const isConfigured = configuredFrontendOrigins.includes(origin);
            const isLocalDev = localhostDevOriginPattern.test(origin);

            if (isConfigured || isLocalDev) {
                return callback(null, true);
            }

            return callback(new Error(`CORS blocked for origin: ${origin}`));
        },
        credentials: true,
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    }),
);

// Global rate limiter — 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        isSuccess: false,
        message: "Too many requests, please try again later.",
    },
});

// Stricter limiter for auth/OTP routes — 10 requests per 15 minutes per IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        isSuccess: false,
        message: "Too many authentication attempts, please try again later.",
    },
});

// app.use(globalLimiter);

app.use(morgan("dev"));

// Webhook route must use raw payload before any JSON body parsing.
app.post(
    "/api/v1/payments/webhook",
    express.raw({ type: "application/json" }),
    (req, res, next) => {
        req.rawBody = req.body.toString("utf8");
        next();
    },
    webhookController,
);

app.use(express.json()); // body-parser in json format

app.use(cookieParser());

app.get("/", (req, res) => {
    res.send("<h1>Server is running ...</h1>");
});

// Apply stricter rate limit to auth & OTP endpoints
// app.use("/api/v1/auth", authLimiter);
// app.use("/api/v1/otps", authLimiter);

// Payments routes (excluding webhook, already mounted above)
const { paymentsRouter } = require("./api/v1/payments/routes");
app.use("/api/v1/payments", paymentsRouter);

app.use("/api/v1", csrfOriginCheckMiddleware, apiRouter);

// Centralized error handler — must be after all routes
app.use(errorHandler);

app.listen(process.env.PORT, () => {
    logger.info("Server started", { port: process.env.PORT });
    startChatRetentionJob();
});
