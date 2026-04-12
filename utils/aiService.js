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
const GROQ_API_KEYS = (
    process.env.GROQ_API_KEYS ||
    process.env.GROQ_API_KEY ||
    ""
)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
const AI_PRIMARY_PROVIDER = (
    process.env.AI_PRIMARY_PROVIDER || "gemini"
).toLowerCase();
const AI_FALLBACK_PROVIDER = (
    process.env.AI_FALLBACK_PROVIDER || "groq"
).toLowerCase();
const AI_FORCE_PROVIDER = (process.env.AI_FORCE_PROVIDER || "").toLowerCase();
const AI_GEMINI_ENABLED =
    String(process.env.AI_GEMINI_ENABLED || "true").toLowerCase() !== "false";
const AI_GROQ_ENABLED =
    String(process.env.AI_GROQ_ENABLED || "true").toLowerCase() !== "false";
const AI_MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 3);
const AI_RETRY_BASE_MS = Number(process.env.AI_RETRY_BASE_MS || 700);
const AI_MODEL_CANDIDATES = (
    process.env.AI_MODEL_CANDIDATES || "gemini-2.5-flash"
)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
const GROQ_MODEL_CANDIDATES = (
    process.env.GROQ_MODEL_CANDIDATES || "llama-3.3-70b-versatile"
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

const isProviderEnabled = (provider) => {
    if (provider === "gemini") return AI_GEMINI_ENABLED;
    if (provider === "groq") return AI_GROQ_ENABLED;
    return false;
};

const isProviderConfigured = (provider) => {
    if (provider === "gemini") return genAIClients.length > 0;
    if (provider === "groq") return GROQ_API_KEYS.length > 0;
    return false;
};

const getProviderModels = (provider) => {
    if (provider === "gemini") {
        return AI_MODEL_CANDIDATES.length
            ? AI_MODEL_CANDIDATES
            : ["gemini-2.5-flash"];
    }
    if (provider === "groq") {
        return GROQ_MODEL_CANDIDATES.length
            ? GROQ_MODEL_CANDIDATES
            : ["llama-3.3-70b-versatile"];
    }
    return [];
};

const getProviderOrder = () => {
    const valid = new Set(["gemini", "groq"]);

    const candidates = [];
    if (AI_FORCE_PROVIDER && valid.has(AI_FORCE_PROVIDER)) {
        candidates.push(AI_FORCE_PROVIDER);
    } else {
        if (valid.has(AI_PRIMARY_PROVIDER)) {
            candidates.push(AI_PRIMARY_PROVIDER);
        }
        if (
            AI_FALLBACK_PROVIDER !== "none" &&
            valid.has(AI_FALLBACK_PROVIDER) &&
            AI_FALLBACK_PROVIDER !== AI_PRIMARY_PROVIDER
        ) {
            candidates.push(AI_FALLBACK_PROVIDER);
        }
    }

    const uniqueCandidates = [...new Set(candidates)];

    return uniqueCandidates.filter(
        (provider) =>
            isProviderEnabled(provider) && isProviderConfigured(provider),
    );
};

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
        message.includes("api.groq.com") ||
        message.includes("groq") ||
        message.includes("quota exceeded") ||
        message.includes("rate-limits")
    );
};

const createAIUnavailableError = (operation, originalError, provider) => {
    const error = new Error(
        "AI service is temporarily busy. Please try again in a few seconds.",
    );
    error.statusCode = 503;
    error.code = "AI_SERVICE_UNAVAILABLE";
    error.data = {
        operation,
        retryable: true,
        provider: provider || "unknown",
    };
    error.cause = originalError;
    return error;
};

const createAIQuotaExceededError = (operation, originalError, provider) => {
    const error = new Error(
        "AI quota is currently exhausted. Please try again shortly.",
    );
    error.statusCode = 429;
    error.code = "AI_QUOTA_EXCEEDED";
    error.data = {
        operation,
        retryable: false,
        provider: provider || "unknown",
    };
    error.cause = originalError;
    return error;
};

