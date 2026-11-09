const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const ACCESS_MINUTES = Number(
    process.env.ACCESS_TOKEN_MINUTES || 15
);

const REFRESH_DAYS = Number(
    process.env.REFRESH_TOKEN_DAYS || 7
);

const ACCESS_MAX_AGE = ACCESS_MINUTES * 60 * 1000;

const REFRESH_MAX_AGE =
    REFRESH_DAYS * 24 * 60 * 60 * 1000;

// Tạo Access Token (JWT)
const createAccessToken = (user) => {
    return jwt.sign(
        {
            role: user.role
        },
        process.env.JWT_SECRET,
        {
            subject: String(user.id),
            algorithm: "HS256",
            expiresIn: ACCESS_MINUTES * 60,
            issuer: process.env.JWT_ISSUER,
            audience: process.env.JWT_AUDIENCE
        }
    );
};

// Tạo Refresh Token ngẫu nhiên
const createRefreshToken = () => {
    return crypto.randomBytes(32).toString("hex");
};

// Hash token trước khi lưu DB
const hashRefreshToken = (token) => {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
};

// Thời điểm hết hạn Refresh Token
const createRefreshExpiry = () => {
    return new Date(Date.now() + REFRESH_MAX_AGE);
};

const isProduction = () =>
    process.env.NODE_ENV === "production";

const accessCookieOptions = () => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE
});

const refreshCookieOptions = () => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/auth",
    maxAge: REFRESH_MAX_AGE
});

module.exports = {
    createAccessToken,
    createRefreshToken,
    hashRefreshToken,
    createRefreshExpiry,
    accessCookieOptions,
    refreshCookieOptions
};

