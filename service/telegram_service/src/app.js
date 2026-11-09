const express = require("express");
const webhookRoute = require("./route/webhook.route");
const internalRoutes = require("./route/internal.route");
const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({
        service: "telegram-service",
        status: "running"
    });
});

// Đăng ký route webhook Telegram
app.use("/telegram", webhookRoute);
app.use("/", webhookRoute);

// Đăng ký route internal giao tiếp giữa các service
app.use("/internal", internalRoutes);

module.exports = app;
