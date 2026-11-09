const express = require("express");
const cookieParser = require("cookie-parser");

const internalRoutes = require("./routes/internal.route");
const conversationRoutes = require("./routes/conversation.route");
const messageRoutes = require("./routes/message.route");
const attachmentRoutes = require("./routes/attachment.route");
const sseRoutes = require("./routes/sse.routes");

const authMiddleware = require("./middlewares/auth.middleware");
const allowRoles = require("./middlewares/role.middleware");
const trustedOrigin = require("./middlewares/trusted-origin.middleware");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (req, res) => {
    res.json({
        service: "chat-service",
        status: "running"
    });
});

// Telegram Service gọi các Internal API bằng API Key.
app.use("/internal", internalRoutes);

// Dashboard API xác thực JWT, RBAC và bảo vệ Origin
app.use(
    "/api",
    authMiddleware,
    allowRoles("ADMIN", "SUPPORT")
);

app.use("/api", (req, res, next) => {
    if (
        ["POST", "PUT", "PATCH", "DELETE"]
            .includes(req.method)
    ) {
        return trustedOrigin(req, res, next);
    }

    next();
});

app.use("/api/conversations", conversationRoutes);
app.use("/api/conversations", messageRoutes);
app.use("/api/attachments", attachmentRoutes);
app.use("/api", sseRoutes);

module.exports = app;
