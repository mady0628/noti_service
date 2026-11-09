const callChatService = async (path, data) => {
    try {
        const respone = await fetch(`${process.env.CHAT_SERVICE_URL}${path}`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "x-internal-api-key": process.env.INTERNAL_API_KEY
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(10000)
        });

        if (!respone.ok) {
            throw new Error(`Chat Service returned HTTP ${respone.status}`);
        }
        return await respone.json();
    } catch (error) {
        console.error("Chat Service request failed:", error);
        throw error;
    }
};

const registerAccount = async (data) => {
    return callChatService(
        "/internal/accounts/register",
        data
    );
};

const sendIncomingMessage = async (data) => {
    return callChatService(
        "/internal/messages/incoming",
        data
    );
};

const sendIncomingAttachment = async ({
    externalAccountId,
    chatId,
    externalMessageId,
    externalSenderId,
    displayName,
    username,
    chatType,
    messageType,
    caption,
    sentAt,
    externalFileId,
    file
}) => {
    const baseUrl = (process.env.CHAT_SERVICE_URL || "http://127.0.0.1:3002")
        .replace(/\/+$/, "");

    const form = new FormData();

    // Thông tin tài khoản và hội thoại
    form.append("externalAccountId", String(externalAccountId));
    form.append("externalChatId", String(chatId));
    form.append("externalMessageId", String(externalMessageId));
    form.append("externalSenderId", String(externalSenderId || ""));

    form.append("displayName", displayName || "");
    form.append("username", username || "");
    form.append("chatType", chatType || "private");

    // Thông tin message
    form.append("messageType", messageType);
    form.append("content", caption || "");
    form.append("sentAt", sentAt);

    // Telegram File ID
    form.append("externalFileId", externalFileId);

    // File thực tế
    form.append(
        "file",
        new Blob([file.buffer], {
            type: file.mimeType
        }),
        file.fileName
    );

    const response = await fetch(
        `${baseUrl}/internal/messages/incoming-attachment`,
        {
            method: "POST",
            headers: {
                "x-internal-api-key":
                    process.env.INTERNAL_API_KEY
            },
            body: form,
            signal: AbortSignal.timeout(60000)
        }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
        throw new Error(
            result.message ||
            `Chat Service error: ${response.status}`
        );
    }

    return result.data;
};

module.exports = {
    registerAccount,
    sendIncomingMessage,
    sendIncomingAttachment
};
