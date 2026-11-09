require('dotenv').config();

const {
    startRetryScheduler,
    stopRetryScheduler
} = require('./retry-scheduler.worker');

const start = async () => {
    try {
        await startRetryScheduler();
    } catch (error) {
        console.error('Start Retry Scheduler Error:', error);
        process.exitCode = 1;
    }
};

const shutdown = () => {
    stopRetryScheduler();
    console.log('Stopping Retry Scheduler Worker...');
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

