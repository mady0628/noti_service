const CHAT_SERVICE_URL = (process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:3002')
    .replace(/\/+$/, '');

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Tải file từ Chat Service
const downloadAttachment = async ({
    messageId,
    attachmentId
}) => {
    const url = (
        `${CHAT_SERVICE_URL}/internal/messages/` +
        `${encodeURIComponent(messageId)}/attachments/` +
        `${encodeURIComponent(attachmentId)}`
    );

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'x-internal-api-key': process.env.INTERNAL_API_KEY
        },
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(
            `Download attachment failed: ${response.status}`
        );
    }

    const contentLength = Number(
        response.headers.get('content-length')
    );

    if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_ATTACHMENT_BYTES
    ) {
        await response.body?.cancel();
        throw new Error('Attachment exceeds size limit');
    }

    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of response.body) {
        totalBytes += chunk.length;

        if (totalBytes > MAX_ATTACHMENT_BYTES) {
            await response.body.cancel();
            throw new Error('Attachment exceeds size limit');
        }

        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
};

module.exports = {
    downloadAttachment
};

