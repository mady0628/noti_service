require('dotenv').config();

const {
    startReconciliationWorker,
    stopReconciliationWorker
} = require('./delivery-reconciliation.worker');

const start = async () => {
    try {
        await startReconciliationWorker();
    } catch (error) {
        console.error('Start Reconciliation Worker Error:', error);
        process.exitCode = 1;
    }
};

const shutdown = () => {
    stopReconciliationWorker();
    console.log('Stopping Reconciliation Worker...');
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

