const CHAT_SERVICE_URL = (process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:3002')
    .replace(/\/+$/, '');

const claimTelegramMessage = async (
    messageId,
    attemptGeneration = 1
) => {
    const response = await fetch(
        `${CHAT_SERVICE_URL}/internal/messages/${encodeURIComponent(messageId)}/claim-send`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-api-key':
                    process.env.INTERNAL_API_KEY
            },
            body: JSON.stringify({
                attemptGeneration
            }),
            signal: AbortSignal.timeout(10000)
        }
    );

    if (!response.ok) {
        throw new Error(
            `Claim API failed: ${response.status}`
        );
    }

    const result = await response.json();

    if (!result.success) {
        throw new Error('Cannot claim Telegram message');
    }

    return result.data;
};

const recordTelegramResult = async (data) => {
    const baseUrl = (process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:3002')
        .replace(/\/+$/, '');

    const response = await fetch(
        `${baseUrl}/internal/messages/delivery-result`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-api-key':
                    process.env.INTERNAL_API_KEY
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(10000)
        }
    );

    if (!response.ok) {
        throw new Error(
            `Record delivery result failed: ${response.status}`
        );
    }

    const result = await response.json();

    if (!result.success) {
        throw new Error('Cannot record delivery result');
    }

    return result.data;
};

module.exports = {
    claimTelegramMessage,
    recordTelegramResult
};

