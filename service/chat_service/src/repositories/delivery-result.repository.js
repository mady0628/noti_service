const crypto = require('node:crypto');
const pool = require('../config/database');

const MAX_RETRIES = 3;

const saveDeliveryResultWithOutbox = async (data) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const generation = Number(data.attemptGeneration);

        if (
            !Number.isSafeInteger(generation) ||
            generation < 1
        ) {
            const error = new Error('Invalid attempt generation');
            error.statusCode = 400;
            throw error;
        }

        const allowedStatuses = [
            'sent',
            'failed',
            'unknown',
            'retry_waiting'
        ];

        if (!allowedStatuses.includes(data.status)) {
            const error = new Error('Invalid result status');
            error.statusCode = 400;
            throw error;
        }

        // Khóa attempt để tránh kết quả xử lý đồng thời.
        const attemptResult = await client.query(
            `
            SELECT
                a.message_id,
                a.status,
                a.attempt_generation,
                a.retry_count,
                m.conversation_id
            FROM telegram_delivery_attempts a
            JOIN messages m ON m.id = a.message_id
            WHERE a.message_id = $1
            FOR UPDATE OF a
            `,
            [data.messageId]
        );

        const attempt = attemptResult.rows[0];

        if (!attempt) {
            const error = new Error('Delivery attempt not found');
            error.statusCode = 404;
            throw error;
        }

        // Không để kết quả của generation cũ
        // ghi đè generation đang hoạt động.
        if (attempt.attempt_generation !== generation) {
            const error = new Error('Stale attempt generation');
            error.statusCode = 409;
            throw error;
        }

        // Event lặp lại sau khi đã ghi trạng thái cuối.
        if (['sent', 'failed'].includes(attempt.status)) {
            if (attempt.status !== data.status) {
                const error = new Error('Conflicting result');
                error.statusCode = 409;
                throw error;
            }

            await client.query('COMMIT');

            return {
                duplicate: true,
                messageId: data.messageId
            };
        }

        // Retry chỉ được lên lịch từ attempt processing.
        if (data.status === 'retry_waiting') {
            if (attempt.status === 'retry_waiting') {
                await client.query('COMMIT');
                return {
                    duplicate: true,
                    messageId: data.messageId
                };
            }

            if (attempt.status !== 'processing') {
                const error = new Error('Invalid retry transition');
                error.statusCode = 409;
                throw error;
            }

            if (attempt.retry_count >= MAX_RETRIES) {
                await client.query(
                    `
                    UPDATE telegram_delivery_attempts
                    SET
                        status = 'failed',
                        completed_at = NOW(),
                        last_error = $2,
                        last_error_code = $3
                    WHERE message_id = $1
                    `,
                    [
                        data.messageId,
                        data.errorMessage || 'Maximum retry attempts reached',
                        data.errorCode || 'MAX_RETRIES_EXCEEDED'
                    ]
                );

                const payload = {
                    messageId: data.messageId,
                    attemptGeneration: generation,
                    status: 'failed',
                    errorMessage: data.errorMessage || 'Maximum retry attempts reached'
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
                    VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
                    `,
                    [
                        crypto.randomUUID(),
                        data.messageId,
                        'telegram.message.result',
                        String(data.messageId),
                        JSON.stringify(payload)
                    ]
                );

                await client.query('COMMIT');

                return {
                    duplicate: false,
                    retryScheduled: false,
                    maxRetriesReached: true,
                    messageId: data.messageId,
                    conversationId: attempt.conversation_id
                };
            }

            const delay = Number(data.retryAfterSeconds);

            if (
                !Number.isSafeInteger(delay) ||
                delay < 1 ||
                delay > 86400
            ) {
                const error = new Error('Invalid retry delay');
                error.statusCode = 400;
                throw error;
            }

            await client.query(
                `
                UPDATE telegram_delivery_attempts
                SET
                    status = 'retry_waiting',
                    retry_count = retry_count + 1,
                    next_retry_at =
                        NOW() + ($2::int * INTERVAL '1 second'),
                    queued_retry_generation = NULL,
                    completed_at = NOW(),
                    last_error = $3,
                    last_error_code = $4
                WHERE message_id = $1
                `,
                [
                    data.messageId,
                    delay,
                    data.errorMessage || 'Rate limited',
                    data.errorCode || 'RATE_LIMIT'
                ]
            );

            await client.query('COMMIT');

            return {
                duplicate: false,
                retryScheduled: true,
                messageId: data.messageId,
                conversationId: attempt.conversation_id
            };
        }

        // Các kết quả sent/failed/unknown.
        if (!['processing', 'unknown'].includes(attempt.status)) {
            const error = new Error('Invalid result transition');
            error.statusCode = 409;
            throw error;
        }

        if (data.status === 'sent' && (
            !data.externalMessageId || !data.sentAt
        )) {
            const error = new Error('Missing Telegram result');
            error.statusCode = 400;
            throw error;
        }

        if (
            attempt.status === 'unknown' &&
            data.status === 'unknown'
        ) {
            await client.query('COMMIT');

            return {
                duplicate: true,
                messageId: data.messageId
            };
        }

        await client.query(
            `
            UPDATE telegram_delivery_attempts
            SET
                status = $2,
                external_message_id = $3,
                telegram_sent_at = $4,
                completed_at = NOW(),
                last_error = $5,
                last_error_code = $6
            WHERE message_id = $1
            `,
            [
                data.messageId,
                data.status,
                data.externalMessageId || null,
                data.sentAt || null,
                data.errorMessage || null,
                data.errorCode || null
            ]
        );

        const payload = {
            messageId: data.messageId,
            attemptGeneration: generation,
            status: data.status,
            externalMessageId:
                data.externalMessageId || null,
            sentAt: data.sentAt || null,
            errorMessage: data.errorMessage || null
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
            VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
            `,
            [
                crypto.randomUUID(),
                data.messageId,
                'telegram.message.result',
                String(data.messageId),
                JSON.stringify(payload)
            ]
        );

        await client.query('COMMIT');

        return {
            duplicate: false,
            retryScheduled: false,
            messageId: data.messageId,
            conversationId: attempt.conversation_id
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    saveDeliveryResultWithOutbox
};
