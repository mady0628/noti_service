const conversationService = require("../services/conversation.service");

const getConversation = async (req, res) => {
    try {
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 15);
        const channelAccountId = req.query.channelAccountId || null;

        if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters"
            });
        }

        const data = await conversationService.getConversation(page, limit, channelAccountId);
        const total = await conversationService.countSumConversation(channelAccountId);
        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const getChannelAccounts = async (req, res) => {
    try {
        const data = await conversationService.getChannelAccounts();
        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    getConversation,
    getChannelAccounts
};
