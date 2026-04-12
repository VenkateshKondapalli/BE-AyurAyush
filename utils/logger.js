const { inspect } = require("util");
const { createLogger, format, transports } = require("winston");

const toSingleLine = (text) => String(text || "").replace(/\s+/g, " ").trim();

const summarizeProviderError = (text) => {
    const oneLine = toSingleLine(text);
    const lower = oneLine.toLowerCase();

    const statusMatch = oneLine.match(/\[(\d{3})\s+([^\]]+)\]/);
    const modelMatch = oneLine.match(/models\/([a-zA-Z0-9.\-:]+):/);

    const statusCode = statusMatch?.[1];
    const statusText = statusMatch?.[2];
    const model = modelMatch?.[1];

    let reason = "";
    if (lower.includes("high demand")) {
        reason = "high demand";
    } else if (lower.includes("quota exceeded")) {
        reason = "quota exceeded";
    } else if (lower.includes("not supported for generatecontent")) {
        reason = "model/method unsupported";
    } else if (lower.includes("service unavailable")) {
        reason = "service unavailable";
    }

    if (statusCode || model || reason) {
        return [
            "Gemini API",
            statusCode ? `${statusCode}${statusText ? ` ${statusText}` : ""}` : "",
            model ? `model=${model}` : "",
            reason ? `reason=${reason}` : "",
        ]
            .filter(Boolean)
            .join(" | ");
    }

    return oneLine.length > 220 ? `${oneLine.slice(0, 220)}...` : oneLine;
};

const formatMetaValue = (key, value) => {
    if (typeof value === "string") {
        const normalized = toSingleLine(value);

        if (key === "error") {
            return summarizeProviderError(normalized);
        }

        return normalized.length > 220
            ? `${normalized.slice(0, 220)}...`
            : normalized;
    }

    return inspect(value, {
        colors: false,
        depth: 4,
        breakLength: 100,
        compact: false,
    });
};

const devConsoleFormatter = format.printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    const lines = [`${timestamp} [${level}] ${message}`];

    const metaKeys = Object.keys(meta);
    if (metaKeys.length) {
        lines.push("  details:");
        for (const key of metaKeys) {
            lines.push(`    ${key}: ${formatMetaValue(key, meta[key])}`);
        }
    }

    if (stack) {
        lines.push("  stack:");
        const stackLines = String(stack).split("\n");
        for (const stackLine of stackLines) {
            lines.push(`    ${stackLine}`);
        }
    }

    return lines.join("\n");
});

const logger = createLogger({
    level:
        process.env.LOG_LEVEL ||
        (process.env.NODE_ENV === "production" ? "info" : "debug"),
    format: format.combine(
        format.timestamp(),
        format.splat(),
        format.errors({ stack: true }),
        process.env.NODE_ENV === "production"
            ? format.json()
            : format.combine(
                  format.colorize(),
                  devConsoleFormatter,
              ),
    ),
    transports: [new transports.Console()],
});

module.exports = logger;
