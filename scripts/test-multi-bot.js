const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
module.paths.push(path.join(rootDir, "service", "auth_service", "node_modules"));
module.paths.push(path.join(rootDir, "service", "chat_service", "node_modules"));
module.paths.push(path.join(rootDir, "service", "telegram_service", "node_modules"));

const jwt = require("jsonwebtoken");
require("dotenv").config({ path: path.join(rootDir, "service", "auth_service", ".env") });
const chatEnv = require("dotenv").config({ path: path.join(rootDir, "service", "chat_service", ".env") }).parsed || {};
for (const [k, v] of Object.entries(chatEnv)) {
    if (!process.env[k]) process.env[k] = v;
}
const teleEnv = require("dotenv").config({ path: path.join(rootDir, "service", "telegram_service", ".env") }).parsed || {};
for (const [k, v] of Object.entries(teleEnv)) {
    if (!process.env[k]) process.env[k] = v;
}

const pool = require(path.join(rootDir, "service", "chat_service", "src", "config", "database"));
const chatApp = require(path.join(rootDir, "service", "chat_service", "src", "app"));
const teleApp = require(path.join(rootDir, "service", "telegram_service", "src", "app"));
const botManager = require(path.join(rootDir, "service", "telegram_service", "src", "services", "bot-manager.service"));
const messageService = require(path.join(rootDir, "service", "chat_service", "src", "services", "message.service"));

let chatServer, chatBaseUrl;
let teleServer, teleBaseUrl;
let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
    totalCount++;
    if (!condition) {
        console.error(`  FAIL: ${message}`);
        throw new Error(message);
    }
    passedCount++;
    console.log(`  PASS: ${message}`);
}

// Giả lập bot Telegraf cho mục đích kiểm thử
function createMockBot(botId, username) {
    const handlers = {
        text: [],
        photo: [],
        document: []
    };

    const sentMessages = [];

    const mockBot = {
        botInfo: { id: Number(botId), username, first_name: `${username} Display` },
        on: (event, handler) => {
            if (handlers[event]) handlers[event].push(handler);
        },
        handleUpdate: async (update) => {
            const ctx = {
                update,
                message: update.message,
                chat: update.message?.chat,
                from: update.message?.from,
                botInfo: mockBot.botInfo
            };

            if (update.message?.text && handlers.text) {
                for (const h of handlers.text) await h(ctx);
            }
            if (update.message?.photo && handlers.photo) {
                for (const h of handlers.photo) await h(ctx);
            }
            if (update.message?.document && handlers.document) {
                for (const h of handlers.document) await h(ctx);
            }
        },
        telegram: {
            getMe: async () => mockBot.botInfo,
            getFileLink: async (fileId) => ({ href: `${teleBaseUrl}/mock-photo-download` }),
            setWebhook: async () => true,
            sendMessage: async (chatId, text) => {
                const msg = {
                    message_id: Math.floor(Math.random() * 100000) + 1,
                    chat: { id: chatId },
                    text,
                    date: Math.floor(Date.now() / 1000)
                };
                sentMessages.push(msg);
                return msg;
            },
            sendPhoto: async (chatId, input, options) => {
                const msg = {
                    message_id: Math.floor(Math.random() * 100000) + 1,
                    chat: { id: chatId },
                    photo: [{ file_id: `photo_${botId}_${Date.now()}` }],
                    caption: options?.caption,
                    date: Math.floor(Date.now() / 1000)
                };
                sentMessages.push(msg);
                return msg;
            },
            sendDocument: async (chatId, input, options) => {
                const msg = {
                    message_id: Math.floor(Math.random() * 100000) + 1,
                    chat: { id: chatId },
                    document: { file_id: `doc_${botId}_${Date.now()}` },
                    caption: options?.caption,
                    date: Math.floor(Date.now() / 1000)
                };
                sentMessages.push(msg);
                return msg;
            }
        },
        sentMessages
    };

    return mockBot;
}

