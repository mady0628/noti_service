const { Kafka, logLevel } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'telegram-service',
    brokers: process.env.KAFKA_BROKERS.split(','),
    logLevel: logLevel.INFO
});

module.exports = kafka;