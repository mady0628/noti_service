const pool = require('../config/database');

// Lấy và giữ quyền xử lý một batch event
const claimOutboxEvents = async (limit = 10) => {
    const result = await pool.query(
        `
        WITH selected AS (
            SELECT id
            FROM outbox_events
            WHERE (
                status = 'pending'
                AND next_attempt_at <= NOW()
            )
            OR (
                status = 'processing'
                AND locked_until < NOW()
            )
            ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
        )
        UPDATE outbox_events o
        SET
            status = 'processing',
            attempts = o.attempts + 1,
            locked_until = NOW() + INTERVAL '60 seconds',
            lock_token = (
                md5(random()::text || clock_timestamp()::text)
            )::uuid
        FROM selected
        WHERE o.id = selected.id
        RETURNING o.*
        `,
        [limit]
    );

    return result.rows;
};

// Kafka đã xác nhận publish
const markAsPublished = async (eventId, lockToken) => {
    const result = await pool.query(
        `
        UPDATE outbox_events
        SET
            status = 'published',
            published_at = NOW(),
            locked_until = NULL,
            lock_token = NULL,
            last_error = NULL
        WHERE id = $1
          AND lock_token = $2
          AND status = 'processing'
        RETURNING id
        `,
        [eventId, lockToken]
    );

    return result.rows[0] || null;
};

// Publish gặp lỗi: đưa event về pending
const markAsPending = async (
    eventId,
    lockToken,
    errorMessage,
    delaySeconds = 5
) => {
    const result = await pool.query(
        `
        UPDATE outbox_events
        SET
            status = 'pending',
            locked_until = NULL,
            lock_token = NULL,
            last_error = $3,
            next_attempt_at =
                NOW() + ($4::int * INTERVAL '1 second')
        WHERE id = $1
          AND lock_token = $2
          AND status = 'processing'
        RETURNING id
        `,
        [
            eventId,
            lockToken,
            errorMessage,
            delaySeconds
        ]
    );

    return result.rows[0] || null;
};

module.exports = {
    claimOutboxEvents,
    markAsPublished,
    markAsPending
};

