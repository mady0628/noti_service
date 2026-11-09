const crypto = require("node:crypto");
const pool = require("../config/database");
const messageRepository = require("../repository/message.repository");
const attachmentService = require("./attachment.service");
const telegramClient = require("./telegram-client.service");
const sseService = require("./sse.service");

const ALLOWED_MIME_TYPES = {
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",

    "application/pdf": "document",
    "application/msword": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
    "application/vnd.ms-excel": "document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
    "application/zip": "document",
    "text/plain": "document"
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const createError = (message, statusCode = 500) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const encodeCursor = (message) => {
    const createdAt = message.created_at instanceof Date
        ? message.created_at.toISOString()
        : new Date(message.created_at).toISOString();

    const payload = {
        createdAt,
        id: message.id
    };

    return Buffer.from(JSON.stringify(payload)).toString("base64url");
};

const decodeCursor = (cursor) => {
    try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (
            typeof decoded.createdAt !== "string" ||
            !Number.isFinite(Date.parse(decoded.createdAt)) ||
            typeof decoded.id !== "string" ||
            !uuidRegex.test(decoded.id)
        ) {
            throw new Error("Invalid cursor");
        }

        return decoded;
    } catch {
        throw createError("Invalid cursor", 400);
    }
};

const getMessage = async (conversationId, limit, cursor = null) => {
    // 1. Kiểm tra conversation có tồn tại không
    const conversation = await messageRepository.findConversationById(conversationId);
    if (!conversation) {
        throw createError("Conversation not found", 404);
    }

    let cursorDate = null;
    let cursorId = null;

    if (cursor) {
        const decoded = decodeCursor(cursor);
        cursorDate = decoded.createdAt;
        cursorId = decoded.id;
    }

    // 2. Query repository lấy limit + 1 bản ghi để kiểm tra hasMore
    const rows = await messageRepository.findMessages(
        conversationId,
        limit + 1,
        cursorDate,
        cursorId
    );

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const oldestMessage = pageRows.at(-1);

    const nextCursor = hasMore && oldestMessage ? encodeCursor(oldestMessage) : null;

    return {
        hasMore,
        nextCursor,
        data: [...pageRows].reverse()
    };
};

const sendMessage = async ({
    conversationId,
    content,
    clientRequestId,
    sentByUserId
}) => {
    // 1. Tìm conversation
    const conversation = await messageRepository.findConversationById(conversationId);

    if (!conversation) {
        throw createError("Conversation not found", 404);
    }

    // 2. Kiểm tra nền tảng
    if (conversation.channel_code !== "TELEGRAM") {
        throw createError("Only Telegram is supported currently", 400);
    }

    // 3. Kiểm tra trạng thái conversation
    if (conversation.status !== "open") {
        throw createError("Conversation is not open", 409);
    }

    // 4. Tạo message pending và Outbox event trong cùng 1 transaction
    const result = await messageRepository.createPendingWithOutbox({
        conversationId,
        clientRequestId,
        sentByUserId,
        externalAccountId: conversation.external_account_id,
        externalChatId: conversation.external_chat_id,
        content
    });

    // Request đã tồn tại, không tạo Outbox mới
    if (result.duplicate) {
        const existing = await messageRepository.findByClientRequestId(clientRequestId);

        if (
            !existing ||
            existing.conversation_id !== conversationId ||
            existing.content !== content ||
            existing.sent_by_user_id !== sentByUserId
        ) {
            throw createError("clientRequestId already used for another request", 409);
        }

        return {
            message: existing,
            duplicate: true,
            outcomeUnknown: existing.status === "pending"
        };
    }

    // Trả về message vừa tạo thành công với status 202
    return {
        message: result.message,
        duplicate: false,
        outcomeUnknown: false
    };
};

