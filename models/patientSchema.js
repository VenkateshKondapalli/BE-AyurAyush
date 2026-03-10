const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const patientSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
      unique: true,
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

const PatientModel = model("patient", patientSchema);

module.exports = { PatientModel };
