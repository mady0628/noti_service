const crypto = require('node:crypto');
const pool = require("../config/database");

// 1. Tìm thông tin cuộc hội thoại theo id
const findConversationById = async (id) => {
    const result = await pool.query(
        `
        SELECT
            cv.id,
            cv.external_chat_id,
            cv.status,
            ca.id AS channel_account_id,
            ca.external_account_id,
            ch.code AS channel_code

        FROM conversations cv

        JOIN channel_accounts ca
            ON cv.channel_account_id = ca.id

        JOIN channels ch
            ON ca.channel_id = ch.id

        WHERE cv.id = $1
          AND ca.is_active = TRUE
          AND ch.is_active = TRUE
        `,
        [id]
    );

    return result.rows[0] || null;
};

// 2. Lấy danh sách tin nhắn theo cursor pagination (kèm danh sách attachments)
const findMessages = async (conversationId, limit, cursorDate = null, cursorId = null) => {
    const result = await pool.query(
        `
        SELECT
            m.id,
            m.conversation_id,
            m.external_message_id,
            m.external_sender_id,
            m.sent_by_user_id,
            m.direction,
            m.message_type,
            m.content,
            m.payload,
            m.status,
            m.sent_at,
            m.created_at,

            COALESCE(
                json_agg(
                    json_build_object(
                        'id', a.id,
                        'fileName', a.file_name,
                        'mimeType', a.mime_type,
                        'fileSize', a.file_size,
                        'storageKey', a.storage_key,
                        'externalFileId', a.external_file_id,
                        'url', '/api/attachments/' || a.id
                    )
                ) FILTER (WHERE a.id IS NOT NULL),
                '[]'
            ) AS attachments

        FROM messages m

        LEFT JOIN message_attachments a
            ON a.message_id = m.id

        WHERE m.conversation_id = $1
            AND ( $3::timestamptz IS NULL
                OR (m.created_at, m.id) < ($3::timestamptz, $4::uuid)
            )

        GROUP BY m.id

        ORDER BY m.created_at DESC, m.id DESC

        LIMIT $2
        `,
        [conversationId, limit, cursorDate, cursorId]
    );

    return result.rows;
};

// 3. Tạo message trạng thái pending (outgoing text)
const createPendingMessage = async (
    conversationId,
    content,
    clientRequestId,
    sentByUserId,
    messageType = "text"
) => {
    const result = await pool.query(
        `
        INSERT INTO messages (
            conversation_id,
            client_request_id,
            sent_by_user_id,
            direction,
            message_type,
            content,
            status
        )
        VALUES ($1, $2, $3, 'outgoing', $4, $5, 'pending')
        ON CONFLICT (client_request_id)
        WHERE client_request_id IS NOT NULL
        DO NOTHING
        RETURNING *
        `,
        [
            conversationId,
            clientRequestId,
            sentByUserId,
            messageType,
            content
        ]
    );

    return result.rows[0] || null;
};

// 4. Tạo cả Message và Attachment trong một transaction
const createPendingMessageWithAttachment = async ({
    conversationId,
    clientRequestId,
    sentByUserId,
    content,
    messageType,
    fileName,
    mimeType,
    fileSize,
    storageKey,
    checksum
}) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const messageResult = await client.query(
            `
            INSERT INTO messages (
                conversation_id,
                client_request_id,
                sent_by_user_id,
                direction,
                message_type,
                content,
                status
            )
            VALUES ($1, $2, $3, 'outgoing', $4, $5, 'pending')

            ON CONFLICT (client_request_id)
            WHERE client_request_id IS NOT NULL
            DO NOTHING

            RETURNING *
            `,
            [
                conversationId,
                clientRequestId,
                sentByUserId,
                messageType,
                content
            ]
        );

        if (messageResult.rowCount === 0) {
            await client.query("ROLLBACK");

            return {
                duplicate: true,
                message: null,
                attachment: null
            };
        }

        const message = messageResult.rows[0];

        const attachmentResult = await client.query(
            `
            INSERT INTO message_attachments (
                message_id,
                file_name,
                mime_type,
                file_size,
                storage_key,
                checksum_sha256
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            `,
            [
                message.id,
                fileName,
                mimeType,
                fileSize,
                storageKey,
                checksum
            ]
        );

        await client.query("COMMIT");

        return {
            duplicate: false,
            message,
            attachment: attachmentResult.rows[0]
        };

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
};

// 5. Tìm message theo client_request_id
const findByClientRequestId = async (id) => {
    const result = await pool.query(
        `
        SELECT *
        FROM messages
        WHERE client_request_id = $1
        `,
        [id]
    );

    return result.rows[0] || null;
};