async function runTest() {
    console.log("\n================================================================================");
    console.log("             KIỂM THỬ HỆ THỐNG MULTI-BOT TELEGRAM TOÀN DIỆN");
    console.log("================================================================================\n");

    try {
        // 1. Khởi động Chat Service test server
        await new Promise((resolve) => {
            chatServer = http.createServer(chatApp);
            chatServer.listen(0, "127.0.0.1", () => {
                const port = chatServer.address().port;
                chatBaseUrl = `http://127.0.0.1:${port}`;
                process.env.CHAT_SERVICE_URL = chatBaseUrl;
                resolve();
            });
        });

        // 2. Khởi động Telegram Service test server
        teleApp.get("/mock-photo-download", (req, res) => {
            res.setHeader("Content-Type", "image/jpeg");
            res.send(Buffer.from("fake_mock_photo_bytes"));
        });

        await new Promise((resolve) => {
            teleServer = http.createServer(teleApp);
            teleServer.listen(0, "127.0.0.1", () => {
                const port = teleServer.address().port;
                teleBaseUrl = `http://127.0.0.1:${port}`;
                process.env.TELEGRAM_SERVICE_URL = teleBaseUrl;
                resolve();
            });
        });

        console.log(`[INIT] Chat Service chạy tại: ${chatBaseUrl}`);
        console.log(`[INIT] Telegram Service chạy tại: ${teleBaseUrl}`);

        // 3. Khởi tạo 3 bot: Bot A, Bot B, Bot C
        const botA = createMockBot("111111111", "shop_a_bot");
        const botB = createMockBot("222222222", "shop_b_bot");
        const botC = createMockBot("333333333", "shop_c_bot");

        botManager.clearBots();

        // Đăng ký handlers cho từng bot
        botManager.registerMessageHandlers(botA, "111111111");
        botManager.registerMessageHandlers(botB, "222222222");
        botManager.registerMessageHandlers(botC, "333333333");

        botManager.registerBot("111111111", {
            bot: botA,
            botId: "111111111",
            username: "shop_a_bot",
            displayName: "Shop A Bot",
            webhookSecret: "secret_a"
        });

        botManager.registerBot("222222222", {
            bot: botB,
            botId: "222222222",
            username: "shop_b_bot",
            displayName: "Shop B Bot",
            webhookSecret: "secret_b"
        });

        botManager.registerBot("333333333", {
            bot: botC,
            botId: "333333333",
            username: "shop_c_bot",
            displayName: "Shop C Bot",
            webhookSecret: "secret_c"
        });

        // Đồng bộ 3 bot vào Database channel_accounts qua Internal API của Chat Service
        const chatClient = require(path.join(rootDir, "service", "telegram_service", "src", "services", "chat-client.service"));
        const regA = await chatClient.registerAccount({
            channel: "TELEGRAM",
            externalAccountId: "111111111",
            displayName: "Shop A Bot",
            externalUsername: "shop_a_bot"
        });
        const regB = await chatClient.registerAccount({
            channel: "TELEGRAM",
            externalAccountId: "222222222",
            displayName: "Shop B Bot",
            externalUsername: "shop_b_bot"
        });
        const regC = await chatClient.registerAccount({
            channel: "TELEGRAM",
            externalAccountId: "333333333",
            displayName: "Shop C Bot",
            externalUsername: "shop_c_bot"
        });

        const channelAccountIdA = regA.data;
        const channelAccountIdB = regB.data;
        const channelAccountIdC = regC.data;

        // Ký token Admin để gọi API Dashboard
        const adminUser = (await pool.query("SELECT id FROM users WHERE username = 'admin' AND status = 'active' LIMIT 1")).rows[0];
        const adminToken = jwt.sign(
            { role: "ADMIN" },
            process.env.JWT_SECRET,
            {
                subject: String(adminUser.id),
                algorithm: "HS256",
                expiresIn: 900,
                issuer: process.env.JWT_ISSUER,
                audience: process.env.JWT_AUDIENCE
            }
        );

        const testChatId = "999888777"; // Cùng 1 khách hàng trên Telegram

        console.log("\n--- TEST CASE 1 & 2: KHÁCH HÀNG NHẮN TIN CHO BOT A VÀ BOT B ---");
        // 1. Khách gửi tin nhắn tới Bot A
        const updateA = {
            update_id: 1001,
            message: {
                message_id: 2001,
                chat: { id: testChatId, first_name: "Khách A", type: "private" },
                from: { id: testChatId, first_name: "Khách A" },
                text: "Chào Shop A! Tôi muốn mua hàng",
                date: Math.floor(Date.now() / 1000)
            }
        };

        const resWebA = await fetch(`${teleBaseUrl}/telegram/webhook/111111111`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Telegram-Bot-Api-Secret-Token": "secret_a"
            },
            body: JSON.stringify(updateA)
        });
        assert(resWebA.status === 200, "Test 1.1: Webhook Bot A tiếp nhận thành công (200 OK)");

        // 2. Cùng khách đó gửi tin nhắn tới Bot B
        const updateB = {
            update_id: 1002,
            message: {
                message_id: 2002,
                chat: { id: testChatId, first_name: "Khách A", type: "private" },
                from: { id: testChatId, first_name: "Khách A" },
                text: "Chào Shop B! Bên bạn có ship không?",
                date: Math.floor(Date.now() / 1000)
            }
        };

        const resWebB = await fetch(`${teleBaseUrl}/telegram/webhook/222222222`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Telegram-Bot-Api-Secret-Token": "secret_b"
            },
            body: JSON.stringify(updateB)
        });
        assert(resWebB.status === 200, "Test 2.1: Webhook Bot B tiếp nhận thành công (200 OK)");

        // Chờ DB ghi nhận
        await new Promise(r => setTimeout(r, 200));

        // Kiểm tra 2 conversation độc lập được tạo trong Database
        const convCheckA = await pool.query(
            "SELECT id, channel_account_id, external_chat_id FROM conversations WHERE channel_account_id = $1 AND external_chat_id = $2",
            [channelAccountIdA, testChatId]
        );
        const convCheckB = await pool.query(
            "SELECT id, channel_account_id, external_chat_id FROM conversations WHERE channel_account_id = $1 AND external_chat_id = $2",
            [channelAccountIdB, testChatId]
        );

        assert(convCheckA.rows.length === 1, "Test 1.2: Tạo đúng 1 conversation gắn với Bot A");
        assert(convCheckB.rows.length === 1, "Test 2.2: Tạo đúng 1 conversation khác gắn với Bot B");
        assert(convCheckA.rows[0].id !== convCheckB.rows[0].id, "Test 2.3: Cuộc trò chuyện của Bot A và Bot B có ID hoàn toàn riêng biệt");

        const convIdA = convCheckA.rows[0].id;
        const convIdB = convCheckB.rows[0].id;

        console.log("\n--- TEST CASE 3 & 4: SUPPORT TRẢ LỜI ĐÚNG BOT (OUTBOUND ROUTING) ---");
        // Support trả lời cuộc hội thoại của Bot A
        const replyA = await messageService.sendMessage({
            conversationId: convIdA,
            content: "Chào bạn, Shop A sẵn sàng hỗ trợ!",
            clientRequestId: crypto.randomUUID(),
            sentByUserId: adminUser.id
        });
        assert(replyA.message.status === "sent", "Test 3.1: Gửi tin nhắn trả lời qua Bot A thành công");
        assert(botA.sentMessages.length === 1, "Test 3.2: Bot A thực hiện lệnh gửi tin nhắn ra Telegram");
        assert(botA.sentMessages[0].text === "Chào bạn, Shop A sẵn sàng hỗ trợ!", "Test 3.3: Nội dung tin nhắn khớp 100%");

        // Support trả lời cuộc hội thoại của Bot B
        const replyB = await messageService.sendMessage({
            conversationId: convIdB,
            content: "Shop B có ship COD toàn quốc bạn nhé!",
            clientRequestId: crypto.randomUUID(),
            sentByUserId: adminUser.id
        });
        assert(replyB.message.status === "sent", "Test 4.1: Gửi tin nhắn trả lời qua Bot B thành công");
        assert(botB.sentMessages.length === 1, "Test 4.2: Bot B thực hiện lệnh gửi tin nhắn ra Telegram (không nhầm sang Bot A)");
        assert(botB.sentMessages[0].text === "Shop B có ship COD toàn quốc bạn nhé!", "Test 4.3: Nội dung tin nhắn của Bot B khớp");

        console.log("\n--- TEST CASE 5: KHÁCH GỬI ẢNH CHO BOT C ---");
        const updateC = {
            update_id: 1003,
            message: {
                message_id: 2003,
                chat: { id: testChatId, first_name: "Khách A", type: "private" },
                from: { id: testChatId, first_name: "Khách A" },
                photo: [
                    { file_id: "photo_c_small", file_size: 1000, width: 320, height: 240 },
                    { file_id: "photo_c_large", file_size: 5000, width: 1280, height: 960 }
                ],
                caption: "Ảnh lỗi gửi Bot C",
                date: Math.floor(Date.now() / 1000)
            }
        };

        const resWebC = await fetch(`${teleBaseUrl}/telegram/webhook/333333333`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Telegram-Bot-Api-Secret-Token": "secret_c"
            },
            body: JSON.stringify(updateC)
        });
        assert(resWebC.status === 200, "Test 5.1: Webhook Bot C nhận ảnh thành công (200 OK)");

        await new Promise(r => setTimeout(r, 200));
        const convCheckC = await pool.query(
            "SELECT id FROM conversations WHERE channel_account_id = $1 AND external_chat_id = $2",
            [channelAccountIdC, testChatId]
        );
        assert(convCheckC.rows.length === 1, "Test 5.2: Bot C tạo conversation riêng cho ảnh gửi đến");

        console.log("\n--- TEST CASE 6: XÁC MINH SECRET TOKEN (WEBHOOK SECURITY) ---");
        const resWrongSecret = await fetch(`${teleBaseUrl}/telegram/webhook/111111111`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Telegram-Bot-Api-Secret-Token": "wrong_secret_token"
            },
            body: JSON.stringify(updateA)
        });
        assert(resWrongSecret.status === 403, "Test 6.1: Webhook có secret sai bị chặn với HTTP 403");

        const resMissingSecret = await fetch(`${teleBaseUrl}/telegram/webhook/111111111`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updateA)
        });
        assert(resMissingSecret.status === 403, "Test 6.2: Webhook thiếu secret bị chặn với HTTP 403");

        console.log("\n--- TEST CASE 7: CHỐNG TRÙNG LẶP WEBHOOK (IDEMPOTENCY) ---");
        // Gửi lại updateA lần thứ hai
        const resDuplicate = await fetch(`${teleBaseUrl}/telegram/webhook/111111111`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Telegram-Bot-Api-Secret-Token": "secret_a"
            },
            body: JSON.stringify(updateA)
        });
        assert(resDuplicate.status === 200, "Test 7.1: Webhook lặp vẫn trả về 200 OK để Telegram dừng retry");

        const countMessagesA = await pool.query(
            "SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1 AND external_message_id = '2001'",
            [convIdA]
        );
        assert(countMessagesA.rows[0].count === 1, "Test 7.2: Database chỉ lưu duy nhất 1 bản ghi tin nhắn, không nhân đôi");

        console.log("\n--- TEST CASE 8: BOT KHÔNG TỒN TẠI HOẶC BỊ TẮT ---");
        const resNonExistentBot = await fetch(`${teleBaseUrl}/telegram/webhook/999999999`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "any" },
            body: JSON.stringify(updateA)
        });
        assert(resNonExistentBot.status === 404, "Test 8.1: Webhook gọi vào botId không tồn tại trả về HTTP 404");

        const resSendWrongBot = await fetch(`${teleBaseUrl}/internal/messages/send`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-api-key": process.env.INTERNAL_API_KEY
            },
            body: JSON.stringify({
                chatId: "12345",
                content: "Test",
                externalAccountId: "999999999"
            })
        });
        assert(resSendWrongBot.status === 404, "Test 8.2: Internal gửi tin bằng bot không tồn tại trả về 404 Not Found");

        console.log("\n--- TEST CASE 9 & 10: API DASHBOARD LỌC VÀ HIỂN THỊ BOT ---");
        // Lấy danh sách channel-accounts
        const accountsRes = await fetch(`${chatBaseUrl}/api/conversations/channel-accounts`, {
            headers: { "Cookie": `mc_access=${adminToken}` }
        });
        const accountsData = await accountsRes.json();
        assert(accountsRes.status === 200, "Test 10.1: GET /api/conversations/channel-accounts trả về 200");
        assert(accountsData.data.length >= 3, "Test 10.2: Trả về đầy đủ danh sách các bot đang hoạt động");

        // Lọc cuộc trò chuyện theo Bot A
        const filterResA = await fetch(`${chatBaseUrl}/api/conversations?channelAccountId=${channelAccountIdA}`, {
            headers: { "Cookie": `mc_access=${adminToken}` }
        });
        const filterDataA = await filterResA.json();
        assert(filterResA.status === 200, "Test 9.1: GET /api/conversations?channelAccountId=A trả về 200");
        assert(filterDataA.data.every(c => c.channelAccountId === channelAccountIdA), "Test 9.2: Tất cả hội thoại trả về đều thuộc Bot A");
        assert(filterDataA.data[0].botName === "Shop A Bot", "Test 9.3: Bản ghi hội thoại có botName = 'Shop A Bot'");
        assert(filterDataA.data[0].botUsername === "shop_a_bot", "Test 9.4: Bản ghi hội thoại có botUsername = 'shop_a_bot'");

        // Lọc cuộc trò chuyện theo Bot B
        const filterResB = await fetch(`${chatBaseUrl}/api/conversations?channelAccountId=${channelAccountIdB}`, {
            headers: { "Cookie": `mc_access=${adminToken}` }
        });
        const filterDataB = await filterResB.json();
        assert(filterDataB.data.every(c => c.channelAccountId === channelAccountIdB), "Test 9.5: Tất cả hội thoại lọc theo Bot B đều thuộc Bot B");
        assert(filterDataB.data[0].botName === "Shop B Bot", "Test 9.6: Bản ghi hội thoại có botName = 'Shop B Bot'");

        console.log("\n================================================================================");
        console.log(`  🎉 TỔNG KẾT: TẤT CẢ ${passedCount}/${totalCount} TEST CASES MULTI-BOT ĐÃ VƯỢT QUA XUẤT SẮC!`);
        console.log("================================================================================\n");

    } finally {
        if (chatServer) chatServer.close();
        if (teleServer) teleServer.close();
        await pool.end();
    }
}

runTest().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
