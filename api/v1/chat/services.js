const { v4: uuidv4 } = require("uuid");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const { parsePagination } = require("../../../utils/helpers");
const logger = require("../../../utils/logger");
const {
    checkForEmergency,
    getAIChatResponse,
    generateConversationSummary,
} = require("../../../utils/aiService");

const CHAT_MAX_USER_PROMPTS = Number(process.env.CHAT_MAX_USER_PROMPTS || 30);
const AI_UNAVAILABLE_FALLBACK_MESSAGE =
    "Our AI assistant is currently experiencing high demand. Please wait a few seconds and send your message again.";

const isAIProviderErrorForFallback = (err) => {
    const status =
        err?.status ||
        err?.statusCode ||
        err?.response?.status ||
        err?.response?.statusCode;
    const message = String(err?.message || "").toLowerCase();

    if (err?.code === "AI_SERVICE_UNAVAILABLE") return true;
    if ([429, 500, 502, 503, 504].includes(Number(status))) return true;

    return (
        message.includes("googlegenerativeai error") ||
        message.includes("generativelanguage.googleapis.com") ||
        message.includes("high demand") ||
        message.includes("quota exceeded") ||
        message.includes("rate-limits") ||
        message.includes("not supported for generatecontent")
    );
};
// ── Panchakarma/Ayurveda symptom indicators ──────────────────────────────────
const PANCHAKARMA_INDICATORS = [
    "chronic pain",
    "back pain",
    "joint pain",
    "arthritis",
    "spondylitis",
    "stress",
    "anxiety",
    "fatigue",
    "digestive",
    "constipation",
    "bloating",
    "insomnia",
    "migraine",
    "paralysis",
    "neurological",
];

// Rule-based recommendation engine — no NLP training required.
// Input: AI-extracted summary + emergency flag
// Output: { suggestedCarePath, urgencyLevel, recommendedTreatmentCodes[], preConsultNote }
const buildRecommendation = (summary, isEmergency) => {
    const {
        symptoms = [],
        severity = 5,
        urgencyLevel: aiUrgency = "normal",
        carePreference = null,
        prakritiType = null,
        recommendedSpecialist = "General Physician",
        detailedSummary = "",
        duration = "",
    } = summary;

    const symptomStr = symptoms.join(" ").toLowerCase();
    const resolvedUrgency = isEmergency ? "emergency" : aiUrgency;

    // Emergency — always route to normal urgent care first
    if (resolvedUrgency === "emergency") {
        return {
            suggestedCarePath: "normal",
            urgencyLevel: "emergency",
            recommendedTreatmentCodes: ["NORMAL-URGENT"],
            prakritiType: prakritiType || null,
            preConsultNote: _buildPreConsultNote(summary),
        };
    }

    // Check if symptoms match Panchakarma indicators
    const isPanchakarmaCandidate =
        PANCHAKARMA_INDICATORS.some((ind) => symptomStr.includes(ind)) &&
        severity >= 5;

    // Patient explicitly asked for Panchakarma
    if (carePreference === "panchakarma") {
        return {
            suggestedCarePath: "panchakarma",
            urgencyLevel: resolvedUrgency,
            recommendedTreatmentCodes: ["PKM-BASIC"],
            prakritiType: prakritiType || null,
            preConsultNote: _buildPreConsultNote(summary),
        };
    }

    // Patient explicitly asked for Ayurveda
    if (carePreference === "ayurveda") {
        const codes = isPanchakarmaCandidate
            ? ["AYU-GENERAL", "PKM-BASIC"]
            : ["AYU-GENERAL"];
        return {
            suggestedCarePath: isPanchakarmaCandidate ? "hybrid" : "ayurveda",
            urgencyLevel: resolvedUrgency,
            recommendedTreatmentCodes: codes,
            prakritiType: prakritiType || null,
            preConsultNote: _buildPreConsultNote(summary),
        };
    }

    // No explicit preference but symptom pattern suggests Ayurveda/Panchakarma
    if (isPanchakarmaCandidate) {
        return {
            suggestedCarePath: "hybrid",
            urgencyLevel: resolvedUrgency,
            recommendedTreatmentCodes: ["NORMAL-GENERAL", "AYU-GENERAL"],
            prakritiType: prakritiType || null,
            preConsultNote: _buildPreConsultNote(summary),
        };
    }

    // Default — normal consultation
    return {
        suggestedCarePath: "normal",
        urgencyLevel: resolvedUrgency,
        recommendedTreatmentCodes: ["NORMAL-GENERAL"],
        prakritiType: prakritiType || null,
        preConsultNote: _buildPreConsultNote(summary),
    };
};

// Builds a SOAP-lite pre-consultation note for the doctor.
const _buildPreConsultNote = (summary) => {
    const {
        symptoms = [],
        duration = "",
        severity = null,
        detailedSummary = "",
        recommendedSpecialist = "General Physician",
    } = summary;
    return {
        subjective: `Patient reports: ${symptoms.join(", ") || "not specified"}. Duration: ${duration || "not specified"}. Severity: ${severity !== null ? `${severity}/10` : "not specified"}.`,
        assessment:
            detailedSummary ||
            "Refer to conversation history for full context.",
        plan: `Recommended specialist: ${recommendedSpecialist}. Review symptoms and confirm appropriate treatment path before consultation.`,
    };
};

