const pool = require("../config/database");

const findByLogin = async (login) => {
    const result = await pool.query(
        `
        SELECT
            u.id,
            u.username,
            u.email,
            u.password_hash,
            u.full_name,
            u.status,
            r.code AS role

        FROM users u

        JOIN roles r
            ON u.role_id = r.id

        WHERE LOWER(u.username) = LOWER($1)
           OR LOWER(u.email) = LOWER($1)

        LIMIT 1
        `,
        [login]
    );

    return result.rows[0] || null;
};

const findById = async (userId, client = pool) => {
    const result = await client.query(
        `
        SELECT
            u.id,
            u.username,
            u.email,
            u.full_name,
            u.status,
            r.code AS role

        FROM users u

        JOIN roles r
            ON u.role_id = r.id

        WHERE u.id = $1
        `,
        [userId]
    );

    return result.rows[0] || null;
};

const updateLastLogin = async (userId) => {
    await pool.query(
        `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
        `,
        [userId]
    );
};

module.exports = {
    findByLogin,
    findById,
    updateLastLogin
};

