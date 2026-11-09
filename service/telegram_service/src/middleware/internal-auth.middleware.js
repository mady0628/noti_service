const crypto = require('crypto');

const internalAuth = (req, res, next) => {
    // api key từ request
    const providedKey = req.headers["x-internal-api-key"];
    // api key từ server
    const expectedKey = process.env.INTERNAL_API_KEY;

    if (typeof providedKey !== "string" || !expectedKey) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
    }

    // chuyển api key thành buffer
    const provided = Buffer.from(providedKey);
    const expected = Buffer.from(expectedKey);

    // so sánh api key request với api key server an toàn theo thời gian
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
    }

    next();
};

module.exports = internalAuth;

