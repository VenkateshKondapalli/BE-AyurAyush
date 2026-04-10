const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("./logger");

const GEMINI_API_KEYS = (
    process.env.GEMINI_AI_API_KEYS ||
    process.env.GEMINI_AI_API_KEY ||
    ""
)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
const genAIClients = GEMINI_API_KEYS.map((key) => new GoogleGenerativeAI(key));
const AI_MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 3);
const AI_RETRY_BASE_MS = Number(process.env.AI_RETRY_BASE_MS || 700);
const AI_MODEL_CANDIDATES = (
    process.env.AI_MODEL_CANDIDATES || "gemini-2.5-flash"
)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

// Emergency keywords configuration
const EMERGENCY_KEYWORDS = [
    "chest pain",
    "heart attack",
    "cardiac arrest",
    "can't breathe",
    "difficulty breathing",
    "breathing problem",
    "shortness of breath",
    "severe bleeding",
    "heavy bleeding",
    "blood loss",
    "unconscious",
    "fainted",
    "passed out",
    "blacked out",
    "seizure",
    "convulsion",
    "fits",
    "stroke",
    "paralysis",
    "can't move",
    "severe head injury",
    "head trauma",
    "suicide",
    "kill myself",
    "end my life",
    "want to die",
    "allergic reaction",
    "anaphylaxis",
    "throat closing",
    "choking",
    "can't swallow",
    "severe burn",
    "burned badly",
    "poisoning",
    "poisoned",
    "overdose",
    "broken bone",
    "severe pain",
    "vomiting blood",
    "coughing blood",
];

const SYSTEM_PROMPTS = {
    normal: `You are a compassionate and professional medical assistant helping patients describe their symptoms before booking a doctor appointment.

Your responsibilities:
- Ask relevant follow-up questions to understand symptoms better
- Be empathetic, reassuring, and professional
- Extract key information: specific symptoms, duration, and any other relevant details
- Guide the conversation naturally without overwhelming the patient
- Keep responses concise (2-4 sentences maximum)
- DO NOT diagnose or prescribe - only gather information
- If symptoms seem serious, acknowledge concern and recommend seeing a doctor soon
- Do not ask the patient to provide a numeric severity score; infer severity from the symptom description and context

Important guidelines:
- Ask one question at a time
- Use simple, non-medical language
- Show empathy and understanding
- Never dismiss patient concerns
- If patient mentions multiple symptoms, prioritize the most concerning one first`,

    emergency: `EMERGENCY PROTOCOL ACTIVATED

The patient has described symptoms that may indicate a medical emergency.

Your immediate response should:
1. Acknowledge the seriousness calmly but urgently
2. Provide immediate safety advice (if applicable)
3. Inform them that an emergency appointment is being arranged immediately
4. If life-threatening, advise calling emergency services (112 in India)
5. Keep tone urgent but not panicking

Be brief and direct. Patient safety is the priority.`,

    summary: `You are a medical data extraction system. Analyze the conversation between a patient and medical assistant.

Extract and return ONLY a valid JSON object with this exact structure (no additional text):

{
  "symptoms": ["symptom 1", "symptom 2", "symptom 3"],
  "duration": "how long symptoms have been present",
  "severity": 5,
  "urgencyLevel": "normal",
  "recommendedSpecialist": "General Physician",
  "detailedSummary": "A brief 2-3 sentence summary of the patient's condition",
  "carePreference": null,
  "prakritiType": null
}

Rules:
- symptoms: array of specific symptoms mentioned
- duration: string like "3 days", "1 week", "since morning"
- severity: number 1-10 (1=mild, 10=severe), inferred by AI from the full conversation context and symptom wording, not directly copied from patient self-rating
- urgencyLevel: must be exactly "normal", "urgent", or "emergency"
- recommendedSpecialist: one of these: "General Physician", "Cardiologist", "Neurologist", "Orthopedic", "Dermatologist", "ENT Specialist", "Pediatrician", "Gynecologist", "Psychiatrist", "Dentist", "Ophthalmologist", "Gastroenterologist"
- detailedSummary: clear, concise summary in simple language
- carePreference: if patient explicitly mentioned a preference use exactly "ayurveda", "panchakarma", "normal", or "none". Otherwise null.
- prakritiType: if Vata/Pitta/Kapha body type was mentioned or implied, use exactly "vata", "pitta", "kapha", "vata-pitta", "pitta-kapha", or "vata-kapha". Otherwise null.

Return ONLY the JSON object, nothing else.`,
};

