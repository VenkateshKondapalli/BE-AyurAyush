const crypto = require("crypto");
const { razorpay } = require("../../../utils/razorpayInstance");
const { PaymentModel } = require("../../../models/paymentSchema");
const { AppointmentModel } = require("../../../models/appointmentSchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { UserModel } = require("../../../models/userSchema");
const { getISTDayBounds } = require("../../../utils/helpers");
const logger = require("../../../utils/logger");

const PLATFORM_FEE_PERCENT = 10; // 10% platform fee on top of consultation fee

// ─── Helpers ────────────────────────────────────────────────────────────────

const toINR = (paise) => Number((paise / 100).toFixed(2));
const toPaise = (inr) => Math.round(Number(inr) * 100);

const verifyRazorpaySignature = (orderId, paymentId, signature) => {
    const body = `${orderId}|${paymentId}`;
    const expected = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest("hex");
    return crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(signature, "hex"),
    );
};

const verifyWebhookSignature = (rawBody, signature) => {
    const expected = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");
    return crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(signature, "hex"),
    );
};

// ─── Patient: Create Razorpay Order ─────────────────────────────────────────

const createPaymentOrder = async (patientUserId, appointmentId) => {
    // 1. Verify appointment belongs to this patient and is confirmed
    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        patientId: patientUserId,
    });

    if (!appointment) {
        const err = new Error("Appointment not found");
        err.statusCode = 404;
        throw err;
    }

    if (![ "pending_payment", "confirmed"].includes(appointment.status)) {
        const err = new Error(
            "Payment can only be made for pending or confirmed appointments",
        );
        err.statusCode = 400;
        throw err;
    }

    // 2. Check if already paid
    const existingPayment = await PaymentModel.findOne({ appointmentId });
    if (existingPayment?.status === "paid") {
        const err = new Error("This appointment has already been paid for");
        err.statusCode = 409;
        throw err;
    }

    // 3. Get consultation fee from doctor profile — amount always server-side
    const doctor = await DoctorModel.findOne({ userId: appointment.doctorId });
    if (!doctor || !doctor.consultationFee) {
        const err = new Error(
            "Doctor consultation fee not set. Please contact admin.",
        );
        err.statusCode = 400;
        throw err;
    }

    const consultationFeeINR = Number(doctor.consultationFee);
    const platformFeeINR = Number(
        ((consultationFeeINR * PLATFORM_FEE_PERCENT) / 100).toFixed(2),
    );
    const totalAmountINR = Number(
        (consultationFeeINR + platformFeeINR).toFixed(2),
    );
    const totalAmountPaise = toPaise(totalAmountINR);

    // 4. Fetch patient and doctor names for Razorpay notes
    const [patientUser, doctorUser] = await Promise.all([
        UserModel.findById(patientUserId).select("name email phone"),
        UserModel.findById(appointment.doctorId).select("name"),
    ]);

    // 5. Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
        amount: totalAmountPaise,
        currency: "INR",
        receipt: `apt_${appointmentId.toString().slice(-8)}`,
        notes: {
            appointmentId: appointmentId.toString(),
            patientName: patientUser?.name || "",
            patientEmail: patientUser?.email || "",
            doctorName: doctorUser?.name || "",
            consultationFee: consultationFeeINR,
            platformFee: platformFeeINR,
        },
    });

    // 6. Upsert payment record — if order existed before (e.g. retry), replace it
    await PaymentModel.findOneAndUpdate(
        { appointmentId },
        {
            appointmentId,
            patientId: patientUserId,
            doctorId: appointment.doctorId,
            razorpayOrderId: razorpayOrder.id,
            amount: totalAmountPaise,
            currency: "INR",
            status: "created",
            notes: razorpayOrder.notes,
            razorpayPaymentId: null,
            razorpaySignature: null,
            paidAt: null,
            failedAt: null,
            failureReason: "",
        },
        { upsert: true, new: true },
    );

    logger.info("Payment order created", {
        appointmentId,
        orderId: razorpayOrder.id,
        amount: totalAmountPaise,
    });

    return {
        orderId: razorpayOrder.id,
        amount: totalAmountPaise,
        amountINR: totalAmountINR,
        currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID,
        appointmentId,
        breakdown: {
            consultationFee: consultationFeeINR,
            platformFee: platformFeeINR,
            total: totalAmountINR,
        },
        prefill: {
            name: patientUser?.name || "",
            email: patientUser?.email || "",
            contact: patientUser?.phone || "",
        },
    };
};

