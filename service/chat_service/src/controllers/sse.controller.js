const sseService = require("../services/sse.service");

const subscribe = (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.flushHeaders();

    sseService.addClient(res);

    res.write(
        `event: connected\n` +
        `data: ${JSON.stringify({
            message: "SSE connected"
        })}\n\n`
    );

    const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) {
            res.write(": heartbeat\n\n");
        }
    }, 25000);

    const remainingMs = Math.max(
        0,
        req.authExpiresAt - Date.now()
    );

    const expiryTimer = setTimeout(() => {
        res.end();
    }, remainingMs);

    req.on("close", () => {
        clearInterval(heartbeat);
        clearTimeout(expiryTimer);
        sseService.removeClient(res);
    });
};

module.exports = {
    subscribe
};