// SEND ATTACHMENT
const sendAttachment = async ({
    conversationId,
    content = "",
    clientRequestId,
    sentByUserId,
    file
}) => {
    // 1. TÌM CONVERSATION
    const conversation =
        await messageRepository.findConversationById(
            conversationId
        );

    if (!conversation) {
        throw createError(
            "Conversation not found",
            404
        );
    }

    // 2. KIỂM TRA CHANNEL
    if (conversation.channel_code !== "TELEGRAM") {
        throw createError(
            "Only Telegram is supported currently",
            400
        );
    }

    // 3. KIỂM TRA TRẠNG THÁI CONVERSATION
    if (conversation.status !== "open") {
        throw createError(
            "Conversation is not open",
            409
        );
    }

    // 4. KIỂM TRA IDEMPOTENCY TRƯỚC KHI LƯU FILE
    if (clientRequestId) {
        const existing =
            await messageRepository.findByClientRequestId(
                clientRequestId
            );

        if (existing) {
            if (
                existing.conversation_id !== conversationId ||
                existing.sent_by_user_id !== sentByUserId
            ) {
                throw createError(
                    "clientRequestId already used for another request",
                    409
                );
            }

            return {
                message: existing,
                duplicate: true,
                outcomeUnknown: false
            };
        }
    }

    // 5. VALIDATE FILE
    if (!file) {
        throw createError(
            "File is required",
            400
        );
    }

    if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
        throw createError(
            "Invalid file buffer",
            400
        );
    }

    if (
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        file.size > MAX_FILE_SIZE ||
        file.buffer.length !== file.size
    ) {
        throw createError(
            "File size is invalid or exceeds 20MB",
            400
        );
    }

    const messageType =
        ALLOWED_MIME_TYPES[file.mimetype];

    if (!messageType) {
        throw createError(
            "Unsupported file type",
            400
        );
    }

    if (
        typeof file.originalname !== "string" ||
        !file.originalname.trim()
    ) {
        throw createError(
            "Invalid file name",
            400
        );
    }

    const caption = typeof content === "string" ? content : "";

    if (caption.length > 1024) {
        throw createError(
            "Invalid caption",
            400
        );
    }

    // 6. LƯU FILE VÀO STORAGE
    let savedFile = null;

    try {
        savedFile = await attachmentService.saveFile(file);

        // 7. TẠO MESSAGE + ATTACHMENT + OUTBOX TRONG MỘT TRANSACTION
        const result =
            await messageRepository.createAttachmentMessageWithOutbox({
                conversationId,
                sentByUserId,
                clientRequestId: clientRequestId || crypto.randomUUID(),
                content: caption.trim(),
                messageType,
                attachment: {
                    fileName: savedFile.fileName,
                    mimeType: savedFile.mimeType,
                    fileSize: savedFile.fileSize,
                    storageKey: savedFile.storageKey
                }
            });

        return {
            message: result.message,
            attachmentId: result.attachmentId,
            duplicate: false,
            outcomeUnknown: false
        };

    } catch (error) {
        // Tránh orphan file nếu rollback
        if (savedFile?.absolutePath) {
            try {
                await attachmentService.deleteFile(savedFile.absolutePath);
            } catch (delError) {
                console.error("Failed to cleanup orphan file:", delError.message);
            }
        }
        throw error;
    }
};

// SAVE INCOMING ATTACHMENT (TỪ TELEGRAM)

