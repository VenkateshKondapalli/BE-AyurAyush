const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const emergencyPatientSchema = new Schema(
    {
        displayName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        phone: {
            type: String,
            trim: true,
            default: "",
        },
        conditionSummary: {
            type: String,
            trim: true,
            default: "Unconscious / critical condition",
            maxlength: 600,
        },
        wardLocation: {
            type: String,
            trim: true,
            default: "Emergency Ward",
            maxlength: 120,
        },
        createdByAdminId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

const EmergencyPatientModel = model("emergencyPatient", emergencyPatientSchema);

module.exports = { EmergencyPatientModel };
