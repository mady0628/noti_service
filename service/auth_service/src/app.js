const express = require("express");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth.routes");

const app = express();

app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

app.get("/health", (req, res) => {
    res.json({
        service: "auth-service",
        status: "running"
    });
});

app.use("/auth", authRoutes);

module.exports = app;

