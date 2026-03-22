const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Counter collection for auto-incrementing MRN
const counterSchema = new Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
});
const CounterModel = model("counter", counterSchema);

const patientSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
            unique: true,
        },

        mrn: {
            type: String,
            unique: true,
            index: true,
        },

        bloodGroup: {
            type: String,
            enum: {
                values: BLOOD_GROUP_OPTIONS,
                message: "{VALUE} is not a valid blood group",
            },
            default: null,
        },

        medicalHistory: {
            type: [String],
            default: [],
        },

        allergies: {
            type: [String],
            default: [],
        },

        emergencyContact: {
            name: { type: String, trim: true },
            phone: { type: String, trim: true },
            relation: { type: String, trim: true },
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

patientSchema.pre("save", async function () {
    if (!this.mrn) {
        const year = new Date().getFullYear();
        const counter = await CounterModel.findByIdAndUpdate(
            "patient_mrn",
            { $inc: { seq: 1 } },
            { new: true, upsert: true },
        );
        this.mrn = `AYR-${year}-${String(counter.seq).padStart(5, "0")}`;
    }
});

const PatientModel = model("patient", patientSchema);

module.exports = { PatientModel };
