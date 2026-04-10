const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validatePatientRole,
} = require("../middlewares");
const {
    startConversationController,
    sendMessageController,
    endConversationController,
    getConversationController,
    getPatientConversationsController,
    deleteConversationSummaryController,
    deleteConversationController,
} = require("./controllers");
const { sendMessageValidator, endConversationValidator } = require("./dto");

const chatRouter = express.Router();

// Start a new conversation
chatRouter.post(
    "/start",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    startConversationController,
);

// Send message and get AI response
chatRouter.post(
    "/message",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    sendMessageValidator,
    sendMessageController,
);

// End conversation and generate summary
chatRouter.post(
    "/end",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    endConversationValidator,
    endConversationController,
);

// Get all patient conversations
chatRouter.get(
    "/",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    getPatientConversationsController,
);

// Get specific conversation history
chatRouter.get(
    "/:conversationId",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    getConversationController,
);

// Delete only summary for a conversation
chatRouter.delete(
    "/:conversationId/summary",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    deleteConversationSummaryController,
);

// Delete entire conversation if not linked to appointment
chatRouter.delete(
    "/:conversationId",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    deleteConversationController,
);

module.exports = { chatRouter };
