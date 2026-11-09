const kafka = require('./kafka.client');

const deliveryRepository = require(
    '../repositories/telegram-delivery.repository'
);

const consumer = kafka.consumer({
    groupId: 'chat-message-result-workers'
});

let connectPromise = null;

const connectConsumer = async () => {
    if (!connectPromise) {
        connectPromise = consumer.connect().catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    await connectPromise;
};

const notifyMessageUpdated = async (data) => {
    const baseUrl = (process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:3002')
        .replace(/\/+$/, '');

    const response = await fetch(
        `${baseUrl}/internal/events/message-updated`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-api-key':
                    process.env.INTERNAL_API_KEY
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(5000)
        }
    );

    if (!response.ok) {
        throw new Error(
            `SSE notification failed: ${response.status}`
        );
    }
};

const handleSendResult = async (data) => {
    if (
        !data.messageId ||
        !['sent', 'failed', 'unknown'].includes(data.status)
    ) {
        throw new Error('Invalid Telegram result event');
    }

    const result = await deliveryRepository.applyDeliveryResult(
        data
    );

    console.log(
        'Telegram result processed:',
        data.messageId,
        data.status
    );

    if (result.updated && result.message) {
        try {
            await notifyMessageUpdated({
                conversationId: result.message.conversation_id,
                messageId: result.message.id,
                status: result.message.status
            });
        } catch (error) {
            console.error('SSE notify failed:', error.message);
        }
    }

    return result;
};

const startResultConsumer = async () => {
    await connectConsumer();

    await consumer.subscribe({
        topic: 'telegram.message.result',
        fromBeginning: false
    });

    await consumer.run({
        autoCommit: false,

        eachMessage: async ({
            topic,
            partition,
            message
        }) => {
            const data = JSON.parse(
                message.value.toString()
            );

            await handleSendResult(data);

            await consumer.commitOffsets([
                {
                    topic,
                    partition,
                    offset: String(
                        BigInt(message.offset) + 1n
                    )
                }
            ]);
        }
    });
};

const disconnectConsumer = async () => {
    await consumer.disconnect();
    connectPromise = null;
};

module.exports = {
    connectConsumer,
    startResultConsumer,
    disconnectConsumer
};
