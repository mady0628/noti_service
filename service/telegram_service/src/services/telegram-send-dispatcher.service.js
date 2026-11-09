const {
    sendTextMessage,
    sendPhotoMessage,
    sendDocumentMessage
} = require('./telegram-message.service');

const {
    downloadAttachment
} = require('./attachment.service');

const sendTelegramMessage = async (data) => {
    const commonData = {
        externalAccountId: data.external_account_id,
        externalChatId: data.external_chat_id
    };

    // Tin nhắn text
    if (data.message_type === 'text') {
        return await sendTextMessage({
            ...commonData,
            content: data.content
        });
    }

    // Ảnh hoặc tài liệu
    if (
        data.message_type === 'image' ||
        data.message_type === 'document'
    ) {
        if (!data.attachment_id) {
            throw new Error('Attachment ID is required');
        }

        const buffer = await downloadAttachment({
            messageId: data.message_id,
            attachmentId: data.attachment_id
        });

        const attachmentData = {
            ...commonData,
            buffer,
            fileName: data.file_name,
            caption: data.content
        };

        if (data.message_type === 'image') {
            return await sendPhotoMessage(attachmentData);
        }

        return await sendDocumentMessage(attachmentData);
    }

    throw new Error(
        `Unsupported message type: ${data.message_type}`
    );
};

module.exports = {
    sendTelegramMessage
};

