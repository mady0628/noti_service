require("dotenv").config();

const app = require("./app");
const pool = require("./config/database");

const startServer = async () => {
    try {
        await pool.query("SELECT 1");

        const port = Number(process.env.PORT || 3002);

        app.listen(port, "127.0.0.1", () => {
            console.log(`Chat Service running on ${port}`);
        });

    } catch (error) {
        console.error("Chat Service startup error:", error);
        process.exit(1);
    }
};

startServer();