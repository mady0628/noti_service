const crypto = require('node:crypto');
const pool = require('../config/database');

let running = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const scheduleRetries = async () => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Tìm các attempt quá số lần retry (retry_count >= 3)
        const exhausted = await client.query(
            `
            UPDATE telegram_delivery_attempts
            SET
                status = 'failed',
                completed_at = NOW(),
                last_error = 'Retry limit exceeded (max 3)'
            WHERE status = 'retry_waiting'
              AND retry_count >= 3
            RETURNING message_id
            `
        );

        for (const row of exhausted.rows) {
            // Cập nhật messages.status = failed
            await client.query(
                `
                UPDATE messages
                SET
                    status = 'failed',
                    error_message = 'Telegram send failed after 3 retries',
                    updated_at = NOW()
                WHERE id = $1 AND status = 'pending'
                `,
                [row.message_id]
            );

            // Ghi outbox DLT event để theo dõi
            await client.query(
                `
                INSERT INTO outbox_events (
                    id, aggregate_id, topic, event_key, payload, status
                ) VALUES ($1, $2, 'telegram.message.dlt', $3, $4::jsonb, 'pending')
                `,
                [
                    crypto.randomUUID(),
                    row.message_id,
                    String(row.message_id),
                    JSON.stringify({
                        messageId: row.message_id,
                        sourceTopic: 'telegram.message.send',
                        errorCode: 'RETRY_LIMIT_EXCEEDED',
                        reason: 'Max retries (3) reached',
                        failedAt: new Date().toISOString()
                    })
                ]
            );
        }

        // 2. Tìm các attempt đã đến lúc thử lại (retry_count < 3 và next_retry_at <= NOW())
        const readyAttempts = await client.query(
            `
            SELECT
                a.message_id,
                a.retry_count,
                m.content,
                m.conversation_id,
                c.external_chat_id,
                ca.external_account_id
            FROM telegram_delivery_attempts a
            JOIN messages m ON m.id = a.message_id
            JOIN conversations c ON c.id = m.conversation_id
            JOIN channel_accounts ca ON ca.id = c.channel_account_id
            WHERE a.status = 'retry_waiting'
              AND a.next_retry_at <= NOW()
              AND a.retry_count < 3
            FOR UPDATE OF a SKIP LOCKED
            LIMIT 10
            `
        );

        for (const row of readyAttempts.rows) {
            // Đưa attempt về processing cho lần retry mới
            await client.query(
                `
                UPDATE telegram_delivery_attempts
                SET
                    status = 'processing',
                    started_at = NOW(),
                    completed_at = NULL,
                    next_retry_at = NULL
                WHERE message_id = $1
                `,
                [row.message_id]
            );

            // Tạo Outbox event để publish lại vào telegram.message.send
            const payload = {
                messageId: row.message_id,
                conversationId: row.conversation_id,
                externalAccountId: row.external_account_id,
                externalChatId: row.external_chat_id,
                messageType: 'text',
                content: row.content,
                retryCount: row.retry_count
            };

            await client.query(
                `
                INSERT INTO outbox_events (
                    id, aggregate_id, topic, event_key, payload, status
                ) VALUES ($1, $2, 'telegram.message.send', $3, $4::jsonb, 'pending')
                `,
                [
                    crypto.randomUUID(),
                    row.message_id,
                    String(row.conversation_id),
                    JSON.stringify(payload)
                ]
            );
        }

        await client.query('COMMIT');

        return readyAttempts.rowCount + exhausted.rowCount;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const startRetryScheduler = async () => {
    running = true;
    console.log('Retry Scheduler Worker started');

    while (running) {
        try {
            await scheduleRetries();
        } catch (error) {
            console.error('Retry Scheduler error:', error.message);
        }
        await sleep(5000);
    }
};

const stopRetryScheduler = () => {
    running = false;
};

module.exports = {
    scheduleRetries,
    startRetryScheduler,
    stopRetryScheduler
};

