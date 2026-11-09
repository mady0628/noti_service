const jwt = require("jsonwebtoken");

const pool = require("../config/database");

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.cookies?.mc_access;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const payload = jwt.verify(
            token,
            process.env.JWT_SECRET,
            {
                algorithms: ["HS256"],
                issuer: process.env.JWT_ISSUER,
                audience: process.env.JWT_AUDIENCE
            }
        );

        const result = await pool.query(
            `
            SELECT
                u.id,
                u.username,
                u.full_name,
                u.status,
                r.code AS role

            FROM users u

            JOIN roles r
                ON u.role_id = r.id

            WHERE u.id = $1
            `,
            [payload.sub]
        );

        const user = result.rows[0];

        if (!user || user.status !== "active") {
            return res.status(401).json({
                success: false,
                message: "Invalid account"
            });
        }

        req.user = {
            id: user.id,
            username: user.username,
            fullName: user.full_name,
            role: user.role
        };

        req.authExpiresAt = payload.exp * 1000;

        next();

    } catch (error) {
        if (
            error.name === "TokenExpiredError" ||
            error.name === "JsonWebTokenError" ||
            error.name === "NotBeforeError"
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired access token"
            });
        }

        console.error("Auth middleware error:", error);

        return res.status(500).json({
            success: false,
            message: "Authentication error"
        });
    }
};

module.exports = authMiddleware;

