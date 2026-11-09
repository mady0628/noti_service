const express = require("express");
const { getConversation, getChannelAccounts } = require("../controllers/conversation.controller");
const { getMessage } = require("../controllers/message.controller");
const route = express.Router();

route.get("/", getConversation);
route.get("/channel-accounts", getChannelAccounts);
route.get("/:conversationId/messages", getMessage);

module.exports = route;
