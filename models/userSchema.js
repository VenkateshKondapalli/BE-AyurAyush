const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const { Schema, model } = mongoose;

const ROLE_OPTIONS = {
  PATIENT: "patient",
  DOCTOR: "doctor",
  ADMIN: "admin",
};

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      sparse: true,
    },

    gender: {
      type: String,
      required: true,
      enum: ["male", "female", "other"],
    },

    dob: {
      type: String,
      required: true,
    },

    password: {
      type: String,
      required: true,
    },

    roles: {
      type: [String],
      enum: Object.values(ROLE_OPTIONS),
      default: [ROLE_OPTIONS.PATIENT],
    },
    // optional data from user
    addresses: [
      {
        addressLine: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
        phone: String,
      },
    ],

    profilePhoto: {
      type: String,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.pre("findOneAndUpdate", function () {
  this.options.runValidators = true;
  this.options.new = true;
});

userSchema.pre("updateOne", function () {
  this.options.runValidators = true;
  this.options.new = true;
});

userSchema.pre("updateMany", function () {
  this.options.runValidators = true;
  this.options.new = true;
});

userSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password.toString(), 12);
  }
});

const UserModel = model("user", userSchema);

module.exports = { UserModel, ROLE_OPTIONS };
