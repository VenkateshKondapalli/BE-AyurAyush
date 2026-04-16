const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const doctorSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
            unique: true,
        },

        specialization: {
            type: String,
            required: true,
            trim: true,
        },

        qualification: {
            type: String,
            required: true,
            trim: true,
        },

        experience: {
            type: Number,
            required: true,
            min: [0, "Experience cannot be negative"],
        },

        licenseNumber: {
            type: String,
            required: true,
            trim: true,
        },

        consultationFee: {
            type: Number,
            min: [0, "Consultation fee cannot be negative"],
        },

        availableModes: {
            type: [String],
            enum: ["offline", "online"],
            default: [],
        },

        // -------- Admin-controlled --------
        isVerified: {
            type: Boolean,
            default: false,
            index: true,
        },

        verifiedAt: {
            type: Date,
        },

        // -------- Emergency Delay State --------
        emergencyState: {
            isActive: {
                type: Boolean,
                default: false,
            },
            reason: {
                type: String,
                default: "",
            },
            activatedAt: {
                type: Date,
                default: null,
            },
        },

        // -------- Clinical Reference --------
        customReferences: {
            type: Schema.Types.Mixed,
            default: {
                medications: [],
                procedures: [],
                bestPractices: []
            }
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

const DoctorModel = model("doctor", doctorSchema);

module.exports = { DoctorModel };
