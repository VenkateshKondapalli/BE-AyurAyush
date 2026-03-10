const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const doctorApplicationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
      unique: true,
    },

    qualification: {
      type: String,
      required: true,
      trim: true,
    },

    specialization: {
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

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },

    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const DoctorApplicationsModel = model(
  "doctor-applications",
  doctorApplicationSchema,
);
module.exports = { DoctorApplicationsModel };
