const crypto = require('node:crypto');

const pool = require('../config/database');

const scheduleDueRetries = async (limit = 10) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Khóa các attempt đã đến hạn retry
        const result = await client.query(
            `
            SELECT
                a.message_id,
                a.attempt_generation,
                m.conversation_id
            FROM telegram_delivery_attempts a
            JOIN messages m
                ON m.id = a.message_id
            WHERE a.status = 'retry_waiting'
              AND a.next_retry_at <= NOW()
              AND a.queued_retry_generation IS NULL
              AND m.status = 'pending'
            ORDER BY a.next_retry_at, a.message_id
            FOR UPDATE OF a SKIP LOCKED
            LIMIT $1
            `,
            [limit]
        );

        // 2. Ghi Retry Command vào Outbox
        for (const item of result.rows) {
            const nextGeneration =
                item.attempt_generation + 1;

            const payload = {
                messageId: item.message_id,
                conversationId: item.conversation_id,
                attemptGeneration: nextGeneration
            };

            await client.query(
                `
                INSERT INTO outbox_events (
                    id,
                    aggregate_id,
                    topic,
                    event_key,
                    payload,
                    status
                )
                VALUES (
                    $1, $2, $3, $4, $5::jsonb, 'pending'
                )
                ON CONFLICT DO NOTHING
                `,
                [
                    crypto.randomUUID(),
                    item.message_id,
                    'telegram.message.send',
                    String(item.conversation_id),
                    JSON.stringify(payload)
                ]
            );

            // 3. Đánh dấu đã đưa retry vào Outbox
            await client.query(
                `
                UPDATE telegram_delivery_attempts
                SET queued_retry_generation = $2
                WHERE message_id = $1
                  AND status = 'retry_waiting'
                `,
                [
                    item.message_id,
                    nextGeneration
                ]
            );
        }

        await client.query('COMMIT');

        return result.rows.length;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};

module.exports = {
    scheduleDueRetries
};

