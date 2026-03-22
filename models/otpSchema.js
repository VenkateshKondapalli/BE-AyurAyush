const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const { Schema, model } = mongoose;

const OTP_EXPIRY_MINUTES = 10;

const otpSchema = new Schema(
    {
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        otp: {
            type: String,
            required: true,
            trim: true,
        },
        attempts: {
            type: Number,
            default: 0,
        },
        expiresAt: {
            type: Date,
            required: true,
            default: () =>
                new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
            index: { expires: 0 }, // MongoDB TTL index — auto-deletes docs when expiresAt is reached
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

// ------------- default preferences ---------------
otpSchema.pre("findOneAndUpdate", function () {
    this.options.runValidators = true;
    this.options.new = true;
});
otpSchema.pre("updateOne", function () {
    this.options.runValidators = true;
    this.options.new = true;
});
otpSchema.pre("updateMany", function () {
    this.options.runValidators = true;
    this.options.new = true;
});
// --------------------------------------------------

otpSchema.pre("save", async function () {
    if (this.isModified("otp")) {
        this.otp = await bcrypt.hash(this.otp.toString(), 12);
    }
});

const OtpModel = model("otp", otpSchema);

module.exports = { OtpModel, OTP_EXPIRY_MINUTES };
