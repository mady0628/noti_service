const messageService = require("../services/telegram-message.service");

const sendMessage = async (req, res) => {
    try {
        const { chatId, content, externalAccountId } = req.body;

        if (
            typeof chatId !== "string" ||
            !chatId.trim() ||
            typeof content !== "string" ||
            !content.trim() ||
            content.length > 4096
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid message input"
            });
        }

        const result = await messageService.sendMessage(chatId, content, externalAccountId);
        return res.status(201).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Send message error:", error);

        return res.status(error.statusCode || 502).json({
            success: false,
            message: error.message || "Telegram send failed"
        });
    }
};

const sendAttachment = async (req, res) => {
    try {
        const {
            chatId,
            caption,
            messageType,
            externalAccountId
        } = req.body;

        const file = req.file;

        if (
            typeof chatId !== "string" ||
            !/^-?\d+$/.test(chatId) ||
            !file ||
            !["image", "document"].includes(messageType)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid attachment data"
            });
        }

        if (
            caption &&
            (typeof caption !== "string" ||
                caption.length > 1024)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid caption"
            });
        }

        let result;

        if (messageType === "image") {
            if (!file.mimetype.startsWith("image/")) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid image"
                });
            }

            result = await messageService.sendPhoto(
                chatId,
                file.buffer,
                file.originalname,
                caption,
                externalAccountId
            );

        } else {
            result = await messageService.sendDocument(
                chatId,
                file.buffer,
                file.originalname,
                caption,
                externalAccountId
            );
        }

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Send attachment error:", error);

        return res.status(error.statusCode || 502).json({
            success: false,
            message: error.message || "Failed to send Telegram attachment"
        });
    }
};

module.exports = { sendMessage, sendAttachment };
