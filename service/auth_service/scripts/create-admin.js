require("dotenv").config();

const bcrypt = require("bcryptjs");

const pool = require("../src/config/database");

const createAdmin = async () => {
    try {
        const password = process.env.ADMIN_PASSWORD;

        if (!password || password.length < 12) {
            throw new Error(
                "ADMIN_PASSWORD must have at least 12 characters"
            );
        }

        const passwordHash = await bcrypt.hash(
            password,
            12
        );

        const result = await pool.query(
            `
            INSERT INTO users (
                role_id,
                username,
                email,
                password_hash,
                full_name,
                status
            )
            SELECT
                r.id,
                'admin',
                'admin@example.com',
                $1,
                'System Administrator',
                'active'
            FROM roles r
            WHERE r.code = 'ADMIN'

            ON CONFLICT DO NOTHING

            RETURNING id, username, email
            `,
            [passwordHash]
        );

        if (result.rowCount === 0) {
            console.log(
                "Admin already exists or role is missing"
            );
        } else {
            console.log(
                "Admin created:",
                result.rows[0]
            );
        }

    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;

    } finally {
        await pool.end();
    }
};

createAdmin();