// ─── Patient: Verify Payment After Checkout ──────────────────────────────────

const verifyPayment = async (
    patientUserId,
    { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature },
) => {
    // 1. Find the payment record
    const payment = await PaymentModel.findOne({
        appointmentId,
        patientId: patientUserId,
        razorpayOrderId,
    });

    if (!payment) {
        const err = new Error("Payment record not found");
        err.statusCode = 404;
        throw err;
    }

    if (payment.status === "paid") {
        return { alreadyPaid: true, appointmentId };
    }

    // 2. Cryptographic signature verification — the core security check
    let isValid = false;
    try {
        isValid = verifyRazorpaySignature(
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
        );
    } catch {
        isValid = false;
    }

    if (!isValid) {
        // Mark as failed and log the tamper attempt
        payment.status = "failed";
        payment.failedAt = new Date();
        payment.failureReason = "Signature verification failed — possible tamper attempt";
        await payment.save();

        logger.warn("Payment signature verification failed", {
            appointmentId,
            razorpayOrderId,
            patientUserId,
        });

        const err = new Error("Payment verification failed. Please contact support.");
        err.statusCode = 400;
        throw err;
    }

    // 3. Mark payment as paid and transition appointment to pending_admin_approval
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    payment.status = "paid";
    payment.paidAt = new Date();
    await payment.save();

    // Transition appointment from pending_payment → pending_admin_approval
    await AppointmentModel.findOneAndUpdate(
        { _id: payment.appointmentId, status: "pending_payment" },
        { $set: { status: "pending_admin_approval" } },
    );

    logger.info("Payment verified — appointment moved to pending_admin_approval", {
        appointmentId,
        razorpayPaymentId,
        amount: toINR(payment.amount),
    });

    return {
        alreadyPaid: false,
        appointmentId,
        paymentId: razorpayPaymentId,
        amount: toINR(payment.amount),
    };
};

// ─── Webhook Handler (Razorpay → Server) ─────────────────────────────────────

const handleWebhook = async (rawBody, signature) => {
    // 1. Verify webhook authenticity
    let isValid = false;
    try {
        isValid = verifyWebhookSignature(rawBody, signature);
    } catch {
        isValid = false;
    }

    if (!isValid) {
        logger.warn("Webhook signature verification failed");
        const err = new Error("Invalid webhook signature");
        err.statusCode = 400;
        throw err;
    }

    const event = JSON.parse(rawBody);
    const eventName = event.event;
    const payloadEntity = event.payload?.payment?.entity || event.payload?.refund?.entity;

    logger.info("Webhook received", { event: eventName });

    // 2. Route by event type
    if (eventName === "payment.captured") {
        await handlePaymentCaptured(event, payloadEntity);
    } else if (eventName === "payment.failed") {
        await handlePaymentFailed(event, payloadEntity);
    } else if (eventName === "refund.created") {
        await handleRefundCreated(event, payloadEntity);
    } else if (eventName === "refund.processed") {
        await handleRefundProcessed(event, payloadEntity);
    }

    return { received: true };
};

const handlePaymentCaptured = async (event, entity) => {
    const orderId = entity?.order_id;
    if (!orderId) return;

    const payment = await PaymentModel.findOne({ razorpayOrderId: orderId });
    if (!payment) return;

    // Idempotency — skip if already processed
    if (payment.status === "paid") {
        logger.info("Webhook: payment already marked paid, skipping", { orderId });
        return;
    }

    payment.razorpayPaymentId = entity.id;
    payment.status = "paid";
    payment.paidAt = new Date(entity.created_at * 1000);
    payment.method = entity.method || null;
    payment.webhookEvents.push({
        event: event.event,
        receivedAt: new Date(),
        payload: { id: entity.id, order_id: orderId, method: entity.method },
    });
    await payment.save();

    // Backup: transition appointment pending_payment → pending_admin_approval
    await AppointmentModel.findOneAndUpdate(
        { _id: payment.appointmentId, status: "pending_payment" },
        { $set: { status: "pending_admin_approval" } },
    );

    logger.info("Webhook: payment captured", {
        orderId,
        paymentId: entity.id,
    });
};

