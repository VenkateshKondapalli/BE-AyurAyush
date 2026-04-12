const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const chatHistorySchema = new Schema(
    {
        conversationId: {
            type: String,
            required: true,
            unique: true,
        },
        patientId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
            index: true,
        },
        messages: [
            {
                role: {
                    type: String,
                    enum: ["user", "assistant"],
                    required: true,
                },
                content: {
                    type: String,
                    required: true,
                },
                timestamp: {
                    type: Date,
                    default: Date.now,
                },
                isEmergency: {
                    type: Boolean,
                    default: false,
                },
            },
        ],
        summary: {
            symptoms: [
                {
                    type: String,
                },
            ],
            duration: {
                type: String,
                default: "",
            },
            severity: {
                type: Number,
                min: 1,
                max: 10,
                default: null,
            },
            urgencyLevel: {
                type: String,
                enum: ["normal", "urgent", "emergency"],
                default: "normal",
            },
            recommendedSpecialist: {
                type: String,
                default: "",
            },
            detailedSummary: {
                type: String,
                default: "",
            },
            generatedAt: {
                type: Date,
            },
        },
        summaryStatus: {
            type: String,
            enum: ["active", "deleted"],
            default: "active",
        },
        summaryDeletedAt: {
            type: Date,
            default: null,
        },
        messagesPrunedAt: {
            type: Date,
            default: null,
        },
        status: {
            type: String,
            enum: ["active", "completed", "emergency"],
            default: "active",
        },
        appointmentId: {
            type: Schema.Types.ObjectId,
            ref: "appointment",
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

chatHistorySchema.index({ patientId: 1, createdAt: -1 });
chatHistorySchema.index({ status: 1 });

//method to add message to conversation.
chatHistorySchema.methods.addMessage = function (
    role,
    content,
    isEmergency = false,
) {
    this.messages.push({
        role,
        content,
        timestamp: new Date(),
        isEmergency,
    });
    return this.save();
};

//method to mark as emergency
chatHistorySchema.methods.markAsEmergency = function () {
    this.status = "emergency";
    return this.status;
};

//method to complete conversation with summary
chatHistorySchema.methods.completeSummary = function (summaryData) {
    this.summary = {
        ...summaryData,
        generatedAt: new Date(),
    };
    this.summaryStatus = "active";
    this.summaryDeletedAt = null;
    this.status = "completed";
    return this.save();
};

const ChatHistoryModel = model("chatHistory", chatHistorySchema);

module.exports = { ChatHistoryModel };
