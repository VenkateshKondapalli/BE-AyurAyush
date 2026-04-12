const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const appointmentSchema = new Schema(
    {
        patientId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        doctorId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        date: {
            type: Date,
            required: true,
        },
        timeSlot: {
            type: String,
            required: true,
            trim: true,
            match: [
                /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/,
                "Invalid time slot format (e.g. 09:00 - 10:00)",
            ],
        },
        status: {
            type: String,
            enum: [
                "pending_admin_approval",
                "confirmed",
                "completed",
                "cancelled",
                "rejected",
            ],
            default: "pending_admin_approval",
        },
        urgencyLevel: {
            type: String,
            enum: ["normal", "emergency"],
            default: "normal",
        },
        queueType: {
            type: String,
            enum: ["normal", "ayurveda", "panchakarma"],
            default: "normal",
        },
        tokenNumber: {
            type: String,
            default: null,
        },
        queueDate: {
            type: String,
            default: null,
        },
        tokenSequence: {
            type: Number,
            default: null,
        },
        queueStatus: {
            type: String,
            enum: ["waiting", "called", "in_consultation", "completed"],
            default: "waiting",
        },
        queueCallCount: {
            type: Number,
            default: 0,
        },
        firstCallEmailSentAt: {
            type: Date,
            default: null,
        },
        lastCalledAt: {
            type: Date,
            default: null,
        },
        queueNotificationMessage: {
            type: String,
            default: "",
            maxlength: 500,
        },
        queueNotificationHistory: [
            {
                sentAt: {
                    type: Date,
                    default: Date.now,
                },
                channel: {
                    type: String,
                    enum: ["email_and_in_app", "in_app_only"],
                    default: "in_app_only",
                },
                deliveryStatus: {
                    type: String,
                    enum: ["delivered", "unknown", "failed"],
                    default: "delivered",
                },
                actorRole: {
                    type: String,
                    enum: ["admin", "doctor", "system"],
                    default: "system",
                },
                actorId: {
                    type: Schema.Types.ObjectId,
                    ref: "user",
                    default: null,
                },
                message: {
                    type: String,
                    default: "",
                    maxlength: 500,
                },
            },
        ],
        queueAuditTrail: [
            {
                at: {
                    type: Date,
                    default: Date.now,
                },
                event: {
                    type: String,
                    default: "queue_update",
                    maxlength: 100,
                },
                fromStatus: {
                    type: String,
                    default: null,
                },
                toStatus: {
                    type: String,
                    default: null,
                },
                actorRole: {
                    type: String,
                    enum: ["admin", "doctor", "system"],
                    default: "system",
                },
                actorId: {
                    type: Schema.Types.ObjectId,
                    ref: "user",
                    default: null,
                },
                note: {
                    type: String,
                    default: "",
                    maxlength: 500,
                },
            },
        ],
        consultationStartedAt: {
            type: Date,
            default: null,
        },
        consultationEndedAt: {
            type: Date,
            default: null,
        },
        consultationDurationSeconds: {
            type: Number,
            default: null,
        },
        treatmentCode: {
            type: String,
            default: null,
        },
        therapistId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        roomId: {
            type: String,
            default: null,
        },
        languagePreference: {
            type: String,
            default: null,
        },
        chatConversationId: {
            type: String,
            ref: "chatHistory",
        },
        symptoms: [
            {
                type: String,
            },
        ],
        aiSummary: {
            type: String,
        },
        adminApprovedBy: {
            type: Schema.Types.ObjectId,
            ref: "user",
            default: null,
        },
        adminNotes: {
            type: String,
            default: "",
            maxlength: 1000,
        },
        adminApprovedAt: {
            type: Date,
            default: null,
        },
        adminEditedFields: [
            {
                field: String, // "date", "timeSlot", "doctorId"
                oldValue: String,
                newValue: String,
                editedAt: Date,
            },
        ],
        originalBooking: {
            doctorId: Schema.Types.ObjectId,
            date: Date,
            timeSlot: String,
        },
        doctorNotes: {
            type: String,
            default: "",
            maxlength: 2000,
        },
        prescription: {
            medications: [
                {
                    name: String,
                    dosage: String,
                    frequency: String,
                    duration: String,
                    instructions: String,
                },
            ],
            tests: [
                {
                    testName: String,
                    instructions: String,
                },
            ],
            diagnosis: String,
            notes: String,
            prescribedAt: Date,
        },
        followUpRequired: {
            type: Boolean,
            default: false,
        },
        followUpDate: {
            type: Date,
        },
        rating: {
            type: Number,
            min: 1,
            max: 5,
        },
        feedback: {
            type: String,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

appointmentSchema.index({ doctorId: 1, date: 1, timeSlot: 1 });
appointmentSchema.index({ status: 1, urgencyLevel: 1 });
appointmentSchema.index({ patientId: 1, createdAt: -1 });
appointmentSchema.index({ doctorId: 1, queueDate: 1, queueType: 1 });
appointmentSchema.index({ tokenNumber: 1 }, { sparse: true });

//method to check if the slot is available or not
appointmentSchema.statics.isSlotAvailable = async function (
    doctorId,
    date,
    timeSlot,
) {
    const existingAppointment = await this.findOne({
        doctorId,
        date: {
            $gte: new Date(date).setHours(0, 0, 0, 0),
            $lte: new Date(date).setHours(23, 59, 59, 999),
        },
        timeSlot,
        status: { $nin: ["cancelled", "rejected"] },
    });

    return !existingAppointment;
};

//method admin approves appointment
appointmentSchema.methods.approveByAdmin = function (adminId, edits = null) {
    this.status = "confirmed";
    this.adminApprovedBy = adminId;
    this.adminApprovedAt = new Date();

    if (edits) {
        if (!this.originalBooking || !this.originalBooking.doctorId) {
            this.originalBooking = {
                doctorId: this.doctorId,
                date: this.date,
                timeSlot: this.timeSlot,
            };
        }

        if (edits.doctorId && edits.doctorId !== this.doctorId.toString()) {
            this.adminEditedFields.push({
                field: "doctorId",
                oldValue: this.doctorId.toString(),
                newValue: edits.doctorId,
                editedAt: new Date(),
            });
            this.doctorId = edits.doctorId;
        }

        if (
            edits.date &&
            new Date(edits.date).getTime() !== this.date.getTime()
        ) {
            this.adminEditedFields.push({
                field: "date",
                oldValue: this.date.toISOString(),
                newValue: new Date(edits.date).toISOString(),
                editedAt: new Date(),
            });
            this.date = new Date(edits.date);
        }

        if (edits.timeSlot && edits.timeSlot !== this.timeSlot) {
            this.adminEditedFields.push({
                field: "timeSlot",
                oldValue: this.timeSlot,
                newValue: edits.timeSlot,
                editedAt: new Date(),
            });
            this.timeSlot = edits.timeSlot;
        }
    }
    return this.save();
};

//method to mark as completed
appointmentSchema.methods.markCompleted = function (prescription, notes) {
    this.status = "completed";
    this.prescription = {
        ...prescription,
        prescribedAt: new Date(),
    };
    this.doctorNotes = notes;
    return this.save();
};

//instance method: admin rejects appointment
appointmentSchema.methods.rejectByAdmin = function (adminId, reason) {
    this.status = "rejected";
    this.adminApprovedBy = adminId;
    this.adminApprovedAt = new Date();
    this.adminNotes = reason || "Rejected by admin";
    return this.save();
};

//method to cancel appointment
appointmentSchema.methods.cancel = function (reason) {
    this.status = "cancelled";
    this.adminNotes = reason || "Cancelled by user";
    return this.save();
};

const AppointmentModel = model("appointment", appointmentSchema);

module.exports = { AppointmentModel };