// Check if user message contains emergency keywords using word boundaries
// to avoid false positives like "breakfast" matching "break".
const checkForEmergency = (message) => {
    return EMERGENCY_KEYWORDS.some((keyword) => {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`, "i").test(message);
    });
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableAIError = (err) => {
    const status =
        err?.status ||
        err?.statusCode ||
        err?.response?.status ||
        err?.response?.statusCode;
    const message = String(err?.message || "").toLowerCase();

    if ([429, 500, 502, 503, 504].includes(Number(status))) return true;

    return (
        message.includes("high demand") ||
        message.includes("service unavailable") ||
        message.includes("temporarily unavailable") ||
        message.includes("503") ||
        message.includes("429") ||
        message.includes("gateway timeout")
    );
};

const isQuotaExceededError = (err) => {
    const status =
        err?.status ||
        err?.statusCode ||
        err?.response?.status ||
        err?.response?.statusCode;
    const message = String(err?.message || "").toLowerCase();

    return (
        Number(status) === 429 &&
        (message.includes("quota exceeded") ||
            message.includes("resource has been exhausted") ||
            message.includes("rate-limits"))
    );
};

const isModelNotSupportedError = (err) => {
    const status =
        err?.status ||
        err?.statusCode ||
        err?.response?.status ||
        err?.response?.statusCode;
    const message = String(err?.message || "").toLowerCase();

    return (
        Number(status) === 404 &&
        (message.includes("not supported for generatecontent") ||
            (message.includes("model") && message.includes("not found")))
    );
};

const isProviderOriginError = (err) => {
    const message = String(err?.message || "").toLowerCase();
    return (
        message.includes("googlegenerativeai error") ||
        message.includes("generativelanguage.googleapis.com") ||
        message.includes("quota exceeded") ||
        message.includes("rate-limits")
    );
};

const createAIUnavailableError = (operation, originalError) => {
    const error = new Error(
        "AI service is temporarily busy. Please try again in a few seconds.",
    );
    error.statusCode = 503;
    error.code = "AI_SERVICE_UNAVAILABLE";
    error.data = {
        operation,
        retryable: true,
        provider: "google-generative-ai",
    };
    error.cause = originalError;
    return error;
};

const createAIQuotaExceededError = (operation, originalError) => {
    const error = new Error(
        "AI quota is currently exhausted. Please try again shortly.",
    );
    error.statusCode = 429;
    error.code = "AI_QUOTA_EXCEEDED";
    error.data = {
        operation,
        retryable: false,
        provider: "google-generative-ai",
    };
    error.cause = originalError;
    return error;
};

const withAIRetry = async (operation, fn) => {
    let lastError;

    for (let attempt = 1; attempt <= AI_MAX_RETRIES; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            if (isQuotaExceededError(err)) {
                throw createAIQuotaExceededError(operation, err);
            }

            lastError = err;
            const retryable = isRetryableAIError(err);
            const shouldRetry = retryable && attempt < AI_MAX_RETRIES;

            if (!shouldRetry) break;

            const waitMs =
                AI_RETRY_BASE_MS * Math.pow(2, attempt - 1) +
                Math.floor(Math.random() * 200);

            logger.warn("Transient AI provider error, retrying", {
                operation,
                attempt,
                maxRetries: AI_MAX_RETRIES,
                waitMs,
                error: err.message,
            });

            await delay(waitMs);
        }
    }

    if (!isRetryableAIError(lastError)) {
        throw lastError;
    }

    throw createAIUnavailableError(operation, lastError);
};

const withAIModelFallback = async (operation, handler) => {
    if (!genAIClients.length) {
        const err = new Error(
            "Gemini API key is missing. Set GEMINI_AI_API_KEY or GEMINI_AI_API_KEYS.",
        );
        err.statusCode = 500;
        throw err;
    }

    const modelsToTry = AI_MODEL_CANDIDATES.length
        ? AI_MODEL_CANDIDATES
        : ["gemini-2.5-flash"];

    let lastError;

    for (
        let providerIndex = 0;
        providerIndex < genAIClients.length;
        providerIndex += 1
    ) {
        const providerClient = genAIClients[providerIndex];

        for (
            let modelIndex = 0;
            modelIndex < modelsToTry.length;
            modelIndex += 1
        ) {
            const modelName = modelsToTry[modelIndex];

            try {
                return await withAIRetry(
                    `${operation}:key${providerIndex + 1}:${modelName}`,
                    () =>
                        handler({
                            modelName,
                            providerClient,
                            providerIndex,
                        }),
                );
            } catch (err) {
                lastError = err;

                const retryable =
                    err?.code === "AI_SERVICE_UNAVAILABLE" ||
                    err?.code === "AI_QUOTA_EXCEEDED" ||
                    isRetryableAIError(err);
                const modelNotSupported = isModelNotSupportedError(err);
                const fallbackEligible = retryable || modelNotSupported;

                if (!fallbackEligible) {
                    throw err;
                }

                const hasAnotherModel = modelIndex < modelsToTry.length - 1;
                const hasAnotherKey = providerIndex < genAIClients.length - 1;

                logger.warn("Switching to fallback AI model/provider", {
                    operation,
                    failedModel: modelName,
                    providerIndex: providerIndex + 1,
                    hasAnotherModel,
                    hasAnotherKey,
                    modelNotSupported,
                    quotaExceeded: err?.code === "AI_QUOTA_EXCEEDED",
                    error: err.message,
                });

                if (!hasAnotherModel && !hasAnotherKey) break;
            }
        }
    }

    if (lastError?.code === "AI_QUOTA_EXCEEDED") {
        lastError.data = {
            ...(lastError.data || {}),
            providersTried: genAIClients.length,
            modelsTried: modelsToTry,
        };
        throw lastError;
    }

    if (
        !(
            isRetryableAIError(lastError) ||
            isModelNotSupportedError(lastError) ||
            isProviderOriginError(lastError) ||
            lastError?.code === "AI_SERVICE_UNAVAILABLE"
        )
    ) {
        throw lastError;
    }

    const unavailableError = createAIUnavailableError(operation, lastError);
    unavailableError.data = {
        ...(unavailableError.data || {}),
        modelsTried: modelsToTry,
    };

    throw unavailableError;
};

// Get AI chat response from Gemini
const getAIChatResponse = async (messages, isEmergency = false) => {
    return withAIModelFallback(
        "chat-response",
        async ({ modelName, providerClient }) => {
            const model = providerClient.getGenerativeModel({
                model: modelName,
            });

            const systemPrompt = isEmergency
                ? SYSTEM_PROMPTS.emergency
                : SYSTEM_PROMPTS.normal;

            // Build chat history for Gemini format
            const history = messages.slice(0, -1).map((msg) => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }],
            }));

            const chat = model.startChat({
                history,
                systemInstruction: { parts: [{ text: systemPrompt }] },
            });

            const lastMessage = messages[messages.length - 1];
            const result = await chat.sendMessage(lastMessage.content);
            const response = result.response.text();

            return response;
        },
    );
};

// Generate conversation summary using Gemini
const generateConversationSummary = async (messages) => {
    const result = await withAIModelFallback(
        "conversation-summary",
        async ({ modelName, providerClient }) => {
            const model = providerClient.getGenerativeModel({
                model: modelName,
            });

            const conversationText = messages
                .map(
                    (msg) =>
                        `${msg.role === "user" ? "Patient" : "Assistant"}: ${msg.content}`,
                )
                .join("\n");

            return model.generateContent({
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                text: `${SYSTEM_PROMPTS.summary}\n\nConversation:\n${conversationText}`,
                            },
                        ],
                    },
                ],
            });
        },
    );

    const responseText = result.response.text().trim();

    // Extract JSON from the response (handle markdown code blocks)
    let jsonString = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonString = jsonMatch[1].trim();
    }

    // Safe JSON parse — Gemini occasionally returns prose instead of structured JSON
    let summary;
    try {
        summary = JSON.parse(jsonString);
    } catch {
        summary = {
            symptoms: [],
            duration: "Not specified",
            severity: 5,
            urgencyLevel: "normal",
            recommendedSpecialist: "General Physician",
            detailedSummary:
                "Summary could not be generated. Please review the conversation manually.",
            carePreference: null,
            prakritiType: null,
        };
    }

    return summary;
};

module.exports = {
    EMERGENCY_KEYWORDS,
    SYSTEM_PROMPTS,
    checkForEmergency,
    getAIChatResponse,
    generateConversationSummary,
};
