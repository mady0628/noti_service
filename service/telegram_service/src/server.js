require("dotenv").config();

const app = require("./app");
const { initializeBots, getAllBots } = require("./services/bot-manager.service");

const startServer = async () => {
    try {
        const port = Number(process.env.PORT || 3001);

        // Khởi tạo toàn bộ các Bot Telegram cấu hình trong .env
        await initializeBots();

        const registeredBots = getAllBots();
        console.log(`Initialized ${registeredBots.length} Telegram bot(s):`);
        for (const b of registeredBots) {
            console.log(` - @${b.username} (ID: ${b.botId})`);
        }

        // Chạy HTTP Server nhận webhook và internal API
        await new Promise((resolve) => {
            app.listen(port, "127.0.0.1", () => {
                console.log(
                    `Telegram Service running on http://127.0.0.1:${port}`
                );
                resolve();
            });
        });

    } catch (error) {
        console.error("Failed to start Telegram Service:", error);
        process.exit(1);
    }
};

startServer();
