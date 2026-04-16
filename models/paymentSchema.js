const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const paymentSchema = new Schema(
    {
        appointmentId: {
            type: Schema.Types.ObjectId,
            ref: "appointment",
            required: true,
            index: true,
        },
        patientId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
            index: true,
        },
        doctorId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        // Razorpay identifiers
        razorpayOrderId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        razorpayPaymentId: {
            type: String,
            default: null,
            sparse: true,
            index: true,
        },
        razorpaySignature: {
            type: String,
            default: null,
        },
        // Amount in paise (1 INR = 100 paise) — always computed server-side
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        currency: {
            type: String,
            default: "INR",
        },
        status: {
            type: String,
            enum: ["created", "paid", "failed", "refunded", "partially_refunded"],
            default: "created",
            index: true,
        },
        // Payment method captured from webhook (card, upi, netbanking, wallet)
        method: {
            type: String,
            default: null,
        },
        // Refund tracking
        refundId: {
            type: String,
            default: null,
        },
        refundAmount: {
            type: Number,
            default: null,
        },
        refundStatus: {
            type: String,
            enum: ["none", "initiated", "processed", "failed"],
            default: "none",
        },
        refundReason: {
            type: String,
            default: "",
        },
        refundInitiatedAt: {
            type: Date,
            default: null,
        },
        refundProcessedAt: {
            type: Date,
            default: null,
        },
        // Timestamps for payment lifecycle
        paidAt: {
            type: Date,
            default: null,
        },
        failedAt: {
            type: Date,
            default: null,
        },
        failureReason: {
            type: String,
            default: "",
        },
        // Full webhook event audit trail — every event Razorpay sends is stored
        webhookEvents: [
            {
                event: { type: String },
                receivedAt: { type: Date, default: Date.now },
                payload: { type: Schema.Types.Mixed },
            },
        ],
        // Notes visible in Razorpay dashboard
        notes: {
            type: Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

paymentSchema.index({ patientId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ paidAt: -1 });

const PaymentModel = model("payment", paymentSchema);

module.exports = { PaymentModel };
