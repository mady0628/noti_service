const {
    preparePhoto,
    prepareDocument
} = require("../services/telegram-attachment.service");

const {
    sendIncomingAttachment
} = require("../services/chat-client.service");

const getDisplayName = (from) => {
    if (!from) return "Unknown";

    return [
        from.first_name,
        from.last_name
    ]
        .filter(Boolean)
        .join(" ") || from.username || "Unknown";
};

const handleAttachment = async (bot, ctx, externalAccountId) => {
    const message = ctx.message;

    if (!message) return;

    try {
        let attachment;

        // 1. Nhận diện ảnh
        if (message.photo) {
            attachment = await preparePhoto(
                bot,
                message
            );
        }

        // 2. Nhận diện tài liệu
        else if (message.document) {
            attachment = await prepareDocument(
                bot,
                message
            );
        }

        else {
            return;
        }

        const chat = message.chat;
        const sender = message.from;

        // 3. Chuẩn hóa dữ liệu
        const payload = {
            externalAccountId,

            chatId: chat.id,
            externalMessageId: message.message_id,
            externalSenderId: sender?.id,

            displayName: chat.title || getDisplayName(sender),
            username: sender?.username || chat.username || "",
            chatType: chat.type,

            messageType: attachment.messageType,
            caption: attachment.caption,

            sentAt: new Date(
                message.date * 1000
            ).toISOString(),

            externalFileId: attachment.externalFileId,

            file: {
                buffer: attachment.buffer,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType
            }
        };

        // 4. Gửi sang Chat Service
        const result = await sendIncomingAttachment(payload);

        console.log(
            "Incoming attachment processed:",
            result?.messageId || result
        );

        return result;

    } catch (error) {
        console.error(
            "Handle Telegram attachment error:",
            error.message
        );

        throw error;
    }
};

module.exports = {
    handleAttachment
};
