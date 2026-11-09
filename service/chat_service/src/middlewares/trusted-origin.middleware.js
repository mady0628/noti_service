const trustedOrigin = (req, res, next) => {
    const origin = req.get("Origin");
    const allowed = new Set([
        process.env.FRONTEND_ORIGIN,
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ].filter(Boolean));

    if (!origin || !allowed.has(origin)) {
        return res.status(403).json({
            success: false,
            message: "Untrusted origin"
        });
    }

    if (req.get("Sec-Fetch-Site") === "cross-site") {
        return res.status(403).json({
            success: false,
            message: "Untrusted origin"
        });
    }

    next();
};

module.exports = trustedOrigin;

