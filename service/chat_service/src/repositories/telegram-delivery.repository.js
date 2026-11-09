const pool = require('../config/database');

const claimMessage = async (messageId) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Chỉ cho phép một lần claim cho mỗi message cho lần gửi đầu tiên (generation 1).
        const result = await client.query(
            `
            INSERT INTO telegram_delivery_attempts (
                message_id,
                status,
                attempt_generation
            )
            SELECT
                m.id,
                'processing',
                1
            FROM messages m
            JOIN conversations c
                ON c.id = m.conversation_id
            JOIN channel_accounts ca
                ON ca.id = c.channel_account_id
            JOIN channels ch
                ON ch.id = ca.channel_id
            WHERE m.id = $1
              AND m.direction = 'outgoing'
              AND m.status = 'pending'
              AND m.message_type IN ('text', 'image', 'document')
              AND ch.code = 'TELEGRAM'
              AND ca.is_active = TRUE
              AND ch.is_active = TRUE
            ON CONFLICT (message_id)
            DO NOTHING
            RETURNING message_id
            `,
            [messageId]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');

            return {
                claimed: false,
                data: null
            };
        }

        // Lấy nội dung gửi từ DB thay vì tin hoàn toàn
        // vào dữ liệu trong Kafka command.
        const messageResult = await client.query(
            `
            SELECT
                m.id AS message_id,
                m.message_type,
                m.content,
                m.conversation_id,
                c.external_chat_id,
                ca.external_account_id,
                a.id AS attachment_id,
                a.file_name,
                a.mime_type
            FROM messages m
            JOIN conversations c
                ON c.id = m.conversation_id
            JOIN channel_accounts ca
                ON ca.id = c.channel_account_id
            LEFT JOIN LATERAL (
                SELECT
                    id,
                    file_name,
                    mime_type
                FROM message_attachments
                WHERE message_id = m.id
                ORDER BY created_at, id
                LIMIT 1
            ) a ON TRUE
            WHERE m.id = $1
            `,
            [messageId]
        );

        await client.query('COMMIT');

        return {
            claimed: true,
            data: messageResult.rows[0],
            attemptGeneration: 1
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};

const claimRetryMessage = async ({
    messageId,
    attemptGeneration
}) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `
            UPDATE telegram_delivery_attempts
            SET
                status = 'processing',
                attempt_generation = $2,
                queued_retry_generation = NULL,
                started_at = NOW(),
                completed_at = NULL,
                next_retry_at = NULL,
                last_error = NULL
            WHERE message_id = $1
              AND status = 'retry_waiting'
              AND queued_retry_generation = $2
              AND attempt_generation = $2 - 1
              AND next_retry_at <= NOW()
            RETURNING message_id
            `,
            [
                messageId,
                attemptGeneration
            ]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');

            return {
                claimed: false,
                data: null
            };
        }

        const messageResult = await client.query(
            `
            SELECT
                m.id AS message_id,
                m.message_type,
                m.content,
                m.conversation_id,
                c.external_chat_id,
                ca.external_account_id,
                a.id AS attachment_id,
                a.file_name,
                a.mime_type
            FROM messages m
            JOIN conversations c
                ON c.id = m.conversation_id
            JOIN channel_accounts ca
                ON ca.id = c.channel_account_id
            JOIN channels ch
                ON ch.id = ca.channel_id
            LEFT JOIN LATERAL (
                SELECT
                    id,
                    file_name,
                    mime_type
                FROM message_attachments
                WHERE message_id = m.id
                ORDER BY created_at, id
                LIMIT 1
            ) a ON TRUE
            WHERE m.id = $1
              AND m.status = 'pending'
              AND m.direction = 'outgoing'
              AND m.message_type IN ('text', 'image', 'document')
              AND ch.code = 'TELEGRAM'
              AND ca.is_active = TRUE
              AND ch.is_active = TRUE
            `,
            [messageId]
        );

        if (!messageResult.rows[0]) {
            throw new Error('Message is not eligible for retry');
        }

        await client.query('COMMIT');

        return {
            claimed: true,
            data: messageResult.rows[0],
            attemptGeneration
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};

const scheduleRetry = async ({
    messageId,
    attemptGeneration,
    retryAfterSeconds,
    errorCode,
    errorMessage
}) => {
    const delay = Math.max(
        1,
        Math.ceil(Number(retryAfterSeconds))
    );

    if (!Number.isFinite(delay)) {
        throw new Error('Invalid retry delay');
    }

    const result = await pool.query(
        `
        UPDATE telegram_delivery_attempts
        SET
            status = 'retry_waiting',
            retry_count = retry_count + 1,
            next_retry_at =
                NOW() + ($3::int * INTERVAL '1 second'),
            queued_retry_generation = NULL,
            last_error_code = $4,
            last_error = $5,
            completed_at = NOW()
        WHERE message_id = $1
          AND attempt_generation = $2
          AND status = 'processing'
          AND retry_count < 3
        RETURNING *
        `,
        [
            messageId,
            attemptGeneration,
            delay,
            errorCode,
            errorMessage
        ]
    );

    return result.rows[0] || null;
};

