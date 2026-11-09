const downloadTelegramFile = async (bot, fileId) => {
    // 1. Yêu cầu Telegram lấy đường dẫn file
    const fileUrl = await bot.telegram.getFileLink(fileId);

    // 2. Tải file từ Telegram
    const response = await fetch(fileUrl.href, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(
            `Telegram download failed: ${response.status}`
        );
    }

    // 3. Chuyển dữ liệu thành Buffer
    const arrayBuffer = await response.arrayBuffer();

    return Buffer.from(arrayBuffer);
};

// Lấy ảnh có kích thước lớn nhất
const getLargestPhoto = (photos) => {
    if (!Array.isArray(photos) || photos.length === 0) {
        throw new Error("Telegram photo is missing");
    }

    return photos.reduce((largest, current) => {
        const currentSize = current.file_size || 0;
        const largestSize = largest.file_size || 0;

        if (currentSize > largestSize) {
            return current;
        }

        // Nếu Telegram không trả file_size, chọn ảnh có diện tích lớn hơn
        const currentArea = (current.width || 0) * (current.height || 0);
        const largestArea = (largest.width || 0) * (largest.height || 0);

        return currentArea > largestArea ? current : largest;
    });
};

// Nhận diện ảnh
const preparePhoto = async (bot, message) => {
    const photo = getLargestPhoto(message.photo);

    const buffer = await downloadTelegramFile(bot, photo.file_id);

    return {
        messageType: "image",
        buffer,
        fileName: `telegram_${message.message_id}.jpg`,
        mimeType: "image/jpeg",
        fileSize: buffer.length,
        externalFileId: photo.file_id,
        caption: message.caption || ""
    };
};

// Nhận diện tài liệu
const prepareDocument = async (bot, message) => {
    const document = message.document;

    if (!document) {
        throw new Error("Telegram document is missing");
    }

    const buffer = await downloadTelegramFile(bot, document.file_id);

    return {
        messageType: "document",
        buffer,
        fileName: document.file_name || "document",
        mimeType: document.mime_type || "application/octet-stream",
        fileSize: buffer.length,
        externalFileId: document.file_id,
        caption: message.caption || ""
    };
};

module.exports = {
    downloadTelegramFile,
    getLargestPhoto,
    preparePhoto,
    prepareDocument
};