const withAIRetry = async (operation, provider, fn) => {
    let lastError;

    for (let attempt = 1; attempt <= AI_MAX_RETRIES; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            if (isQuotaExceededError(err)) {
                throw createAIQuotaExceededError(operation, err, provider);
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
                provider,
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

    throw createAIUnavailableError(operation, lastError, provider);
};

const withAIModelFallback = async (operation, handler) => {
    const providersToTry = getProviderOrder();

    if (!providersToTry.length) {
        const err = new Error(
            "No AI provider is configured/enabled. Set GEMINI_AI_API_KEY(S) and/or GROQ_API_KEY and enable a provider.",
        );
        err.statusCode = 500;
        throw err;
    }

    let lastError;
    const modelsTried = [];

    for (
        let providerPos = 0;
        providerPos < providersToTry.length;
        providerPos += 1
    ) {
        const provider = providersToTry[providerPos];
        const providerModels = getProviderModels(provider);

        const providerClients =
            provider === "gemini" ? genAIClients : GROQ_API_KEYS;

        for (
            let clientIndex = 0;
            clientIndex < providerClients.length;
            clientIndex += 1
        ) {
            const providerClient = providerClients[clientIndex];

            for (
                let modelIndex = 0;
                modelIndex < providerModels.length;
                modelIndex += 1
            ) {
                const modelName = providerModels[modelIndex];
                const keySuffix =
                    provider === "gemini" ? `:key${clientIndex + 1}` : "";
                modelsTried.push(`${provider}${keySuffix}:${modelName}`);

                try {
                    const output = await withAIRetry(
                        `${operation}:${provider}${keySuffix}:${modelName}`,
                        provider,
                        () =>
                            handler({
                                provider,
                                modelName,
                                providerClient,
                                providerClientIndex: clientIndex,
                            }),
                    );

                    const meta = {
                        operation,
                        provider,
                        model: modelName,
                        providerClientIndex: clientIndex + 1,
                        providerOrder: providerPos + 1,
                        fallbackUsed:
                            providerPos > 0 ||
                            clientIndex > 0 ||
                            modelIndex > 0,
                    };

                    logger.info("AI provider served request", meta);
                    return { output, meta };
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

                    const hasAnotherModel =
                        modelIndex < providerModels.length - 1;
                    const hasAnotherClient =
                        clientIndex < providerClients.length - 1;
                    const hasAnotherProvider =
                        providerPos < providersToTry.length - 1;

                    logger.warn("Switching to fallback AI model/provider", {
                        operation,
                        provider,
                        providerClientIndex: clientIndex + 1,
                        failedModel: modelName,
                        providerOrder: providerPos + 1,
                        hasAnotherModel,
                        hasAnotherClient,
                        hasAnotherProvider,
                        modelNotSupported,
                        quotaExceeded: err?.code === "AI_QUOTA_EXCEEDED",
                        error: err.message,
                    });

                    if (
                        !hasAnotherModel &&
                        !hasAnotherClient &&
                        !hasAnotherProvider
                    ) {
                        break;
                    }
                }
            }
        }
    }

    if (lastError?.code === "AI_QUOTA_EXCEEDED") {
        lastError.data = {
            ...(lastError.data || {}),
            providersTried: providersToTry,
            modelsTried,
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

    const unavailableError = createAIUnavailableError(
        operation,
        lastError,
        lastError?.data?.provider,
    );
    unavailableError.data = {
        ...(unavailableError.data || {}),
        providersTried: providersToTry,
        modelsTried,
    };

    throw unavailableError;
};

const groqChatCompletion = async ({ modelName, messages, apiKey }) => {
    const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelName,
                messages,
                temperature: 0.2,
            }),
        },
    );

    let data;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const error = new Error(
            data?.error?.message ||
                `Groq request failed with status ${response.status}`,
        );
        error.statusCode = response.status;
        error.provider = "groq";
        error.data = {
            provider: "groq",
            statusCode: response.status,
        };
        throw error;
    }

    return data?.choices?.[0]?.message?.content || "";
};

// Get AI chat response from Gemini
const getAIChatResponse = async (messages, isEmergency = false) => {
    const result = await withAIModelFallback(
        "chat-response",
        async ({ provider, modelName, providerClient }) => {
            const systemPrompt = isEmergency
                ? SYSTEM_PROMPTS.emergency
                : SYSTEM_PROMPTS.normal;

            if (provider === "gemini") {
                const model = providerClient.getGenerativeModel({
                    model: modelName,
                });

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
                return result.response.text();
            }

            if (provider === "groq") {
                const chatMessages = [
                    { role: "system", content: systemPrompt },
                    ...messages.map((msg) => ({
                        role: msg.role === "assistant" ? "assistant" : "user",
                        content: msg.content,
                    })),
                ];

                return groqChatCompletion({
                    modelName,
                    messages: chatMessages,
                    apiKey: providerClient,
                });
            }

            throw new Error(`Unsupported AI provider: ${provider}`);
        },
    );

    return {
        aiResponse: result.output,
        meta: result.meta,
    };
};

// Generate conversation summary using Gemini
const generateConversationSummary = async (messages) => {
    const result = await withAIModelFallback(
        "conversation-summary",
        async ({ provider, modelName, providerClient }) => {
            const conversationText = messages
                .map(
                    (msg) =>
                        `${msg.role === "user" ? "Patient" : "Assistant"}: ${msg.content}`,
                )
                .join("\n");

            if (provider === "gemini") {
                const model = providerClient.getGenerativeModel({
                    model: modelName,
                });

                const result = await model.generateContent({
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
                return result.response.text().trim();
            }

            if (provider === "groq") {
                return groqChatCompletion({
                    modelName,
                    messages: [
                        { role: "system", content: SYSTEM_PROMPTS.summary },
                        {
                            role: "user",
                            content: `Conversation:\n${conversationText}`,
                        },
                    ],
                    apiKey: providerClient,
                });
            }

            throw new Error(`Unsupported AI provider: ${provider}`);
        },
    );
    const responseText = result.output;

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

    return {
        summary,
        meta: result.meta,
    };
};

module.exports = {
    EMERGENCY_KEYWORDS,
    SYSTEM_PROMPTS,
    checkForEmergency,
    getAIChatResponse,
    generateConversationSummary,
};