const handlePaymentFailed = async (event, entity) => {
    const orderId = entity?.order_id;
    if (!orderId) return;

    const payment = await PaymentModel.findOne({ razorpayOrderId: orderId });
    if (!payment || payment.status === "paid") return;

    payment.status = "failed";
    payment.failedAt = new Date();
    payment.failureReason =
        entity?.error_description || entity?.error_code || "Payment failed";
    payment.webhookEvents.push({
        event: event.event,
        receivedAt: new Date(),
        payload: {
            id: entity.id,
            order_id: orderId,
            error_code: entity.error_code,
            error_description: entity.error_description,
        },
    });
    await payment.save();

    logger.info("Webhook: payment failed", { orderId });
};

const handleRefundCreated = async (event, entity) => {
    if (!entity?.payment_id) return;

    const payment = await PaymentModel.findOne({
        razorpayPaymentId: entity.payment_id,
    });
    if (!payment) return;

    payment.refundId = entity.id;
    payment.refundAmount = entity.amount;
    payment.refundStatus = "initiated";
    payment.refundInitiatedAt = new Date();
    payment.webhookEvents.push({
        event: event.event,
        receivedAt: new Date(),
        payload: { refundId: entity.id, amount: entity.amount },
    });
    await payment.save();

    logger.info("Webhook: refund created", { refundId: entity.id });
};

const handleRefundProcessed = async (event, entity) => {
    if (!entity?.payment_id) return;

    const payment = await PaymentModel.findOne({
        razorpayPaymentId: entity.payment_id,
    });
    if (!payment) return;

    payment.status = "refunded";
    payment.refundStatus = "processed";
    payment.refundProcessedAt = new Date();
    payment.webhookEvents.push({
        event: event.event,
        receivedAt: new Date(),
        payload: { refundId: entity.id, amount: entity.amount },
    });
    await payment.save();

    logger.info("Webhook: refund processed", { refundId: entity.id });
};

// ─── Patient: Get Payment Status for an Appointment ─────────────────────────

const getPaymentStatus = async (patientUserId, appointmentId) => {
    const payment = await PaymentModel.findOne({
        appointmentId,
        patientId: patientUserId,
    }).select("-webhookEvents -razorpaySignature -notes");

    if (!payment) {
        return { hasPaid: false, payment: null };
    }

    return {
        hasPaid: payment.status === "paid",
        payment: {
            status: payment.status,
            amount: toINR(payment.amount),
            currency: payment.currency,
            method: payment.method,
            paidAt: payment.paidAt,
            refundStatus: payment.refundStatus,
            refundAmount: payment.refundAmount
                ? toINR(payment.refundAmount)
                : null,
        },
    };
};

// ─── Admin: Initiate Refund ──────────────────────────────────────────────────

const initiateRefund = async (adminUserId, appointmentId, reason) => {
    const payment = await PaymentModel.findOne({ appointmentId });

    if (!payment) {
        const err = new Error("No payment found for this appointment");
        err.statusCode = 404;
        throw err;
    }

    if (payment.status !== "paid") {
        const err = new Error("Only paid appointments can be refunded");
        err.statusCode = 400;
        throw err;
    }

    if (payment.refundStatus === "initiated" || payment.refundStatus === "processed") {
        const err = new Error("Refund already initiated for this payment");
        err.statusCode = 409;
        throw err;
    }

    // Call Razorpay refund API
    const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
        amount: payment.amount, // full refund
        notes: {
            reason: reason || "Refund initiated by admin",
            appointmentId: appointmentId.toString(),
            adminId: adminUserId.toString(),
        },
    });

    payment.refundId = refund.id;
    payment.refundAmount = refund.amount;
    payment.refundStatus = "initiated";
    payment.refundReason = reason || "Refund initiated by admin";
    payment.refundInitiatedAt = new Date();
    await payment.save();

    logger.info("Refund initiated by admin", {
        appointmentId,
        refundId: refund.id,
        adminUserId,
    });

    return {
        refundId: refund.id,
        amount: toINR(refund.amount),
        status: refund.status,
    };
};

// ─── Admin: Sync Refund Statuses from Razorpay ─────────────────────────────

