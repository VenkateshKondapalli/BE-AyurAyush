const logger = require("./logger");
const { runChatRetentionCleanup } = require("../api/v1/chat/services");

const CHAT_RETENTION_JOB_INTERVAL_HOURS = Number(
    process.env.CHAT_RETENTION_JOB_INTERVAL_HOURS || 24,
);

const startChatRetentionJob = () => {
    const intervalMs = CHAT_RETENTION_JOB_INTERVAL_HOURS * 60 * 60 * 1000;

    const execute = async () => {
        try {
            const result = await runChatRetentionCleanup();
            logger.info("Chat retention cleanup completed", result);
        } catch (err) {
            logger.error("Chat retention cleanup failed", {
                error: err.message,
            });
        }
    };

    // Run once at startup, then periodically.
    execute();
    return setInterval(execute, intervalMs);
};

module.exports = { startChatRetentionJob };
