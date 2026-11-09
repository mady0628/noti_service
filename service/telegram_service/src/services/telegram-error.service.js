const classifyTelegramError = (error) => {
    const statusCode =
        error.response?.error_code ||
        error.response?.statusCode ||
        null;

    const description =
        error.response?.description ||
        error.message ||
        'Unknown Telegram error';

    const retryAfter =
        error.response?.parameters?.retry_after;

    // Telegram từ chối do giới hạn tốc độ.
    // Có thể thử lại sau thời gian yêu cầu.
    if (statusCode === 429) {
        return {
            type: 'retryable',
            code: 'RATE_LIMIT',
            message: description,
            retryAfterSeconds: Number.isFinite(
                Number(retryAfter)
            ) ? Math.max(1, Number(retryAfter)) : 60
        };
    }

    // Các lỗi không nên tự động gửi lại.
    if (statusCode === 400 || statusCode === 403) {
        return {
            type: 'permanent',
            code: `TELEGRAM_${statusCode}`,
            message: description
        };
    }

    // Không có phản hồi Telegram rõ ràng:
    // không thể kết luận request đã gửi hay chưa.
    return {
        type: 'unknown',
        code: statusCode
            ? `TELEGRAM_${statusCode}`
            : 'NETWORK_OR_UNKNOWN',
        message: description
    };
};

module.exports = {
    classifyTelegramError
};

