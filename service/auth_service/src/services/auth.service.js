const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

const pool = require("../config/database");

const userRepository = require(
    "../repositories/user.repository"
);

const sessionRepository = require(
    "../repositories/session.repository"
);

const tokenService = require("./token.service");

const createError = (message, statusCode = 401) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const publicUser = (user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    role: user.role
});

// 1. LOGIN
const login = async (loginName, password) => {
    const user = await userRepository.findByLogin(loginName);

    if (!user) {
        throw createError("Invalid credentials");
    }

    const validPassword = await bcrypt.compare(
        password,
        user.password_hash
    );

    if (!validPassword || user.status !== "active") {
        throw createError("Invalid credentials");
    }

    const accessToken =
        tokenService.createAccessToken(user);

    const refreshToken =
        tokenService.createRefreshToken();

    const familyId = crypto.randomUUID();

    await sessionRepository.createSession({
        userId: user.id,
        familyId,
        tokenHash: tokenService.hashRefreshToken(refreshToken),
        expiresAt: tokenService.createRefreshExpiry()
    });

    await userRepository.updateLastLogin(user.id);

    return {
        accessToken,
        refreshToken,
        user: publicUser(user)
    };
};

// 2. REFRESH TOKEN ROTATION
const refresh = async (oldRefreshToken) => {
    const oldHash =
        tokenService.hashRefreshToken(oldRefreshToken);

    const client = await pool.connect();

    let transactionStarted = false;

    try {
        await client.query("BEGIN");
        transactionStarted = true;

        const oldSession =
            await sessionRepository.findByHashForUpdate(
                client,
                oldHash
            );

        if (!oldSession) {
            throw createError("Invalid refresh token");
        }

        // Token đã bị sử dụng/thu hồi.
        // Có khả năng token bị replay.
        if (oldSession.revoked_at) {
            await sessionRepository.revokeFamily(
                client,
                oldSession.family_id
            );

            await client.query("COMMIT");
            transactionStarted = false;

            throw createError(
                "Refresh token reuse detected"
            );
        }

        if (new Date(oldSession.expires_at) <= new Date()) {
            throw createError("Refresh token expired");
        }

        const user = await userRepository.findById(
            oldSession.user_id,
            client
        );

        if (!user || user.status !== "active") {
            await sessionRepository.revokeFamily(
                client,
                oldSession.family_id
            );

            await client.query("COMMIT");
            transactionStarted = false;

            throw createError("Account is not active");
        }

        const newRefreshToken =
            tokenService.createRefreshToken();

        const newSession =
            await sessionRepository.insertReplacement(
                client,
                {
                    userId: user.id,
                    familyId: oldSession.family_id,
                    tokenHash: tokenService.hashRefreshToken(
                        newRefreshToken
                    ),
                    expiresAt: tokenService.createRefreshExpiry()
                }
            );

        await sessionRepository.replaceSession(
            client,
            oldSession.id,
            newSession.id
        );

        const newAccessToken =
            tokenService.createAccessToken(user);

        await client.query("COMMIT");
        transactionStarted = false;

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: publicUser(user)
        };

    } catch (error) {
        if (transactionStarted) {
            await client.query("ROLLBACK");
        }

        throw error;

    } finally {
        client.release();
    }
};

// 3. LOGOUT
const logout = async (refreshToken) => {
    if (!refreshToken) return;

    const tokenHash =
        tokenService.hashRefreshToken(refreshToken);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const session = await sessionRepository.findByHash(
            client,
            tokenHash
        );

        if (session) {
            await sessionRepository.revokeFamily(
                client,
                session.family_id
            );
        }

        await client.query("COMMIT");

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
};

// 4. GET CURRENT USER
const getCurrentUser = async (userId) => {
    const user = await userRepository.findById(userId);

    if (!user || user.status !== "active") {
        throw createError("Invalid session");
    }

    return publicUser(user);
};

module.exports = {
    login,
    refresh,
    logout,
    getCurrentUser
};

