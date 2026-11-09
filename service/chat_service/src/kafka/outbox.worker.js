const pool = require("../config/database");
const { publishTelegramSend } = require("./producer");

let isRunning = false;
let workerTimer = null;

async function processOutboxBatch() {
    if (isRunning) return;
    isRunning = true;

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. SELECT pending events với FOR UPDATE SKIP LOCKED để tránh đụng độ giữa các worker
        const selectResult = await client.query(
            `
            SELECT id, aggregate_id, topic, event_key, payload, attempts
            FROM outbox_events
            WHERE status = 'pending'
            ORDER BY created_at ASC, id ASC
            LIMIT 50
            FOR UPDATE SKIP LOCKED
            `
        );

        const events = selectResult.rows;

        for (const event of events) {
            try {
                // 2. Publish sang Kafka
                await publishTelegramSend(event.payload);

                // 3. Đánh dấu published sau khi Kafka xác nhận
                await client.query(
                    `
                    UPDATE outbox_events
                    SET
                        status = 'published',
                        published_at = NOW(),
                        last_error = NULL
                    WHERE id = $1
                    `,
                    [event.id]
                );
            } catch (publishError) {
                console.error(`Failed to publish outbox event ${event.id}:`, publishError.message);

                // Giữ pending để thử lại, tăng attempts và ghi nhận lỗi
                await client.query(
                    `
                    UPDATE outbox_events
                    SET
                        attempts = attempts + 1,
                        last_error = $2
                    WHERE id = $1
                    `,
                    [event.id, publishError.message]
                );
            }
        }

        await client.query("COMMIT");

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Outbox worker batch error:", error.message);

    } finally {
        client.release();
        isRunning = false;
    }
}

function startOutboxWorker(intervalMs = 1000) {
    if (workerTimer) return;
    workerTimer = setInterval(processOutboxBatch, intervalMs);
    console.log(`Outbox worker started with interval ${intervalMs}ms`);
}

function stopOutboxWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}

module.exports = {
    processOutboxBatch,
    startOutboxWorker,
    stopOutboxWorker
};

