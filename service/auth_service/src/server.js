require("dotenv").config();

const app = require("./app");
const pool = require("./config/database");

const PORT = Number(process.env.PORT || 3003);

const start = async () => {
    try {
        const requiredVariables = [
            "DATABASE_URL",
            "JWT_SECRET",
            "JWT_ISSUER",
            "JWT_AUDIENCE",
            "FRONTEND_ORIGIN"
        ];

        for (const key of requiredVariables) {
            if (!process.env[key]) {
                throw new Error(
                    `Missing environment variable: ${key}`
                );
            }
        }

        if (process.env.JWT_SECRET.length < 48) {
            throw new Error("JWT_SECRET is too short");
        }

        await pool.query("SELECT 1");

        console.log("Auth Database connected");

        app.listen(PORT, "127.0.0.1", () => {
            console.log(
                `Auth Service running on port ${PORT}`
            );
        });

    } catch (error) {
        console.error("Startup error:", error);
        process.exit(1);
    }
};

start();

