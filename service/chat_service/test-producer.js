require('dotenv').config();

const {
    publishTelegramSend,
    disconnectProducer
} = require('./src/kafka/producer');

const testProducer = async () => {
    try {
        const data = {
            messageId: 'test-message-001',
            conversationId: 'test-conversation-001',
            externalAccountId: '111111111',
            externalChatId: '987654321',
            messageType: 'text',
            content: 'Xin chao tu Chat Service'
        };

        await publishTelegramSend(data);

        console.log('Message published successfully');

    } catch (error) {
        console.error('Producer Error:', error);
    } finally {
        await disconnectProducer();
    }
};

testProducer();
