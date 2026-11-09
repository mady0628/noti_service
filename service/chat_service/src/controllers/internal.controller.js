const fs = require('node:fs');
const path = require('node:path');
const chatService = require('../services/chat.service');
const messageService = require('../services/message.service');
const sseService = require('../services/sse.service');
const telegramDeliveryRepository = require('../repositories/telegram-delivery.repository');
const deliveryResultRepository = require('../repositories/delivery-result.repository');
const attachmentRepository = require('../repositories/attachment.repository');

const STORAGE_ROOT = path.resolve(
    process.cwd(),
    'storage',
    'attachments'
);

const registerBotAccount = async (req, res) => {
    try {
        const data = req.body;
        if (
            typeof data?.channel !== 'string' ||
            typeof data?.externalAccountId !== 'string' ||
            !data.channel.trim() || !data.externalAccountId.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid account data'
            })
        }

        const result = await chatService.registerChannelAccount(data);
        return res.status(201).json({
            success: true,
            data: result
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

const receiveIncomingMessage = async (req, res) => {
    try {
        const data = req.body;

        const fields = [
            "eventId",
            "channel",
            "externalAccountId",
            "externalChatId",
            "externalMessageId",
            "externalSenderId",
            "content",
            "sentAt"
        ];

        const invalid = fields.some((field) =>
            typeof data?.[field] !== "string" ||
            data[field].trim() === ""
        );

        if (invalid) {
            return res.status(400).json({
                success: false,
                message: "Invalid message data"
            });
        }

        const result = await chatService.saveTelegramMessage({
            ...data,
            displayName: data.displayName || null,
            username: data.username || null,
            chatType: data.chatType || null
        });

        if (result.created && result.message) {
            sseService.broadcast("new_message", {
                conversationId: result.conversationId,
                messageId: result.message.id,
                direction: "incoming"
            });
        }

        return res.status(result.created ? 201 : 200).json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

const receiveIncomingAttachment = async (req, res) => {
    try {
        const {
            externalAccountId,
            externalChatId,
            externalMessageId,
            externalSenderId,
            displayName,
            username,
            chatType,
            messageType,
            content,
            sentAt,
            externalFileId
        } = req.body;

        const file = req.file;

        // 1. Kiểm tra dữ liệu bắt buộc
        if (
            !externalAccountId ||
            !externalChatId ||
            !externalMessageId ||
            !externalFileId ||
            !file
        ) {
            return res.status(400).json({
                success: false,
                message: "Missing attachment data"
            });
        }

        // 2. Kiểm tra loại message
        if (!["image", "document"].includes(messageType)) {
            return res.status(400).json({
                success: false,
                message: "Invalid message type"
            });
        }

        // 3. Kiểm tra thời gian
        const date = new Date(sentAt);

        if (!sentAt || !Number.isFinite(date.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid sentAt"
            });
        }

        // 4. Chuẩn hóa payload
        const result = await messageService.saveIncomingAttachment({
            externalAccountId,
            externalChatId,
            externalMessageId,
            externalSenderId,
            displayName,
            username,
            chatType,
            messageType,
            content: content || "",
            sentAt: date,
            externalFileId,

            file: {
                buffer: file.buffer,
                fileName: file.originalname,
                mimetype: file.mimetype
            }
        });

        return res.status(result.duplicate ? 200 : 201).json({
            success: true,
            data: {
                conversationId: result.conversationId,
                messageId: result.message?.id || null,
                attachmentId: result.attachment?.id || null,
                duplicate: result.duplicate
            }
        });

    } catch (error) {
        console.error(
            "Receive attachment error:",
            error.message
        );

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Failed to save incoming attachment"
        });
    }
};

const claimTelegramMessage = async (req, res) => {
    try {
        const { messageId } = req.params;

        const attemptGeneration = Number(
            req.body?.attemptGeneration ?? 1
        );

        if (
            !Number.isSafeInteger(attemptGeneration) ||
            attemptGeneration < 1
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid attemptGeneration'
            });
        }

        const result = attemptGeneration === 1
            ? await telegramDeliveryRepository.claimMessage(messageId)
            : await telegramDeliveryRepository.claimRetryMessage({
                messageId,
                attemptGeneration
            });

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Claim Error:', error);

        return res.status(500).json({
            success: false,
            message: 'Failed to claim message'
        });
    }
};

const notifyMessageUpdated = async (req, res) => {
    try {
        const {
            conversationId,
            messageId,
            status
        } = req.body;

        if (
            !conversationId ||
            !messageId ||
            !['sent', 'failed', 'pending'].includes(status)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid event data'
            });
        }

        sseService.broadcast('message_updated', {
            conversationId,
            messageId,
            status
        });

        return res.status(200).json({
            success: true
        });

    } catch (error) {
        console.error('SSE notification error:', error);

        return res.status(500).json({
            success: false,
            message: 'Failed to notify clients'
        });
    }
};

const recordTelegramResult = async (req, res) => {
    try {
        const {
            messageId,
            attemptGeneration,
            status,
            externalMessageId,
            sentAt,
            errorCode,
            errorMessage,
            retryAfterSeconds
        } = req.body;

        if (
            !messageId ||
            !['sent', 'failed', 'unknown', 'retry_waiting'].includes(status)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid delivery result'
            });
        }

        const result =
            await deliveryResultRepository.saveDeliveryResultWithOutbox({
                messageId,
                attemptGeneration: Number(attemptGeneration ?? 1),
                status,
                externalMessageId,
                sentAt,
                errorCode,
                errorMessage,
                retryAfterSeconds
            });

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error(
            'Record Telegram Result Error:',
            error.message
        );

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : 'Failed to record delivery result'
        });
    }
};

const downloadInternalAttachment = async (req, res) => {
    try {
        const {
            messageId,
            attachmentId
        } = req.params;

        const attachment =
            await attachmentRepository.findAttachmentForTelegram(
                messageId,
                attachmentId
            );

        if (!attachment) {
            return res.status(404).json({
                success: false,
                message: 'Attachment not found'
            });
        }

        const storageKey = attachment.storage_key;

        if (
            !storageKey ||
            path.isAbsolute(storageKey) ||
            storageKey.split(/[\\/]/).includes('..')
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid storage key'
            });
        }

        const filePath = path.resolve(
            STORAGE_ROOT,
            storageKey
        );

        if (!filePath.startsWith(STORAGE_ROOT + path.sep)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid file path'
            });
        }

        const fileStream = fs.createReadStream(filePath);

        fileStream.on('error', (error) => {
            console.error('Attachment stream error:', error);

            if (!res.headersSent) {
                res.status(404).json({
                    success: false,
                    message: 'Attachment file unavailable'
                });
            } else {
                res.destroy(error);
            }
        });

        res.setHeader(
            'Content-Type',
            attachment.mime_type || 'application/octet-stream'
        );

        res.setHeader(
            'Content-Disposition',
            'attachment'
        );

        fileStream.pipe(res);

    } catch (error) {
        console.error(
            'Download Internal Attachment Error:',
            error
        );

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
};

module.exports = {
    registerBotAccount,
    receiveIncomingMessage,
    receiveIncomingAttachment,
    claimTelegramMessage,
    notifyMessageUpdated,
    recordTelegramResult,
    downloadInternalAttachment
};
