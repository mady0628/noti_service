require('dotenv').config();

const {
    startOutboxWorker,
    stopOutboxWorker,
    disconnectProducer
} = require('./outbox.worker');

const start = async () => {
    try {
        await startOutboxWorker();
    } catch (error) {
        console.error('Start Outbox Worker Error:', error);
        process.exitCode = 1;
    }
};

const shutdown = async () => {
    stopOutboxWorker();

    console.log('Stopping Outbox Worker...');
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().finally(async () => {
    await disconnectProducer();
});

