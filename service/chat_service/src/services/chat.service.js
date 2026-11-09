const pool = require("../config/database");

const registerChannelAccount = async (data) => {
    try {
        const { channel, externalAccountId, displayName, externalUsername } = data;

        // tìm id của channel
        const channelResult = await pool.query(`
            SELECT id 
            FROM channels
            WHERE code = $1 and is_active = TRUE      
        `, [channel]);

        const channelId = channelResult.rows[0].id;

        //thêm channel account hoặc nếu đã tồn tại thì cập nhật theo display_name và external_username mới
        const result = await pool.query(`
            INSERT INTO channel_accounts (
                channel_id, 
                external_account_id, 
                display_name, 
                external_username
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (channel_id, external_account_id)
            DO UPDATE SET 
                display_name = EXCLUDED.display_name,
                external_username = EXCLUDED.external_username
            RETURNING id
        `, [channelId, externalAccountId, displayName, externalUsername]);
        return result.rows[0].id;
    } catch (error) {
        console.error("Register error:", error);
        throw error;
    }
}

const saveTelegramMessage = async (data) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { channel, externalAccountId, eventId, externalEventId, externalChatId, displayName, username, chatType, externalMessageId, externalSenderId, content, sentAt } = data;
        const deduplicationId = String(externalEventId || eventId);

        // tìm channel_account
        const accountResult = await client.query(`
            SELECT ca.id 
            FROM channel_accounts ca
            JOIN channels c
                ON ca.channel_id = c.id
            WHERE ca.external_account_id = $1
                AND c.code = $2
                AND c.is_active = TRUE
                AND ca.is_active = TRUE
        `, [externalAccountId, channel]);

        if (accountResult.rows.length === 0) {
            const error = new Error("Channel account not fount");
            error.statusCode = 404;
            throw error;
        }

        const channelAccountId = accountResult.rows[0].id;

        // thêm webhook event  
        const eventResult = await client.query(`
            INSERT INTO webhook_events (
                channel_account_id, 
                external_event_id, 
                event_type, 
                payload
            )
            VALUES ($1, $2, 'message', $3::jsonb)
            ON CONFLICT (channel_account_id, external_event_id)
            DO NOTHING
            RETURNING id
        `, [channelAccountId, deduplicationId, JSON.stringify(data)]);

        if (eventResult.rows.length === 0) {
            await client.query('COMMIT');
            return {
                created: false,
                reason: 'duplicate_event'
            }
        }

        //  thêm conversation
        const conversationtResult = await client.query(`
            INSERT INTO conversations (
                channel_account_id, 
                external_chat_id, 
                display_name, 
                username, 
                chat_type
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (channel_account_id, external_chat_id)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                username = EXCLUDED.username,
                chat_type = EXCLUDED.chat_type
            RETURNING id
        `, [channelAccountId, externalChatId, displayName, username, chatType]);

        const conversationId = conversationtResult.rows[0].id;

        // thêm message
        const messageResult = await client.query(`
            INSERT INTO messages (
                conversation_id,
                external_message_id,
                external_sender_id,
                direction,
                message_type,
                content,
                status,
                sent_at
            )            
            VALUES ( $1, $2, $3, 'incoming', 'text', $4, 'received', $5)
            ON CONFLICT (conversation_id, external_message_id)
            WHERE external_message_id IS NOT NULL
            DO NOTHING
            RETURNING *
        `, [conversationId, externalMessageId, externalSenderId, content, sentAt]);

        // chuyển event webhook sang trạng thái process
        await client.query(`
            UPDATE webhook_events
            SET status = 'processed',
                processed_at = NOW()
            WHERE id = $1
        `, [eventResult.rows[0].id]);

        await client.query('COMMIT');
        return {
            created: messageResult.rows.length > 0,
            conversationId,
            message: messageResult.rows[0] || null
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Save incoming message error:", error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { registerChannelAccount, saveTelegramMessage };