// 6. Tìm attachment theo message_id
const findAttachmentByMessageId = async (messageId) => {
    const result = await pool.query(
        `
        SELECT *
        FROM message_attachments
        WHERE message_id = $1
        ORDER BY created_at
        LIMIT 1
        `,
        [messageId]
    );

    return result.rows[0] || null;
};

// 7. Cập nhật message text gửi thành công
const markAsSent = async (messageId, telegramResult) => {
    const result = await pool.query(
        `
        UPDATE messages
        SET status = 'sent',
            external_message_id = $2,
            sent_at = $3,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND status = 'pending'
        RETURNING *
        `,
        [
            messageId,
            telegramResult.externalMessageId,
            telegramResult.sentAt
        ]
    );

    return result.rows[0] || null;
};

// 8. Cập nhật message và attachment sau khi gửi Telegram thành công
const markAttachmentAsSent = async (
    messageId,
    telegramResult
) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const messageResult = await client.query(
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
            RETURNING *
            `,
            [
                messageId,
                telegramResult.externalMessageId,
                telegramResult.sentAt
            ]
        );

        if (!messageResult.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }

        await client.query(
            `
            UPDATE message_attachments
            SET external_file_id = $2
            WHERE message_id = $1
            `,
            [
                messageId,
                telegramResult.externalFileId
            ]
        );

        await client.query("COMMIT");

        return messageResult.rows[0];

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
};

// 9. Cập nhật gửi thất bại
const markAsFailed = async (messageId, errorMessage) => {
    const result = await pool.query(
        `
        UPDATE messages
        SET status = 'failed',
            error_message = $2,
            updated_at = NOW()
        WHERE id = $1
          AND status = 'pending'
        RETURNING *
        `,
        [
            messageId,
            errorMessage
        ]
    );

    return result.rows[0] || null;
};

// 10. Tìm thông tin attachment và conversation để phục vụ tải file
const findAttachmentById = async (attachmentId) => {
    const result = await pool.query(
        `
        SELECT
            a.id,
            a.file_name,
            a.mime_type,
            a.file_size,
            a.storage_key,
            m.conversation_id,
            cv.status AS conversation_status
        FROM message_attachments a
        JOIN messages m ON a.message_id = m.id
        JOIN conversations cv ON m.conversation_id = cv.id
        WHERE a.id = $1
        `,
        [attachmentId]
    );

    return result.rows[0] || null;
};

// 11. Lưu tin nhắn và file đính kèm nhận từ webhook Telegram
const saveIncomingAttachment = async ({
    channelAccountId,
    externalChatId,
    externalMessageId,
    externalSenderId,
    displayName,
    username,
    chatType,
    content,
    sentAt,
    messageType,
    attachment
}) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Tìm conversation
        const conversationResult = await client.query(
            `
            SELECT id
            FROM conversations
            WHERE channel_account_id = $1
              AND external_chat_id = $2
            FOR UPDATE
            `,
            [
                channelAccountId,
                String(externalChatId)
            ]
        );

        let conversationId;

        if (conversationResult.rows.length > 0) {
            conversationId = conversationResult.rows[0].id;

            await client.query(
                `
                UPDATE conversations
                SET
                    display_name = COALESCE(NULLIF($2, ''), display_name),
                    username = COALESCE(NULLIF($3, ''), username),
                    last_message_at = $4,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [
                    conversationId,
                    displayName,
                    username,
                    sentAt
                ]
            );

        } else {
            const newConversation = await client.query(
                `
                INSERT INTO conversations (
                    channel_account_id,
                    external_chat_id,
                    display_name,
                    username,
                    chat_type,
                    status,
                    last_message_at
                )
                VALUES ($1, $2, $3, $4, $5, 'open', $6)
                ON CONFLICT (
                    channel_account_id,
                    external_chat_id
                )
                DO UPDATE SET
                    updated_at = NOW()
                RETURNING id
                `,
                [
                    channelAccountId,
                    String(externalChatId),
                    displayName,
                    username,
                    chatType,
                    sentAt
                ]
            );

            conversationId = newConversation.rows[0].id;
        }

        // 2. Tạo incoming message
        const messageResult = await client.query(
            `
            INSERT INTO messages (
                conversation_id,
                external_message_id,
                external_sender_id,
                direction,
                message_type,
                content,
                status,
                sent_at
            )
            VALUES (
                $1, $2, $3,
                'incoming',
                $4, $5,
                'received',
                $6
            )

            ON CONFLICT (
                conversation_id,
                external_message_id
            )
            WHERE external_message_id IS NOT NULL
            DO NOTHING

            RETURNING *
            `,
            [
                conversationId,
                String(externalMessageId),
                externalSenderId
                    ? String(externalSenderId)
                    : null,
                messageType,
                content || null,
                sentAt
            ]
        );

        // 3. Nếu message đã tồn tại
        if (messageResult.rowCount === 0) {
            await client.query("ROLLBACK");

            return {
                created: false,
                conversationId,
                message: null,
                attachment: null
            };
        }

        const message = messageResult.rows[0];

        // 4. Lưu attachment metadata
        const attachmentResult = await client.query(
            `
            INSERT INTO message_attachments (
                message_id,
                external_file_id,
                file_name,
                mime_type,
                file_size,
                storage_key,
                checksum_sha256
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            `,
            [
                message.id,
                attachment.externalFileId,
                attachment.fileName,
                attachment.mimeType,
                attachment.fileSize,
                attachment.storageKey,
                attachment.checksum || null
            ]
        );

        await client.query("COMMIT");

        return {
            created: true,
            conversationId,
            message,
            attachment: attachmentResult.rows[0]
        };

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
};

