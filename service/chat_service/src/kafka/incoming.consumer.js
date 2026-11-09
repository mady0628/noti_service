const kafka = require('./kafka.client');

const consumer = kafka.consumer({
    groupId: 'chat-incoming-workers'
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

const processIncomingMessage = async (data) => {
    const baseUrl = (process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:3002')
        .replace(/\/+$/, '');

    const normalizedData = {
        eventId: String(data.eventId || data.externalEventId),
        externalEventId: String(data.externalEventId || data.eventId),
        channel: data.channel || 'TELEGRAM',
        externalAccountId: String(data.externalAccountId),
        externalChatId: String(data.externalChatId),
        externalMessageId: String(data.externalMessageId),
        externalSenderId: String(data.externalSenderId || data.externalChatId),
        content: String(data.content || ''),
        sentAt: data.sentAt || new Date().toISOString(),
        displayName: data.displayName || null,
        username: data.username || null,
        chatType: data.chatType || 'private',
        payload: data.payload || {}
    };

    const response = await fetch(
        `${baseUrl}/internal/messages/incoming`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-api-key':
                    process.env.INTERNAL_API_KEY
            },
            body: JSON.stringify(normalizedData),
            signal: AbortSignal.timeout(10000)
        }
    );

    if (!response.ok) {
        throw new Error(
            `Incoming API failed: ${response.status}`
        );
    }
};

const startIncomingConsumer = async () => {
    await connectConsumer();

    await consumer.subscribe({
        topic: 'telegram.message.incoming',
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

            await processIncomingMessage(data);

            await consumer.commitOffsets([
                {
                    topic,
                    partition,
                    offset: String(
                        BigInt(message.offset) + 1n
                    )
                }
            ]);

            console.log(
                'Incoming message processed:',
                data.eventId
            );
        }
    });
};

const disconnectConsumer = async () => {
    await consumer.disconnect();
    connectPromise = null;
};

module.exports = {
    startIncomingConsumer,
    disconnectConsumer,
    processIncomingMessage
};