const saveDeliveryResult = async (data) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const attemptResult = await client.query(
            `
            SELECT status
            FROM telegram_delivery_attempts
            WHERE message_id = $1
            FOR UPDATE
            `,
            [data.messageId]
        );

        if (attemptResult.rowCount === 0) {
            throw new Error('Delivery attempt not found');
        }

        const currentStatus = attemptResult.rows[0].status;

        // Chỉ cập nhật attempt đang xử lý hoặc unknown.
        // Event trùng hoặc event cũ không ghi đè kết quả cuối.
        if (
            currentStatus === 'sent' ||
            currentStatus === 'failed'
        ) {
            await client.query('COMMIT');

            return {
                updated: false,
                duplicate: true
            };
        }

        if (!['sent', 'failed', 'unknown'].includes(data.status)) {
            throw new Error('Invalid delivery status');
        }

        // Không cho unknown ghi đè kết quả có độ tin cậy cao hơn.
        if (
            currentStatus === 'unknown' &&
            data.status === 'unknown'
        ) {
            await client.query('COMMIT');

            return {
                updated: false,
                duplicate: true
            };
        }

        await client.query(
            `
            UPDATE telegram_delivery_attempts
            SET
                status = $2,
                completed_at = NOW(),
                last_error = $3
            WHERE message_id = $1
            `,
            [
                data.messageId,
                data.status,
                data.errorMessage || null
            ]
        );

        let messageResult;

        if (data.status === 'sent') {
            if (
                !data.externalMessageId ||
                !data.sentAt
            ) {
                throw new Error('Missing Telegram result');
            }

            messageResult = await client.query(
                `
                UPDATE messages
                SET
                    status = 'sent',
                    external_message_id = $2,
                    sent_at = $3,
                    error_message = NULL,
                    updated_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                RETURNING id, conversation_id, status
                `,
                [
                    data.messageId,
                    data.externalMessageId,
                    data.sentAt
                ]
            );

        } else if (data.status === 'failed') {
            messageResult = await client.query(
                `
                UPDATE messages
                SET
                    status = 'failed',
                    error_message = $2,
                    updated_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                RETURNING id, conversation_id, status
                `,
                [
                    data.messageId,
                    data.errorMessage || 'Telegram rejected request'
                ]
            );

        } else {
            // Unknown: giữ messages.status = pending
            messageResult = await client.query(
                `
                SELECT id, conversation_id, status
                FROM messages
                WHERE id = $1
                `,
                [data.messageId]
            );
        }

        if (messageResult.rowCount === 0) {
            throw new Error('Message state conflict');
        }

        await client.query('COMMIT');

        return {
            updated: true,
            duplicate: false,
            message: messageResult.rows[0],
            deliveryStatus: data.status
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};

const applyDeliveryResult = async (data) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const attemptResult = await client.query(
            `
            SELECT
                status,
                attempt_generation,
                external_message_id,
                telegram_sent_at
            FROM telegram_delivery_attempts
            WHERE message_id = $1
            `,
            [data.messageId]
        );

        const attempt = attemptResult.rows[0];

        if (!attempt) {
            throw new Error('Delivery attempt not found');
        }

        // Kiểm tra generation: không cho phép generation cũ cập nhật
        if (
            data.attemptGeneration !== undefined &&
            attempt.attempt_generation !== Number(data.attemptGeneration)
        ) {
            console.warn(
                `Stale result ignored in applyDeliveryResult: message ${data.messageId}, current gen ${attempt.attempt_generation}, event gen ${data.attemptGeneration}`
            );
            await client.query('COMMIT');
            return {
                updated: false,
                stale: true
            };
        }

        // Kafka result phải khớp với kết quả đã được
        // ghi bền vững trong delivery attempt.
        if (attempt.status !== data.status) {
            throw new Error('Delivery result mismatch');
        }

        let result;

        if (data.status === 'sent') {
            if (!data.externalMessageId || !data.sentAt) {
                throw new Error('Missing Telegram result data');
            }

            result = await client.query(
                `
                UPDATE messages
                SET
                    status = 'sent',
                    external_message_id = $2,
                    sent_at = $3,
                    error_message = NULL,
                    updated_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                RETURNING id, conversation_id, status
                `,
                [
                    data.messageId,
                    data.externalMessageId,
                    data.sentAt
                ]
            );

        } else if (data.status === 'failed') {
            result = await client.query(
                `
                UPDATE messages
                SET
                    status = 'failed',
                    error_message = $2,
                    updated_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                RETURNING id, conversation_id, status
                `,
                [
                    data.messageId,
                    data.errorMessage || 'Telegram send failed'
                ]
            );

        } else {
            // Unknown: giữ messages.status = pending.
            // Không UPDATE vì chưa có kết quả chắc chắn.
            await client.query('COMMIT');

            return {
                updated: false,
                outcomeUnknown: true
            };
        }

        await client.query('COMMIT');

        return {
            updated: result.rowCount > 0,
            message: result.rows[0] || null
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    claimMessage,
    claimRetryMessage,
    scheduleRetry,
    saveDeliveryResult,
    applyDeliveryResult
};

