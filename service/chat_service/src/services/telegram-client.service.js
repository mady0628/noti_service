const sendTelegramMessage = async (chatId, content, externalAccountId) => {
    const baseUrl = process.env.TELEGRAM_SERVICE_URL;

    const response = await fetch(`${baseUrl}/internal/messages/send`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-internal-api-key": process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({
            chatId,
            content,
            externalAccountId
        }),
        signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
        throw new Error(
            `Telegram Service returned HTTP ${response.status}`
        );
    }

    const result = await response.json();
    return result.data;
};

const sendTelegramAttachment = async ({
    chatId,
    externalAccountId,
    content,
    messageType,
    file
}) => {
    const baseUrl = process.env.TELEGRAM_SERVICE_URL
        .replace(/\/+$/, "");

    const form = new FormData();

    form.append("chatId", String(chatId));
    if (externalAccountId) {
        form.append("externalAccountId", String(externalAccountId));
    }
    form.append("caption", content || "");
    form.append("messageType", messageType);

    const blob = new Blob(
        [file.buffer],
        { type: file.mimetype }
    );

    form.append(
        "file",
        blob,
        file.originalname
    );

    const response = await fetch(
        `${baseUrl}/internal/messages/send-attachment`,
        {
            method: "POST",
            headers: {
                "x-internal-api-key":
                    process.env.INTERNAL_API_KEY
            },
            body: form,
            signal: AbortSignal.timeout(30000)
        }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
        throw new Error(
            result.message || "Telegram attachment failed"
        );
    }

    return result.data;
};

module.exports = { sendTelegramMessage, sendTelegramAttachment };
