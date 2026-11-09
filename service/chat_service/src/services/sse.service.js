const clients = new Set();

const addClient = (res) => {
    clients.add(res);
};

const removeClient = (res) => {
    clients.delete(res);
};

const broadcast = (eventName, data) => {
    const payload =
        `event: ${eventName}\n` +
        `data: ${JSON.stringify(data)}\n\n`;

    for (const client of clients) {
        if (!client.destroyed && !client.writableEnded) {
            client.write(payload);
        }
    }
};

module.exports = {
    addClient,
    removeClient,
    broadcast
};

