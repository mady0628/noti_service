require('dotenv').config();

const {
    startIncomingConsumer,
    disconnectConsumer
} = require('./incoming.consumer');

const start = async () => {
    try {
        await startIncomingConsumer();
        console.log('Incoming Consumer started');
    } catch (error) {
        console.error('Incoming Consumer Error:', error);
        process.exitCode = 1;
    }
};

const shutdown = async () => {
    try {
        await disconnectConsumer();
    } catch (error) {
        console.error('Shutdown Error:', error);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

