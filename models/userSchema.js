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
            minlength: 2,
            maxlength: 100,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please enter a valid email"],
        },

        phone: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            match: [/^\d{10}$/, "Phone must be a 10-digit number"],
        },

        gender: {
            type: String,
            required: true,
            enum: ["male", "female", "other"],
        },

        dob: {
            type: Date,
            required: true,
        },

        password: {
            type: String,
            required: true,
            minlength: [8, "Password must be at least 8 characters"],
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

userSchema.pre("save", async function () {
    if (this.isModified("password")) {
        this.password = await bcrypt.hash(this.password.toString(), 12);
    }
});

const UserModel = model("user", userSchema);

module.exports = { UserModel, ROLE_OPTIONS };
