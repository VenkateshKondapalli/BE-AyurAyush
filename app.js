const dotenv = require("dotenv");
dotenv.config();

const required = [
    "MONGO_DB_URL",
    "JWT_SECRET",
    "GEMINI_AI_API_KEY",
    "RESEND_MAILER_API_KEY",
];

required.forEach((key) => {
    if (!process.env[key]) {
        console.error(`Missing required env var: ${key}`);
        process.exit(1);
    }
});

const logger = require("./utils/logger");
const { csrfOriginCheckMiddleware } = require("./utils/csrfProtection");

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

app.use(
    cors({
        origin: [
            process.env.FRONTEND_URL_LOCAL,
            process.env.FRONTEND_URL_VERCEL,
            process.env.FRONTEND_URL_CUSTOM_DOMAIN,
        ],
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

app.use(express.json()); // body-parser in json format

app.use(cookieParser());

app.get("/", (req, res) => {
    res.send("<h1>Server is running ...</h1>");
});

// Apply stricter rate limit to auth & OTP endpoints
// app.use("/api/v1/auth", authLimiter);
// app.use("/api/v1/otps", authLimiter);

app.use("/api/v1", csrfOriginCheckMiddleware, apiRouter);

// Centralized error handler — must be after all routes
app.use(errorHandler);

app.listen(process.env.PORT, () => {
    logger.info("Server started", { port: process.env.PORT });
});
