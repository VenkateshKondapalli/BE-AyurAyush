const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validatePatientRole,
    validateIsAdminMiddleware,
} = require("../middlewares");
const {
    createPaymentOrderController,
    verifyPaymentController,
    getPaymentStatusController,
    webhookController,
    initiateRefundController,
    getRevenueDashboardController,
    getAllTransactionsController,
    syncRefundStatusesController,
} = require("./controllers");

const paymentsRouter = express.Router();

// ─── Webhook (MUST be before express.json — needs raw body) ─────────────────
// Raw body middleware captures exact bytes for HMAC-SHA256 signature verification
paymentsRouter.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    (req, res, next) => {
        // Attach rawBody as string for the webhook handler
        req.rawBody = req.body.toString("utf8");
        next();
    },
    webhookController,
);

// ─── Patient Routes ──────────────────────────────────────────────────────────

// Create Razorpay order for an appointment
paymentsRouter.post(
    "/create-order",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    createPaymentOrderController,
);

// Verify payment after Razorpay checkout completes
paymentsRouter.post(
    "/verify",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    verifyPaymentController,
);

// Get payment status for a specific appointment
paymentsRouter.get(
    "/status/:appointmentId",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    getPaymentStatusController,
);

// ─── Admin Routes ────────────────────────────────────────────────────────────

// Revenue dashboard with summary, charts, and breakdowns
paymentsRouter.get(
    "/admin/revenue",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    getRevenueDashboardController,
);

// All transactions (paginated, filterable)
paymentsRouter.get(
    "/admin/transactions",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    getAllTransactionsController,
);

// Initiate refund for an appointment
paymentsRouter.post(
    "/admin/refund/:appointmentId",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    initiateRefundController,
);

// Sync refund statuses from Razorpay
paymentsRouter.post(
    "/admin/sync-refunds",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    syncRefundStatusesController,
);

module.exports = { paymentsRouter };