const completeConversationWithSummary = async (chatHistory) => {
    const messagesForSummary = chatHistory.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
    }));

    const summary = await generateConversationSummary(messagesForSummary);
    const isEmergency = chatHistory.status === "emergency";

    if (isEmergency) {
        summary.urgencyLevel = "emergency";
    }

    const recommendation = buildRecommendation(summary, isEmergency);

    await chatHistory.completeSummary({
        ...summary,
        suggestedCarePath: recommendation.suggestedCarePath,
        recommendedTreatmentCodes: recommendation.recommendedTreatmentCodes,
        prakritiType: recommendation.prakritiType,
        preConsultNote: recommendation.preConsultNote,
        carePreference: summary.carePreference,
    });

    return {
        summary,
        recommendation: {
            suggestedCarePath: recommendation.suggestedCarePath,
            urgencyLevel: recommendation.urgencyLevel,
            recommendedTreatmentCodes: recommendation.recommendedTreatmentCodes,
            prakritiType: recommendation.prakritiType,
            preConsultNote: recommendation.preConsultNote,
        },
    };
};

const startConversation = async (userId) => {
    const conversationId = uuidv4();

    const chatHistory = await ChatHistoryModel.create({
        conversationId,
        patientId: userId,
        messages: [],
        status: "active",
    });

    return {
        conversationId: chatHistory.conversationId,
        greeting:
            "Hello! I'm your medical assistant. Please describe what symptoms or health concerns you're experiencing, and I'll help you prepare for your doctor appointment.",
    };
};

const sendMessage = async (userId, { conversationId, message }) => {
    const chatHistory = await ChatHistoryModel.findOne({
        conversationId,
        patientId: userId,
    });

    if (!chatHistory) {
        const error = new Error("Conversation not found");
        error.statusCode = 404;
        throw error;
    }

    if (chatHistory.status === "completed") {
        const error = new Error(
            "This conversation is already completed. Please start a new conversation.",
        );
        error.statusCode = 400;
        throw error;
    }

    const existingUserMessageCount = chatHistory.messages.filter(
        (msg) => msg.role === "user",
    ).length;

    if (existingUserMessageCount >= CHAT_MAX_USER_PROMPTS) {
        const error = new Error(
            `You have reached the maximum of ${CHAT_MAX_USER_PROMPTS} prompts in this conversation. Please end this chat and book an appointment, or start a new conversation.`,
        );
        error.statusCode = 400;
        throw error;
    }

    const isEmergency = checkForEmergency(message);
    if (isEmergency) {
        logger.warn("Emergency indicator detected in chat conversation", {
            conversationId,
        });
    }

    await chatHistory.addMessage("user", message, isEmergency);

    const userMessageCount = chatHistory.messages.filter(
        (msg) => msg.role === "user",
    ).length;

    if (isEmergency && chatHistory.status !== "emergency") {
        chatHistory.markAsEmergency();
        await chatHistory.save();
    }

    const messagesForAI = chatHistory.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
    }));

    let aiResponse;
    let providerUnavailable = false;

    try {
        aiResponse = await getAIChatResponse(messagesForAI, isEmergency);
        await chatHistory.addMessage("assistant", aiResponse, isEmergency);
    } catch (err) {
        if (isAIProviderErrorForFallback(err)) {
            providerUnavailable = true;
            aiResponse = AI_UNAVAILABLE_FALLBACK_MESSAGE;

            logger.warn("AI provider unavailable for chat response", {
                conversationId,
                userId: String(userId),
                error: err.message,
            });

            await chatHistory.addMessage("assistant", aiResponse, isEmergency);
        } else {
            throw err;
        }
    }

    return {
        conversationId,
        userMessage: message,
        aiResponse,
        isEmergency,
        status: chatHistory.status,
        messageCount: chatHistory.messages.length,
        userMessageCount,
        maxUserPrompts: CHAT_MAX_USER_PROMPTS,
        promptLimitReached: userMessageCount >= CHAT_MAX_USER_PROMPTS,
        providerUnavailable,
    };
};

const endConversation = async (userId, conversationId) => {
    const chatHistory = await ChatHistoryModel.findOne({
        conversationId,
        patientId: userId,
    });

    if (!chatHistory) {
        const error = new Error("Conversation not found");
        error.statusCode = 404;
        throw error;
    }

    if (chatHistory.status === "completed") {
        const error = new Error("Conversation already completed");
        error.statusCode = 400;
        error.data = { summary: chatHistory.summary };
        throw error;
    }

    if (chatHistory.messages.length < 2) {
        const error = new Error(
            "Please have at least one exchange with the assistant before ending the conversation.",
        );
        error.statusCode = 400;
        throw error;
    }

    const completion = await completeConversationWithSummary(chatHistory);

    return {
        conversationId,
        summary: completion.summary,
        status: "completed",
        recommendation: completion.recommendation,
    };
};

const getConversation = async (userId, conversationId) => {
    const chatHistory = await ChatHistoryModel.findOne({
        conversationId,
        patientId: userId,
    });

    if (!chatHistory) {
        const error = new Error("Conversation not found");
        error.statusCode = 404;
        throw error;
    }

    return {
        conversationId: chatHistory.conversationId,
        status: chatHistory.status,
        messages: chatHistory.messages,
        summary: chatHistory.summary,
        createdAt: chatHistory.createdAt,
    };
};

const getPatientConversations = async (userId, query = {}) => {
    const { page, limit, skip } = parsePagination(query);
    const filter = { patientId: userId };

    const [conversations, totalCount] = await Promise.all([
        ChatHistoryModel.find(filter)
            .select(
                "conversationId status summary.symptoms summary.urgencyLevel createdAt appointmentId",
            )
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
        ChatHistoryModel.countDocuments(filter),
    ]);

    return {
        count: conversations.length,
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
        conversations,
    };
};

module.exports = {
    startConversation,
    sendMessage,
    endConversation,
    getConversation,
    getPatientConversations,
};
