const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const QUEUE_TYPES = ["ayurveda", "panchakarma", "normal", "all"];

const subAdminProfileSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
            unique: true,
            index: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        // Which queue type this sub-admin manages
        queueScope: {
            type: String,
            enum: QUEUE_TYPES,
            default: "all",
        },
        permissions: {
            viewQueues:            { type: Boolean, default: false },
            approveAppointments:   { type: Boolean, default: false },
            manageAvailability:    { type: Boolean, default: false },
            viewRevenue:           { type: Boolean, default: false },
            callPatients:          { type: Boolean, default: false },
            viewDoctors:           { type: Boolean, default: false },
            offlineBooking:        { type: Boolean, default: false },
            viewDoctorApplications:{ type: Boolean, default: false },
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        notes: {
            type: String,
            default: "",
            maxlength: 500,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

const SubAdminProfileModel = model("subAdminProfile", subAdminProfileSchema);

module.exports = { SubAdminProfileModel, QUEUE_TYPES };
