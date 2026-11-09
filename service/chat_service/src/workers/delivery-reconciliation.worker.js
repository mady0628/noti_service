const pool = require('../config/database');

let running = false;

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const reconcileStaleAttempts = async () => {
    const result = await pool.query(
        `
        UPDATE telegram_delivery_attempts
        SET
            status = 'unknown',
            completed_at = NOW(),
            last_checked_at = NOW(),
            last_error = 'Processing timeout - manual review required'
        WHERE status = 'processing'
          AND started_at < NOW() - INTERVAL '5 minutes'
        RETURNING message_id
        `
    );

    if (result.rowCount > 0) {
        console.warn(
            `Found ${result.rowCount} stale delivery attempts`
        );
    }

    return result.rowCount;
};

const startReconciliationWorker = async () => {
    running = true;

    console.log('Delivery Reconciliation Worker started');

    while (running) {
        try {
            await reconcileStaleAttempts();
        } catch (error) {
            console.error(
                'Reconciliation error:',
                error.message
            );
        }

        await sleep(30000);
    }
};

const stopReconciliationWorker = () => {
    running = false;
};

module.exports = {
    reconcileStaleAttempts,
    startReconciliationWorker,
    stopReconciliationWorker
};

