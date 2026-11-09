const kafka = require('../kafka/kafka.client');

const producer = kafka.producer();

let connectPromise = null;

const connectProducer = async () => {
    if (!connectPromise) {
        connectPromise = producer.connect().catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    await connectPromise;
};

// Publish event tổng quát từ Outbox
const publishOutboxEvent = async (event) => {
    await connectProducer();

    await producer.send({
        topic: event.topic,
        acks: -1,
        messages: [
            {
                key: String(event.event_key),
                value: JSON.stringify(event.payload),
                headers: {
                    eventId: String(event.id),
                    eventType: 'telegram.message.send'
                }
            }
        ]
    });
};

// Giữ để tương thích với code test trước
const publishTelegramSend = async (data) => {
    await connectProducer();

    await producer.send({
        topic: 'telegram.message.send',
        acks: -1,
        messages: [
            {
                key: String(data.conversationId),
                value: JSON.stringify(data)
            }
        ]
    });
};

const disconnectProducer = async () => {
    if (!connectPromise) return;

    await connectPromise;
    await producer.disconnect();

    connectPromise = null;
};

module.exports = {
    connectProducer,
    publishOutboxEvent,
    publishTelegramSend,
    disconnectProducer
};
