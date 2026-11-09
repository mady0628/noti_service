const pool = require("../config/database");

const getConversation = async (page = 1, limit = 15, channelAccountId = null) => {
    const offset = (page - 1) * limit;

    let whereClause = "";
    const params = [limit, offset];

    if (channelAccountId) {
        params.push(channelAccountId);
        whereClause = `WHERE cv.channel_account_id = $${params.length}`;
    }

    const result = await pool.query(`
        SELECT 
            cv.id,
            cv.channel_account_id,
            cv.channel_account_id AS "channelAccountId",
            cv.external_chat_id,
            cv.display_name,
            cv.display_name AS "displayName",
            cv.username,
            cv.chat_type,
            cv.status,
            cv.assigned_user_id,
            cv.last_message_at,
            cv.created_at,
            ca.display_name AS channel_account_name,
            ca.display_name AS "botName",
            ca.external_username AS channel_account_username,
            ca.external_username AS "botUsername",
            ca.external_account_id AS "botId",
            c.code AS channel_code,
            c.code AS "channelCode",
            c.name AS channel_name,
            lm.content AS last_message,
            lm.content AS last_message_content,
            lm.direction AS last_message_direction,
            lm.message_type AS last_message_type,
            lm.created_at AS last_message_created_at
        FROM conversations cv
        JOIN channel_accounts ca ON cv.channel_account_id = ca.id
        JOIN channels c ON ca.channel_id = c.id
        LEFT JOIN LATERAL (
            SELECT 
                m.content,
                m.direction,
                m.message_type,
                m.created_at
            FROM messages m
            WHERE m.conversation_id = cv.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
        ) lm ON TRUE
        ${whereClause}
        ORDER BY 
            cv.last_message_at DESC NULLS LAST,
            cv.created_at DESC,
            cv.id DESC
        LIMIT $1 OFFSET $2
    `, params);

    return result.rows;
};

const countSumConversation = async (channelAccountId = null) => {
    let query = "SELECT COUNT(*)::int AS total FROM conversations cv";
    const params = [];

    if (channelAccountId) {
        params.push(channelAccountId);
        query += " WHERE cv.channel_account_id = $1";
    }

    const result = await pool.query(query, params);
    return Number(result.rows[0].total);
};

const getChannelAccounts = async () => {
    const result = await pool.query(`
        SELECT 
            ca.id,
            ca.external_account_id AS "botId",
            ca.display_name AS "botName",
            ca.external_username AS "botUsername",
            c.code AS "channelCode",
            c.name AS "channelName",
            ca.is_active AS "isActive"
        FROM channel_accounts ca
        JOIN channels c ON ca.channel_id = c.id
        WHERE ca.is_active = TRUE
        ORDER BY ca.created_at ASC
    `);

    return result.rows;
};

module.exports = {
    getConversation,
    countSumConversation,
    getChannelAccounts
};
