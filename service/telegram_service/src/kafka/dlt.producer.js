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

const publishToDLT = async (data) => {
    await connectProducer();

    await producer.send({
        topic: 'telegram.message.dlt',
        acks: -1,
        messages: [
            {
                key: String(data.messageId),
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
    publishToDLT,
    disconnectProducer
};

