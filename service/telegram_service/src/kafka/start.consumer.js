require('dotenv').config();

const {
    startSendConsumer,
    disconnectConsumer
} = require('./send.consumer');

const start = async () => {
    try {
        await startSendConsumer();
        console.log('Telegram Kafka Consumer started');
    } catch (error) {
        console.error('Start Consumer Error:', error);
        process.exit(1);
    }
};

const shutdown = async () => {
    try {
        await disconnectConsumer();
        process.exit(0);
    } catch (error) {
        console.error('Shutdown Error:', error);
        process.exit(1);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
