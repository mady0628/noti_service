require('dotenv').config();

const {
    startResultConsumer,
    disconnectConsumer
} = require('./result.consumer');

const start = async () => {
    try {
        await startResultConsumer();
        console.log('Chat Result Consumer started');
    } catch (error) {
        console.error('Result Consumer Error:', error);
        process.exitCode = 1;
    }
};

process.on('SIGINT', async () => {
    await disconnectConsumer();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await disconnectConsumer();
    process.exit(0);
});

start();

