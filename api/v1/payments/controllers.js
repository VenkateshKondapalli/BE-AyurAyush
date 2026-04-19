const {
    createPaymentOrder,
    verifyPayment,
    handleWebhook,
    getPaymentStatus,
    initiateRefund,
    getRevenueDashboard,
    getAllTransactions,
    syncRefundStatuses,
} = require("./services");
const logger = require("../../../utils/logger");

// ─── Patient Controllers ─────────────────────────────────────────────────────

const createPaymentOrderController = async (req, res, next) => {
    try {
        const patientUserId = req.currentUser.userId;
        const { appointmentId } = req.body;

        if (!appointmentId) {
            return res.status(400).json({
                isSuccess: false,
                message: "appointmentId is required",
            });
        }

        const data = await createPaymentOrder(patientUserId, appointmentId);
        return res.status(201).json({ isSuccess: true, data });
    } catch (err) {
        next(err);
    }
};

const verifyPaymentController = async (req, res, next) => {
    try {
        const patientUserId = req.currentUser.userId;
        const {
            appointmentId,
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
        } = req.body;

        if (
            !appointmentId ||
            !razorpayOrderId ||
            !razorpayPaymentId ||
            !razorpaySignature
        ) {
            return res.status(400).json({
                isSuccess: false,
                message:
                    "appointmentId, razorpayOrderId, razorpayPaymentId and razorpaySignature are required",
            });
        }

        const data = await verifyPayment(patientUserId, {
            appointmentId,
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
        });

        return res.status(200).json({ isSuccess: true, data });
    } catch (err) {
        next(err);
    }
};

const getPaymentStatusController = async (req, res, next) => {
    try {
        const patientUserId = req.currentUser.userId;
        const { appointmentId } = req.params;

        const data = await getPaymentStatus(patientUserId, appointmentId);
        return res.status(200).json({ isSuccess: true, data });
    } catch (err) {
        next(err);
    }
};

// ─── Webhook Controller (no auth — uses signature verification) ──────────────

const webhookController = async (req, res) => {
    try {
        const signature = req.headers["x-razorpay-signature"];

        if (!signature) {
            logger.warn("Webhook received without signature header");
            return res
                .status(400)
                .json({ isSuccess: false, message: "Missing signature" });
        }

        // rawBody is set by the raw body middleware in routes.js
        const rawBody = req.rawBody;
        if (!rawBody) {
            return res
                .status(400)
                .json({ isSuccess: false, message: "Empty body" });
        }

        await handleWebhook(rawBody, signature);
        logger.info("Webhook processed successfully");
        return res.status(200).json({ received: true });
    } catch (err) {
        logger.error("Webhook processing failed", {
            statusCode: err.statusCode || 500,
            message: err.message,
        });
        // Always return 200 to Razorpay — any non-200 causes retries and eventual webhook disabling
        return res.status(200).json({ received: false });
    }
};

// ─── Admin Controllers ───────────────────────────────────────────────────────

const initiateRefundController = async (req, res, next) => {
    try {
        const adminUserId = req.currentUser.userId;
        const { appointmentId } = req.params;
        const { reason } = req.body;

        const data = await initiateRefund(adminUserId, appointmentId, reason);
        return res.status(200).json({ isSuccess: true, data });
    } catch (err) {
        next(err);
    }
};

const getRevenueDashboardController = async (req, res, next) => {
    try {
        const data = await getRevenueDashboard(req.query);
        return res.status(200).json({ isSuccess: true, data });
    } catch (err) {
        next(err);
    }
};

const getAllTransactionsController = async (req, res, next) => {
    try {
        const data = await getAllTransactions(req.query);
        return res.status(200).json({ isSuccess: true, data });
    } catch (err) {
        next(err);
    }
};

const syncRefundStatusesController = async (req, res, next) => {
    try {
        const data = await syncRefundStatuses();
        return res.status(200).json({
            isSuccess: true,
            message: `Synced ${data.synced} refund(s) and ${data.methodsSynced} payment method(s) from Razorpay.`,
            data,
        });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    createPaymentOrderController,
    verifyPaymentController,
    getPaymentStatusController,
    webhookController,
    initiateRefundController,
    getRevenueDashboardController,
    getAllTransactionsController,
    syncRefundStatusesController,
};
