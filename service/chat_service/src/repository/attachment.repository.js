const pool = require("../config/database");

const createAttachment = async (
    clientOrData,
    dataIfClient
) => {
    let client = pool;
    let data = clientOrData;

    // Cho phép gọi theo 2 kiểu: createAttachment(data) hoặc createAttachment(client, data)
    if (dataIfClient) {
        client = clientOrData;
        data = dataIfClient;
    }

    const {
        messageId,
        externalFileId,
        fileName,
        mimeType,
        fileSize,
        storageKey,
        checksum
    } = data;

    const result = await client.query(
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
            messageId,
            externalFileId,
            fileName,
            mimeType,
            fileSize,
            storageKey,
            checksum || null
        ]
    );

    return result.rows[0];
};

const findAttachmentById = async (id, client = null) => {
    const db = client || pool;
    const result = await db.query(
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

        JOIN messages m
            ON a.message_id = m.id

        JOIN conversations cv
            ON m.conversation_id = cv.id

        WHERE a.id = $1
        `,
        [id]
    );

    return result.rows[0] || null;
};

const findAttachmentForTelegram = async (
    messageId,
    attachmentId
) => {
    const result = await pool.query(
        `
        SELECT
            a.id,
            a.message_id,
            a.file_name,
            a.mime_type,
            a.file_size,
            a.storage_key,
            m.message_type,
            m.direction,
            m.status
        FROM message_attachments a
        JOIN messages m
            ON m.id = a.message_id
        WHERE a.id = $1
          AND a.message_id = $2
          AND m.direction = 'outgoing'
          AND m.message_type IN ('image', 'document')
        `,
        [attachmentId, messageId]
    );

    return result.rows[0] || null;
};

module.exports = {
    createAttachment,
    findAttachmentById,
    findAttachmentForTelegram
};