const saveIncomingAttachment = async (data) => {
    let savedFile = null;
    let committed = false;

    try {
        const {
            externalAccountId,
            externalChatId,
            externalMessageId,
            externalSenderId,
            displayName,
            username,
            chatType,
            content,
            sentAt,
            externalFileId,
            file
        } = data;

        // 1. Validate file
        if (
            !file ||
            !Buffer.isBuffer(file.buffer) ||
            file.buffer.length === 0 ||
            file.buffer.length > MAX_FILE_SIZE
        ) {
            throw createError("Invalid file", 400);
        }

        const messageType = ALLOWED_MIME_TYPES[file.mimetype];

        if (!messageType) {
            throw createError("Unsupported file type", 400);
        }

        if (
            !externalMessageId ||
            !externalChatId ||
            !externalAccountId ||
            !externalFileId
        ) {
            throw createError("Missing Telegram data", 400);
        }

        const caption = typeof content === "string" ? content : "";
        if (caption.length > 1024) {
            throw createError("Invalid caption", 400);
        }

        // 2. Tìm channel account
        const accountResult = await pool.query(
            `
            SELECT ca.id
            FROM channel_accounts ca
            JOIN channels ch ON ca.channel_id = ch.id
            WHERE ca.external_account_id = $1
              AND ch.code = 'TELEGRAM'
              AND ca.is_active = TRUE
              AND ch.is_active = TRUE
            `,
            [String(externalAccountId)]
        );

        if (!accountResult.rows[0]) {
            throw createError("Telegram account not found", 404);
        }

        const channelAccountId = accountResult.rows[0].id;

        // 3. Kiểm tra checksum
        const checksum = crypto
            .createHash("sha256")
            .update(file.buffer)
            .digest("hex");

        // 4. Lưu file vào Local Storage
        savedFile = await attachmentService.saveFile({
            originalname: file.fileName,
            mimetype: file.mimetype,
            size: file.buffer.length,
            buffer: file.buffer
        });

        // 5. Lưu Conversation + Message + Attachment
        const result = await messageRepository.saveIncomingAttachment({
            channelAccountId,
            externalChatId,
            externalMessageId,
            externalSenderId,
            displayName,
            username,
            chatType,
            content: caption,
            sentAt,
            messageType,

            attachment: {
                externalFileId,
                fileName: savedFile.fileName,
                mimeType: savedFile.mimeType,
                fileSize: savedFile.fileSize,
                storageKey: savedFile.storageKey,
                checksum
            }
        });

        // 6. Nếu webhook trùng, xóa file vừa tải
        if (!result.created) {
            await attachmentService.deleteFile(savedFile.absolutePath);
            savedFile = null;

            return {
                ...result,
                duplicate: true
            };
        }

        committed = true;

        // 7. Phát SSE sau khi PostgreSQL COMMIT
        sseService.broadcast("new_message", {
            conversationId: result.conversationId,
            messageId: result.message.id,
            direction: "incoming",
            messageType
        });

        return {
            ...result,
            duplicate: false
        };

    } catch (error) {
        // Chỉ xóa file nếu chưa lưu thành công metadata.
        if (savedFile && !committed) {
            await attachmentService.deleteFile(savedFile.absolutePath);
        }

        throw error;
    }
};

const sendMessageWithKafka = async ({
    conversationId,
    content,
    clientRequestId,
    sentByUserId
}) => {
    // 1. Kiểm tra nội dung
    if (
        typeof content !== 'string' ||
        !content.trim()
    ) {
        throw createError('Message content is required', 400);
    }

    if (!clientRequestId) {
        throw createError('clientRequestId is required', 400);
    }

    // 2. Tìm conversation
    const conversation =
        await messageRepository.findConversationById(
            conversationId
        );

    if (!conversation) {
        throw createError('Conversation not found', 404);
    }

    // 3. Kiểm tra Telegram
    if (conversation.channel_code !== 'TELEGRAM') {
        throw createError('Unsupported channel', 400);
    }

    // 4. Kiểm tra trạng thái conversation
    if (conversation.status !== 'open') {
        throw createError('Conversation is not open', 409);
    }

    // 5. Lưu pending message + outbox
    const result =
        await messageRepository.createPendingMessageWithOutbox({
            conversationId,
            clientRequestId,
            sentByUserId,
            content: content.trim(),
            externalAccountId:
                conversation.external_account_id,
            externalChatId:
                conversation.external_chat_id
        });

    // 6. Xử lý request trùng
    if (result.duplicate) {
        const existing =
            await messageRepository.findByClientRequestId(
                clientRequestId
            );

        if (
            !existing ||
            existing.conversation_id !== conversationId ||
            existing.sent_by_user_id !== sentByUserId ||
            existing.content !== content.trim() ||
            existing.message_type !== 'text'
        ) {
            throw createError(
                'clientRequestId already used',
                409
            );
        }

        return {
            message: existing,
            duplicate: true
        };
    }

    // 7. Trả về ngay, chưa chờ Telegram
    return {
        message: result.message,
        duplicate: false
    };
};

module.exports = {
    getMessage,
    sendMessage,
    sendMessageWithKafka,
    sendAttachment,
    saveIncomingAttachment
};
