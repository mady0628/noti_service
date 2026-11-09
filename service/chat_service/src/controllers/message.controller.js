const messageService = require("../services/message.service");
const sseService = require("../services/sse.service");

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getMessage = async (req, res) => {
    try {
        const conversationId = req.params.conversationId || req.params.id;
        const limit = Number(req.query.limit || 15);
        const cursor = req.query.cursor || null;

        if (!uuidRegex.test(conversationId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid conversation ID"
            });
        }

        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (cursor && (typeof cursor !== "string" || cursor.length > 512))) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters"
            });
        }

        const result = await messageService.getMessage(conversationId, limit, cursor);

        return res.status(200).json({
            success: true,
            data: result.data,
            pagination: {
                limit,
                hasMore: result.hasMore,
                nextCursor: result.nextCursor
            }
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const sendMessage = async (req, res) => {
    try {
        const conversationId = req.params.conversationId || req.params.id;
        const { content, clientRequestId } = req.body;

        if (!uuidRegex.test(conversationId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid conversation ID"
            });
        }

        if (
            typeof content !== "string" ||
            !content.trim() ||
            content.length > 4096
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid message content"
            });
        }

        if (
            typeof clientRequestId !== "string" ||
            !uuidRegex.test(clientRequestId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid clientRequestId"
            });
        }

        const result = await messageService.sendMessage({
            conversationId,
            content: content.trim(),
            clientRequestId,
            sentByUserId: req.user.id
        });

        if (!result.duplicate && result.message) {
            sseService.broadcast("message_updated", {
                conversationId,
                messageId: result.message.id,
                status: result.message.status
            });
        }

        return res.status(202).json({
            success: true,
            data: result.message,
            duplicate: result.duplicate,
            outcomeUnknown: result.outcomeUnknown || false
        });

    } catch (error) {
        console.error("Send message error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Internal server error"
        });
    }
};

const sendAttachment = async (req, res) => {
    try {
        const id = req.params.id || req.params.conversationId;

        const { content = "", clientRequestId } = req.body;

        const result = await messageService.sendAttachment({
            conversationId: id,
            content,
            clientRequestId,
            sentByUserId: req.user.id,
            file: req.file
        });

        if (!result.duplicate && result.message) {
            sseService.broadcast("message_updated", {
                conversationId: id,
                messageId: result.message.id,
                status: result.message.status
            });
        }

        return res.status(
            result.duplicate ? 200 : 202
        ).json({
            success: true,
            data: result.message,
            attachmentId: result.attachmentId,
            duplicate: result.duplicate,
            outcomeUnknown: false
        });

    } catch (error) {
        console.error("Send attachment error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Internal server error"
        });
    }
};

const sendMessageKafka = async (req, res) => {
    try {
        const id = req.params.id || req.params.conversationId;

        const {
            content,
            clientRequestId
        } = req.body;

        const result =
            await messageService.sendMessageWithKafka({
                conversationId: id,
                content,
                clientRequestId,
                sentByUserId: req.user.id
            });

        return res.status(
            result.duplicate ? 200 : 202
        ).json({
            success: true,
            data: result.message,
            duplicate: result.duplicate
        });

    } catch (error) {
        console.error('Send Message Kafka Error:', error);

        return res.status(
            error.statusCode || 500
        ).json({
            success: false,
            message: error.statusCode
                ? error.message
                : 'Internal server error'
        });
    }
};

module.exports = {
    getMessage,
    sendMessage,
    sendMessageKafka,
    sendAttachment
};