const createPendingMessageWithOutbox = async ({
    conversationId,
    clientRequestId,
    sentByUserId,
    content,
    externalAccountId,
    externalChatId
}) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Tạo message pending
        const messageResult = await client.query(
            `
            INSERT INTO messages (
                conversation_id,
                client_request_id,
                sent_by_user_id,
                direction,
                message_type,
                content,
                status
            )
            VALUES (
                $1, $2, $3,
                'outgoing',
                'text',
                $4,
                'pending'
            )
            ON CONFLICT (client_request_id)
            WHERE client_request_id IS NOT NULL
            DO NOTHING
            RETURNING *
            `,
            [
                conversationId,
                clientRequestId,
                sentByUserId,
                content
            ]
        );

        // 2. Kiểm tra request trùng
        if (messageResult.rowCount === 0) {
            await client.query('ROLLBACK');

            return {
                duplicate: true,
                message: null
            };
        }

        const message = messageResult.rows[0];

        // 3. Tạo payload cho Kafka
        const payload = {
            messageId: message.id,
            conversationId,
            externalAccountId,
            externalChatId,
            messageType: 'text',
            content
        };

        // 4. Lưu event Outbox
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
            `,
            [
                crypto.randomUUID(),
                message.id,
                'telegram.message.send',
                String(conversationId),
                JSON.stringify(payload)
            ]
        );

        // 5. Commit cả hai
        await client.query('COMMIT');

        return {
            duplicate: false,
            message
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};

const createAttachmentMessageWithOutbox = async ({
    conversationId,
    sentByUserId,
    clientRequestId,
    content,
    messageType,
    attachment
}) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Tạo message
        const messageResult = await client.query(
            `
            INSERT INTO messages (
                id,
                conversation_id,
                sent_by_user_id,
                client_request_id,
                direction,
                message_type,
                content,
                status
            )
            VALUES (
                $1, $2, $3, $4,
                'outgoing', $5, $6, 'pending'
            )
            RETURNING *
            `,
            [
                crypto.randomUUID(),
                conversationId,
                sentByUserId,
                clientRequestId,
                messageType,
                content || null
            ]
        );

        const message = messageResult.rows[0];
        const attachmentId = crypto.randomUUID();

        // 2. Lưu metadata attachment
        await client.query(
            `
            INSERT INTO message_attachments (
                id,
                message_id,
                file_name,
                mime_type,
                file_size,
                storage_key
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
                attachmentId,
                message.id,
                attachment.fileName,
                attachment.mimeType,
                attachment.fileSize,
                attachment.storageKey
            ]
        );

        // 3. Tạo command
        const payload = {
            messageId: message.id,
            conversationId,
            attemptGeneration: 1,
            messageType,
            attachmentId
        };

        // 4. Lưu Outbox
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
                message.id,
                'telegram.message.send',
                String(conversationId),
                JSON.stringify(payload)
            ]
        );

        await client.query('COMMIT');

        return {
            message,
            attachmentId
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};

module.exports = {
    findConversationById,
    findConversationInformation: findConversationById,
    findMessages,
    createPendingMessage,
    createMessagePending: createPendingMessage,
    createPendingWithOutbox: createPendingMessageWithOutbox,
    createPendingMessageWithOutbox,
    createPendingMessageWithAttachment,
    createAttachmentMessageWithOutbox,
    findByClientRequestId,
    findAttachmentByMessageId,
    findAttachmentById,
    saveIncomingAttachment,
    markAsSent,
    markAttachmentAsSent,
    markAsFailed
};
