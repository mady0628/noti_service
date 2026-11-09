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

const pool = require(path.join(rootDir, "service", "chat_service", "src", "config", "database"));
const chatApp = require(path.join(rootDir, "service", "chat_service", "src", "app"));
const telegramAttachService = require(path.join(rootDir, "service", "telegram_service", "src", "services", "telegram-attachment.service"));
const { sendIncomingAttachment } = require(path.join(rootDir, "service", "telegram_service", "src", "services", "chat-client.service"));

let chatServer, chatBaseUrl;
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

async function runTest() {
    console.log("\n================================================================================");
    console.log("       KIỂM THỬ XỬ LÝ ẢNH & TÀI LIỆU TELEGRAM GỬI ĐẾN (INCOMING ATTACHMENT)");
    console.log("================================================================================\n");

    let testConversationId;
    let testChannelAccountId;

    await new Promise((resolve) => {
        chatServer = http.createServer(chatApp);
        chatServer.listen(0, "127.0.0.1", () => {
            chatBaseUrl = `http://127.0.0.1:${chatServer.address().port}`;
            process.env.CHAT_SERVICE_URL = chatBaseUrl;
            console.log(`[INIT] Chat Service test listener chạy tại: ${chatBaseUrl}`);
            resolve();
        });
    });

    try {
        // Chuẩn bị Channel Account trong DB
        let channelId = (await pool.query("SELECT id FROM channels WHERE code = 'TELEGRAM'")).rows[0]?.id;
        if (!channelId) {
            const ins = await pool.query("INSERT INTO channels (code, name, is_active) VALUES ('TELEGRAM', 'Telegram', true) RETURNING id");
            channelId = ins.rows[0].id;
        }

        const externalBotId = "bot_incoming_test_123";
        let accRes = await pool.query("SELECT id FROM channel_accounts WHERE external_account_id = $1", [externalBotId]);
        if (accRes.rows.length === 0) {
            const ins = await pool.query(
                "INSERT INTO channel_accounts (channel_id, name, external_account_id, is_active) VALUES ($1, 'Test Bot Incoming', $2, true) RETURNING id",
                [channelId, externalBotId]
            );
            testChannelAccountId = ins.rows[0].id;
        } else {
            testChannelAccountId = accRes.rows[0].id;
        }

        console.log("--- 1. KIỂM THỬ CHỌN ẢNH LỚN NHẤT (getLargestPhoto) ---");
        const samplePhotos = [
            { file_id: "small_id", width: 160, height: 120, file_size: 1000 },
            { file_id: "medium_id", width: 640, height: 480, file_size: 15000 },
            { file_id: "large_id", width: 1280, height: 960, file_size: 45000 }
        ];
        const largest = telegramAttachService.getLargestPhoto(samplePhotos);
        assert(largest.file_id === "large_id", "Test 1.1: getLargestPhoto chọn chính xác ảnh lớn nhất theo file_size");

        const photosWithoutSize = [
            { file_id: "area_small", width: 200, height: 200 },
            { file_id: "area_big", width: 800, height: 600 }
        ];
        const largestByArea = telegramAttachService.getLargestPhoto(photosWithoutSize);
        assert(largestByArea.file_id === "area_big", "Test 1.2: getLargestPhoto fallback chọn ảnh diện tích lớn nhất khi thiếu file_size");

        console.log("\n--- 2. KIỂM THỬ TELEGRAM SERVICE GỬI MULTIPART SANG CHAT SERVICE (INCOMING PHOTO) ---");
        const photoBuffer = Buffer.from("FAKE_IMAGE_BINARY_BYTES_TELEGRAM_PHOTO_JPG");
        const externalChatId = `chat_incoming_${Date.now()}`;
        const externalPhotoMessageId = `msg_photo_${Date.now()}`;

        const incomingPhotoResult = await sendIncomingAttachment({
            externalAccountId: externalBotId,
            chatId: externalChatId,
            externalMessageId: externalPhotoMessageId,
            externalSenderId: "tg_user_111",
            displayName: "Khách hàng Nguyễn Văn A",
            username: "nguyenvana",
            chatType: "private",
            messageType: "image",
            caption: "Chào shop, đây là ảnh áo tôi muốn đặt mua",
            sentAt: new Date().toISOString(),
            externalFileId: "tg_file_photo_abc123",
            file: {
                buffer: photoBuffer,
                fileName: "telegram_photo.jpg",
                mimeType: "image/jpeg"
            }
        });

        assert(Boolean(incomingPhotoResult.conversationId), "Test 2.1: Chat Service tạo conversationId cho tin nhắn đến");
        assert(Boolean(incomingPhotoResult.messageId), "Test 2.2: Chat Service lưu incoming message thành công");
        assert(Boolean(incomingPhotoResult.attachmentId), "Test 2.3: Chat Service lưu attachmentId thành công");
        assert(incomingPhotoResult.duplicate === false, "Test 2.4: Lần đầu nhận duplicate = false");

        testConversationId = incomingPhotoResult.conversationId;

        console.log("\n--- 3. KIỂM THỬ CHỐNG TRÙNG LẶP WEBHOOK (INCOMING DUPLICATE WEBHOOK) ---");
        // Giả lập webhook Telegram gửi lại lần 2 do mạng
        const duplicatePhotoResult = await sendIncomingAttachment({
            externalAccountId: externalBotId,
            chatId: externalChatId,
            externalMessageId: externalPhotoMessageId,
            externalSenderId: "tg_user_111",
            displayName: "Khách hàng Nguyễn Văn A",
            username: "nguyenvana",
            chatType: "private",
            messageType: "image",
            caption: "Chào shop, đây là ảnh áo tôi muốn đặt mua",
            sentAt: new Date().toISOString(),
            externalFileId: "tg_file_photo_abc123",
            file: {
                buffer: photoBuffer,
                fileName: "telegram_photo.jpg",
                mimeType: "image/jpeg"
            }
        });

        assert(duplicatePhotoResult.duplicate === true, "Test 3.1: Gửi lại webhook trùng phát hiện duplicate = true");

        // Kiểm tra trong DB không bị sinh ra 2 bản ghi
        const countRes = await pool.query(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = $1 AND external_message_id = $2",
            [testConversationId, externalPhotoMessageId]
        );
        assert(Number(countRes.rows[0].count) === 1, "Test 3.2: DB chỉ lưu đúng 1 tin nhắn duy nhất, không nhân đôi");

        console.log("\n--- 4. KIỂM THỬ NHẬN TÀI LIỆU TELEGRAM (INCOMING DOCUMENT PDF) ---");
        const docBuffer = Buffer.from("%PDF-1.4 TEST PDF INCOMING DOCUMENT FROM TELEGRAM");
        const externalDocMessageId = `msg_doc_${Date.now()}`;

        const incomingDocResult = await sendIncomingAttachment({
            externalAccountId: externalBotId,
            chatId: externalChatId,
            externalMessageId: externalDocMessageId,
            externalSenderId: "tg_user_111",
            displayName: "Khách hàng Nguyễn Văn A",
            username: "nguyenvana",
            chatType: "private",
            messageType: "document",
            caption: "Gửi shop file hóa đơn chuyển khoản",
            sentAt: new Date().toISOString(),
            externalFileId: "tg_file_doc_xyz789",
            file: {
                buffer: docBuffer,
                fileName: "hoadon.pdf",
                mimeType: "application/pdf"
            }
        });

        assert(incomingDocResult.duplicate === false, "Test 4.1: Nhận tài liệu incoming document thành công");
        assert(Boolean(incomingDocResult.attachmentId), "Test 4.2: Lưu attachment cho file PDF thành công");

        console.log("\n--- 5. KIỂM THỬ XÁC THỰC VÀ TẢI FILE (/api/attachments/:id) CHO NHÂN VIÊN ---");
        // Ký token admin
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

        // Tải ảnh incoming qua GET /api/attachments/:id
        const photoDownloadRes = await fetch(`${chatBaseUrl}/api/attachments/${incomingPhotoResult.attachmentId}`, {
            headers: { "Cookie": `mc_access=${adminToken}` }
        });
        assert(photoDownloadRes.status === 200, "Test 5.1: Tải ảnh Telegram về thành công 200 OK");
        assert(photoDownloadRes.headers.get("content-type").includes("image/jpeg"), "Test 5.2: Đúng Content-Type image/jpeg");
        const photoContent = await photoDownloadRes.text();
        assert(photoContent === photoBuffer.toString("utf8"), "Test 5.3: Nội dung ảnh tải về khớp 100%");

        // Tải tài liệu incoming PDF
        const docDownloadRes = await fetch(`${chatBaseUrl}/api/attachments/${incomingDocResult.attachmentId}`, {
            headers: { "Cookie": `mc_access=${adminToken}` }
        });
        assert(docDownloadRes.status === 200, "Test 5.4: Tải tài liệu PDF thành công 200 OK");
        assert(docDownloadRes.headers.get("content-type").includes("application/pdf"), "Test 5.5: Đúng Content-Type application/pdf");
        const docContent = await docDownloadRes.text();
        assert(docContent === docBuffer.toString("utf8"), "Test 5.6: Nội dung tài liệu PDF khớp 100%");

        // Kiểm tra danh sách tin nhắn hiển thị cả 2 attachment
        const messagesRes = await fetch(`${chatBaseUrl}/api/conversations/${testConversationId}/messages`, {
            headers: { "Cookie": `mc_access=${adminToken}` }
        });
        const messagesData = await messagesRes.json();
        assert(messagesData.data.length >= 2, "Test 5.7: API lấy lịch sử tin nhắn trả về đủ các tin nhắn đến kèm attachment");

        console.log("\n================================================================================");
        console.log(`  🎉 TỔNG KẾT: TẤT CẢ ${passedCount}/${totalCount} TEST CASES INCOMING ATTACHMENT ĐÃ VƯỢT QUA!`);
        console.log("================================================================================\n");

    } finally {
        if (chatServer) chatServer.close();
        if (testConversationId) {
            await pool.query("DELETE FROM messages WHERE conversation_id = $1", [testConversationId]);
            await pool.query("DELETE FROM conversations WHERE id = $1", [testConversationId]);
        }
        await pool.end();
    }
}

runTest().catch((err) => {
    console.error("Lỗi kiểm thử:", err);
    process.exit(1);
});
