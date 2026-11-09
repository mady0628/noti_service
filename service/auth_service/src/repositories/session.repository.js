const pool = require("../config/database");

// Tạo phiên đăng nhập mới
const createSession = async ({
    userId,
    familyId,
    tokenHash,
    expiresAt
}) => {
    const result = await pool.query(
        `
        INSERT INTO refresh_sessions (
            user_id,
            family_id,
            token_hash,
            expires_at
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [userId, familyId, tokenHash, expiresAt]
    );

    return result.rows[0];
};

// Tìm phiên và khóa row trong transaction
const findByHashForUpdate = async (client, tokenHash) => {
    const result = await client.query(
        `
        SELECT *
        FROM refresh_sessions
        WHERE token_hash = $1
        FOR UPDATE
        `,
        [tokenHash]
    );

    return result.rows[0] || null;
};

// Tạo phiên thay thế bằng transaction client
const insertReplacement = async (
    client,
    { userId, familyId, tokenHash, expiresAt }
) => {
    const result = await client.query(
        `
        INSERT INTO refresh_sessions (
            user_id,
            family_id,
            token_hash,
            expires_at
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [userId, familyId, tokenHash, expiresAt]
    );

    return result.rows[0];
};

// Đánh dấu token cũ đã bị thay thế
const replaceSession = async (
    client,
    oldSessionId,
    newSessionId
) => {
    await client.query(
        `
        UPDATE refresh_sessions
        SET
            revoked_at = NOW(),
            last_used_at = NOW(),
            replaced_by_id = $2
        WHERE id = $1
          AND revoked_at IS NULL
        `,
        [oldSessionId, newSessionId]
    );
};

// Thu hồi toàn bộ token thuộc một family
const revokeFamily = async (client, familyId) => {
    await client.query(
        `
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE family_id = $1
        `,
        [familyId]
    );
};

// Tìm session theo hash, dùng cho Logout
const findByHash = async (client, tokenHash) => {
    const result = await client.query(
        `
        SELECT *
        FROM refresh_sessions
        WHERE token_hash = $1
        `,
        [tokenHash]
    );

    return result.rows[0] || null;
};

module.exports = {
    createSession,
    findByHashForUpdate,
    insertReplacement,
    replaceSession,
    revokeFamily,
    findByHash
};

