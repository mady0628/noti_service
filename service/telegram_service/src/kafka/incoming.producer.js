const kafka = require('./kafka.client');

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

const publishIncomingMessage = async (data) => {
    await connectProducer();

    await producer.send({
        topic: 'telegram.message.incoming',
        acks: -1,
        messages: [
            {
                key: `${data.externalAccountId}:${data.externalChatId}`,
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
    publishIncomingMessage,
    disconnectProducer
};

