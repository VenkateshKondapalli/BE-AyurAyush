const {
    startConversation,
    sendMessage,
    endConversation,
    getConversation,
    getPatientConversations,
    deleteConversationSummary,
    deleteConversation,
} = require("./services");
const logger = require("../../../utils/logger");

const startConversationController = async (req, res, next) => {
    try {
        const data = await startConversation(req.currentPatient.userId);
        res.status(201).json({
            isSuccess: true,
            message: "Conversation started",
            data,
        });
    } catch (err) {
        logger.error("Error in startConversationController", {
            error: err.message,
        });
        next(err);
    }
};

const sendMessageController = async (req, res, next) => {
    try {
        const data = await sendMessage(req.currentPatient.userId, req.body);
        res.status(200).json({
            isSuccess: true,
            message: "Message sent",
            data,
        });
    } catch (err) {
        logger.error("Error in sendMessageController", {
            error: err.message,
        });
        next(err);
    }
};

const endConversationController = async (req, res, next) => {
    try {
        const data = await endConversation(
            req.currentPatient.userId,
            req.body.conversationId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Conversation completed and summary generated",
            data,
        });
    } catch (err) {
        logger.error("Error in endConversationController", {
            error: err.message,
        });
        next(err);
    }
};

const getConversationController = async (req, res, next) => {
    try {
        const data = await getConversation(
            req.currentPatient.userId,
            req.params.conversationId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Conversation retrieved",
            data,
        });
    } catch (err) {
        logger.error("Error in getConversationController", {
            error: err.message,
        });
        next(err);
    }
};

const getPatientConversationsController = async (req, res, next) => {
    try {
        const data = await getPatientConversations(
            req.currentPatient.userId,
            req.query,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Conversations retrieved",
            data,
        });
    } catch (err) {
        logger.error("Error in getPatientConversationsController", {
            error: err.message,
        });
        next(err);
    }
};

const deleteConversationSummaryController = async (req, res, next) => {
    try {
        const data = await deleteConversationSummary(
            req.currentPatient.userId,
            req.params.conversationId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Conversation summary deleted",
            data,
        });
    } catch (err) {
        logger.error("Error in deleteConversationSummaryController", {
            error: err.message,
        });
        next(err);
    }
};

const deleteConversationController = async (req, res, next) => {
    try {
        const data = await deleteConversation(
            req.currentPatient.userId,
            req.params.conversationId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Conversation deleted",
            data,
        });
    } catch (err) {
        logger.error("Error in deleteConversationController", {
            error: err.message,
        });
        next(err);
    }
};

module.exports = {
    startConversationController,
    sendMessageController,
    endConversationController,
    getConversationController,
    getPatientConversationsController,
    deleteConversationSummaryController,
    deleteConversationController,
};
