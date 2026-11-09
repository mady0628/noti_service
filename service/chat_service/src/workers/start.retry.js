require('dotenv').config();

const {
    startRetryWorker,
    stopRetryWorker
} = require('./retry.worker');

process.on('SIGINT', () => {
    stopRetryWorker();
});

process.on('SIGTERM', () => {
    stopRetryWorker();
});

startRetryWorker().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

