const kafka = require('./kafka.client');

const {
    claimTelegramMessage,
    recordTelegramResult
} = require('../services/chat-internal.service');

const {
    sendTelegramMessage
} = require('../services/telegram-send-dispatcher.service');

const {
    classifyTelegramError
} = require('../services/telegram-error.service');

const consumer = kafka.consumer({
    groupId: 'telegram-send-workers',
    sessionTimeout: 30000
});

let connectPromise = null;

const connectConsumer = async () => {
    if (!connectPromise) {
        connectPromise = consumer.connect().catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    await connectPromise;
};

const handleSendMessage = async (command) => {
    const attemptGeneration = Number(
        command.attemptGeneration ?? 1
    );

    if (
        !command.messageId ||
        !Number.isSafeInteger(attemptGeneration) ||
        attemptGeneration < 1
    ) {
        throw new Error('Invalid send command');
    }

    const claim = await claimTelegramMessage(
        command.messageId,
        attemptGeneration
    );

    if (!claim.claimed) {
        console.log('Duplicate or stale command:', command.messageId);
        return;
    }

    const data = claim.data;
    let resultEvent;

    // Chỉ bắt lỗi của Telegram API ở đây
    try {
        const result = await sendTelegramMessage(data);

        resultEvent = {
            messageId: data.message_id,
            attemptGeneration,
            status: 'sent',
            externalMessageId: result.externalMessageId,
            sentAt: result.sentAt
        };

    } catch (error) {
        const classified = classifyTelegramError(error);

        resultEvent = {
            messageId: data.message_id,
            attemptGeneration,
            status: classified.type === 'retryable'
                ? 'retry_waiting'
                : classified.type === 'permanent'
                    ? 'failed'
                    : 'unknown',
            errorCode: classified.code,
            errorMessage: classified.message,
            retryAfterSeconds: classified.retryAfterSeconds
        };
    }

    // Lỗi ghi kết quả không được hiểu là lỗi Telegram.
    await recordTelegramResult(resultEvent);

    console.log(
        'Delivery result recorded:',
        data.message_id,
        resultEvent.status
    );
};

// Lắng nghe topic gửi tin
const startSendConsumer = async () => {
    await connectConsumer();

    await consumer.subscribe({
        topic: 'telegram.message.send',
        fromBeginning: false
    });

    await consumer.run({
        autoCommit: false,

        eachMessage: async ({
            topic,
            partition,
            message
        }) => {
            const command = JSON.parse(
                message.value.toString()
            );

            await handleSendMessage(command);

            // Chỉ commit offset sau khi handle hoàn tất.
            await consumer.commitOffsets([
                {
                    topic,
                    partition,
                    offset: String(
                        BigInt(message.offset) + 1n
                    )
                }
            ]);
        }
    });
};

const disconnectConsumer = async () => {
    await consumer.disconnect();
    connectPromise = null;
};

module.exports = {
    connectConsumer,
    startSendConsumer,
    disconnectConsumer,
    handleSendMessage
};