const syncRefundStatuses = async () => {
    // Sync refund statuses
    const pendingRefunds = await PaymentModel.find({
        refundStatus: "initiated",
        refundId: { $ne: null },
    }).select("refundId refundStatus refundAmount appointmentId");

    let synced = 0;
    for (const payment of pendingRefunds) {
        try {
            const refund = await razorpay.refunds.fetch(payment.refundId);
            if (refund.status === "processed") {
                payment.refundStatus = "processed";
                payment.status = "refunded";
                payment.refundProcessedAt = new Date(refund.created_at * 1000);
                await payment.save();
                synced++;
                logger.info("Refund status synced to processed", { refundId: payment.refundId });
            }
        } catch (err) {
            logger.warn("Failed to fetch refund status from Razorpay", { refundId: payment.refundId, error: err.message });
        }
    }

    // Sync missing payment method for paid payments
    const missingMethod = await PaymentModel.find({
        status: "paid",
        razorpayPaymentId: { $ne: null },
        $or: [{ method: null }, { method: { $exists: false } }],
    }).select("razorpayPaymentId method");

    let methodsSynced = 0;
    for (const payment of missingMethod) {
        try {
            const rzpPayment = await razorpay.payments.fetch(payment.razorpayPaymentId);
            if (rzpPayment.method) {
                payment.method = rzpPayment.method;
                await payment.save();
                methodsSynced++;
                logger.info("Payment method synced", { paymentId: payment.razorpayPaymentId, method: rzpPayment.method });
            }
        } catch (err) {
            logger.warn("Failed to fetch payment method from Razorpay", { paymentId: payment.razorpayPaymentId, error: err.message });
        }
    }

    return { synced, total: pendingRefunds.length, methodsSynced };
};

// ─── Admin: Revenue Dashboard ────────────────────────────────────────────────

