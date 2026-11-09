const express = require('express');
const internalAuth = require('../middlewares/internal-auth.middleware');
const upload = require('../middlewares/upload.middleware');
const {
    registerBotAccount,
    receiveIncomingMessage,
    receiveIncomingAttachment,
    claimTelegramMessage,
    notifyMessageUpdated,
    recordTelegramResult,
    downloadInternalAttachment
} = require('../controllers/internal.controller');

const route = express.Router();

route.post('/accounts/register', internalAuth, registerBotAccount);
route.post('/messages/incoming', internalAuth, receiveIncomingMessage);
route.post(
    '/messages/incoming-attachment',
    internalAuth,
    upload.single('file'),
    receiveIncomingAttachment
);
route.post(
    '/messages/:messageId/claim-send',
    internalAuth,
    claimTelegramMessage
);
route.post(
    '/messages/delivery-result',
    internalAuth,
    recordTelegramResult
);
route.post(
    '/events/message-updated',
    internalAuth,
    notifyMessageUpdated
);
route.get(
    '/messages/:messageId/attachments/:attachmentId',
    internalAuth,
    downloadInternalAttachment
);

module.exports = route;
