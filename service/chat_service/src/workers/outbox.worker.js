const outboxRepository = require(
    '../repositories/outbox.repository'
);

const {
    connectProducer,
    publishOutboxEvent,
    disconnectProducer
} = require('../kafka/producer');

let running = false;

// Xử lý một outbox event
const processOutboxEvent = async (event) => {
    try {
        // 1. Publish Kafka
        await publishOutboxEvent(event);

        // 2. Kafka xác nhận thành công
        const updated = await outboxRepository.markAsPublished(
            event.id,
            event.lock_token
        );

        if (!updated) {
            console.warn(
                `Outbox lease expired: ${event.id}`
            );
            return;
        }

        console.log(
            `Outbox published: ${event.id}`
        );

    } catch (error) {
        console.error(
            `Publish failed: ${event.id}`,
            error.message
        );

        const delaySeconds = Math.min(
            60,
            5 * Math.pow(2, Math.min(event.attempts - 1, 4))
        );

        await outboxRepository.markAsPending(
            event.id,
            event.lock_token,
            error.message.slice(0, 1000),
            delaySeconds
        );
    }
};

// Xử lý một batch event
const processBatch = async () => {
    const events = await outboxRepository.claimOutboxEvents(10);

    for (const event of events) {
        await processOutboxEvent(event);
    }

    return events.length;
};

// Bắt đầu worker
const startOutboxWorker = async () => {
    await connectProducer();

    running = true;

    console.log('Outbox Worker started');

    while (running) {
        try {
            const count = await processBatch();

            if (count === 0) {
                await new Promise(resolve => {
                    setTimeout(resolve, 1000);
                });
            }

        } catch (error) {
            console.error(
                'Outbox Worker error:',
                error.message
            );

            await new Promise(resolve => {
                setTimeout(resolve, 5000);
            });
        }
    }
};

// Dừng nhận batch mới
const stopOutboxWorker = () => {
    running = false;
};

module.exports = {
    startOutboxWorker,
    stopOutboxWorker,
    disconnectProducer
};