const getRevenueDashboard = async (query = {}) => {
    const { from, to, doctorId } = query;

    // Build date range filter
    const dateFilter = {};
    if (from || to) {
        dateFilter.paidAt = {};
        if (from) dateFilter.paidAt.$gte = new Date(from);
        if (to) {
            const toDate = new Date(to);
            toDate.setHours(23, 59, 59, 999);
            dateFilter.paidAt.$lte = toDate;
        }
    }

    const baseFilter = { status: "paid", ...dateFilter };
    if (doctorId) baseFilter.doctorId = doctorId;

    const { start: todayStart, end: todayEnd } = getISTDayBounds();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Run all aggregations in parallel
    const [
        allTimePaid,
        todayPaid,
        thisMonthPaid,
        refundedPayments,
        recentTransactions,
        revenueByDoctor,
        revenueByMethod,
        dailyRevenueLast30,
    ] = await Promise.all([
        // All-time total revenue
        PaymentModel.aggregate([
            { $match: baseFilter },
            { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),

        // Today's revenue
        PaymentModel.aggregate([
            { $match: { status: "paid", paidAt: { $gte: todayStart, $lte: todayEnd } } },
            { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),

        // This month's revenue
        PaymentModel.aggregate([
            { $match: { status: "paid", paidAt: { $gte: monthStart } } },
            { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),

        // Total refunded
        PaymentModel.aggregate([
            { $match: { refundStatus: { $in: ["initiated", "processed"] }, ...dateFilter } },
            { $group: { _id: null, total: { $sum: "$refundAmount" }, count: { $sum: 1 } } },
        ]),

        // Recent 20 transactions
        PaymentModel.find(baseFilter)
            .sort({ paidAt: -1 })
            .limit(20)
            .populate("patientId", "name email")
            .populate("doctorId", "name")
            .populate("appointmentId", "date timeSlot")
            .select("-webhookEvents -razorpaySignature"),

        // Revenue grouped by doctor
        PaymentModel.aggregate([
            { $match: baseFilter },
            {
                $group: {
                    _id: "$doctorId",
                    totalRevenue: { $sum: "$amount" },
                    transactionCount: { $sum: 1 },
                },
            },
            { $sort: { totalRevenue: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "doctor",
                },
            },
            { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    doctorId: "$_id",
                    doctorName: "$doctor.name",
                    totalRevenue: 1,
                    transactionCount: 1,
                },
            },
        ]),

        // Revenue by payment method
        PaymentModel.aggregate([
            { $match: baseFilter },
            {
                $group: {
                    _id: "$method",
                    total: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
            { $sort: { total: -1 } },
        ]),

        // Daily revenue for last 30 days
        PaymentModel.aggregate([
            {
                $match: {
                    status: "paid",
                    paidAt: {
                        $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                    },
                },
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$paidAt", timezone: "Asia/Kolkata" },
                    },
                    revenue: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
    ]);

    const totalRevenuePaise = allTimePaid[0]?.total || 0;
    const totalRefundedPaise = refundedPayments[0]?.total || 0;
    const netRevenuePaise = totalRevenuePaise - totalRefundedPaise;

    const formattedTransactions = recentTransactions.map((p) => ({
        paymentId: p._id,
        razorpayPaymentId: p.razorpayPaymentId,
        razorpayOrderId: p.razorpayOrderId,
        patient: {
            id: p.patientId?._id,
            name: p.patientId?.name || "Unknown",
            email: p.patientId?.email,
        },
        doctor: {
            id: p.doctorId?._id,
            name: p.doctorId?.name || "Unknown",
        },
        appointment: {
            id: p.appointmentId?._id,
            date: p.appointmentId?.date,
            timeSlot: p.appointmentId?.timeSlot,
        },
        amount: toINR(p.amount),
        currency: p.currency,
        status: p.status,
        method: p.method,
        paidAt: p.paidAt,
        refundStatus: p.refundStatus,
        refundAmount: p.refundAmount ? toINR(p.refundAmount) : null,
    }));

    return {
        summary: {
            totalRevenue: toINR(totalRevenuePaise),
            totalTransactions: allTimePaid[0]?.count || 0,
            todayRevenue: toINR(todayPaid[0]?.total || 0),
            todayTransactions: todayPaid[0]?.count || 0,
            thisMonthRevenue: toINR(thisMonthPaid[0]?.total || 0),
            thisMonthTransactions: thisMonthPaid[0]?.count || 0,
            totalRefunded: toINR(totalRefundedPaise),
            totalRefundCount: refundedPayments[0]?.count || 0,
            netRevenue: toINR(netRevenuePaise),
        },
        revenueByDoctor: revenueByDoctor.map((d) => ({
            doctorId: d.doctorId,
            doctorName: d.doctorName || "Unknown",
            totalRevenue: toINR(d.totalRevenue),
            transactionCount: d.transactionCount,
        })),
        revenueByMethod: revenueByMethod.map((m) => ({
            method: m._id || "unknown",
            total: toINR(m.total),
            count: m.count,
        })),
        dailyRevenueLast30: dailyRevenueLast30.map((d) => ({
            date: d._id,
            revenue: toINR(d.revenue),
            count: d.count,
        })),
        recentTransactions: formattedTransactions,
    };
};

// ─── Admin: All Transactions (paginated) ────────────────────────────────────

const getAllTransactions = async (query = {}) => {
    const { page = 1, limit = 20, status, from, to, doctorId } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (status) filter.status = status;
    if (doctorId) filter.doctorId = doctorId;
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) {
            const toDate = new Date(to);
            toDate.setHours(23, 59, 59, 999);
            filter.createdAt.$lte = toDate;
        }
    }

    const [payments, totalCount] = await Promise.all([
        PaymentModel.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .populate("patientId", "name email")
            .populate("doctorId", "name")
            .populate("appointmentId", "date timeSlot status")
            .select("-webhookEvents -razorpaySignature"),
        PaymentModel.countDocuments(filter),
    ]);

    return {
        totalCount,
        page: Number(page),
        totalPages: Math.ceil(totalCount / Number(limit)),
        transactions: payments.map((p) => ({
            paymentId: p._id,
            razorpayOrderId: p.razorpayOrderId,
            razorpayPaymentId: p.razorpayPaymentId,
            patient: {
                id: p.patientId?._id,
                name: p.patientId?.name || "Unknown",
                email: p.patientId?.email,
            },
            doctor: {
                id: p.doctorId?._id,
                name: p.doctorId?.name || "Unknown",
            },
            appointment: {
                id: p.appointmentId?._id,
                date: p.appointmentId?.date,
                timeSlot: p.appointmentId?.timeSlot,
                status: p.appointmentId?.status,
            },
            amount: toINR(p.amount),
            currency: p.currency,
            status: p.status,
            method: p.method,
            paidAt: p.paidAt,
            failureReason: p.failureReason,
            refundStatus: p.refundStatus,
            refundAmount: p.refundAmount ? toINR(p.refundAmount) : null,
            refundReason: p.refundReason,
            createdAt: p.createdAt,
        })),
    };
};

module.exports = {
    createPaymentOrder,
    verifyPayment,
    handleWebhook,
    getPaymentStatus,
    initiateRefund,
    getRevenueDashboard,
    getAllTransactions,
    syncRefundStatuses,
};
