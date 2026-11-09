const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const chatNodeModules = path.join(rootDir, "service", "chat_service", "node_modules");
module.paths.push(chatNodeModules);

require("dotenv").config({ path: path.join(rootDir, "service", "chat_service", ".env") });
const pool = require(path.join(rootDir, "service", "chat_service", "src", "config", "database"));

const messageService = require(path.join(rootDir, "service", "chat_service", "src", "services", "message.service"));
const messageRepository = require(path.join(rootDir, "service", "chat_service", "src", "repository", "message.repository"));
const telegramClient = require(path.join(rootDir, "service", "chat_service", "src", "services", "telegram-client.service"));

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

async function runTests() {
    console.log("\n=======================================================");
    console.log("   KIỂM TRA HÀM sendAttachment() VÀ CÁC REPOSITORY MỚI");
    console.log("=======================================================\n");

    let testConversationId;
    let closedConversationId;
    let testUserId;

    try {
        // Xóa sạch các test conversation cũ nếu còn sót
        await pool.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE external_chat_id LIKE 'test_attach_%')");
        await pool.query("DELETE FROM conversations WHERE external_chat_id LIKE 'test_attach_%'");

        // 1. Chuẩn bị dữ liệu kiểm thử trong DB
        // Tìm hoặc tạo channel TELEGRAM
        let channelRes = await pool.query("SELECT id FROM channels WHERE code = 'TELEGRAM'");
        let channelId = channelRes.rows[0]?.id;
        if (!channelId) {
            const ins = await pool.query("INSERT INTO channels (code, name, is_active) VALUES ('TELEGRAM', 'Telegram', true) RETURNING id");
            channelId = ins.rows[0].id;
        }

        // Tìm hoặc tạo channel_account
        let accRes = await pool.query("SELECT id FROM channel_accounts WHERE channel_id = $1 AND is_active = true", [channelId]);
        let channelAccountId = accRes.rows[0]?.id;
        if (!channelAccountId) {
            const ins = await pool.query(
                "INSERT INTO channel_accounts (channel_id, name, external_account_id, is_active) VALUES ($1, 'Test Bot', 'test_bot_123', true) RETURNING id",
                [channelId]
            );
            channelAccountId = ins.rows[0].id;
        }

        // Tìm hoặc tạo admin user
        let userRes = await pool.query("SELECT id FROM users LIMIT 1");
        testUserId = userRes.rows[0]?.id;

        const randomSuffix = Date.now().toString();
        // Tạo cuộc hội thoại mở (status = 'open')
        const convRes = await pool.query(
            `INSERT INTO conversations (channel_account_id, external_chat_id, status)
             VALUES ($1, $2, 'open')
             RETURNING id`,
            [channelAccountId, `test_attach_open_${randomSuffix}`]
        );
        testConversationId = convRes.rows[0].id;

        // Tạo cuộc hội thoại đóng (status = 'closed')
        const closedConvRes = await pool.query(
            `INSERT INTO conversations (channel_account_id, external_chat_id, status)
             VALUES ($1, $2, 'closed')
             RETURNING id`,
            [channelAccountId, `test_attach_closed_${randomSuffix}`]
        );
        closedConversationId = closedConvRes.rows[0].id;

        console.log("--- 1. KIỂM TRA VALIDATION FILE & CONVERSATION ---");

        // Case 1: Conversation không tồn tại
        try {
            await messageService.sendAttachment({
                conversationId: crypto.randomUUID(),
                content: "Test",
                clientRequestId: crypto.randomUUID(),
                sentByUserId: testUserId,
                file: { buffer: Buffer.from("test"), size: 4, mimetype: "image/png", originalname: "test.png" }
            });
            assert(false, "Case 1: Phải báo lỗi khi conversation không tồn tại");
        } catch (err) {
            assert(err.statusCode === 404, "Case 1: Conversation không tồn tại trả về 404");
        }

        // Case 2: Conversation đóng (closed)
        try {
            await messageService.sendAttachment({
                conversationId: closedConversationId,
                content: "Test",
                clientRequestId: crypto.randomUUID(),
                sentByUserId: testUserId,
                file: { buffer: Buffer.from("test"), size: 4, mimetype: "image/png", originalname: "test.png" }
            });
            assert(false, "Case 2: Phải báo lỗi khi conversation closed");
        } catch (err) {
            assert(err.statusCode === 409, "Case 2: Conversation không ở trạng thái open trả về 409");
        }

        // Case 3: Thiếu file
        try {
            await messageService.sendAttachment({
                conversationId: testConversationId,
                content: "Test",
                clientRequestId: crypto.randomUUID(),
                sentByUserId: testUserId,
                file: null
            });
            assert(false, "Case 3: Phải báo lỗi khi thiếu file");
        } catch (err) {
            assert(err.statusCode === 400 && err.message === "File is required", "Case 3: Thiếu file trả về 400 File is required");
        }

        // Case 4: File vượt quá 20MB
        try {
            await messageService.sendAttachment({
                conversationId: testConversationId,
                content: "Test",
                clientRequestId: crypto.randomUUID(),
                sentByUserId: testUserId,
                file: {
                    buffer: Buffer.alloc(10),
                    size: 21 * 1024 * 1024,
                    mimetype: "image/png",
                    originalname: "huge.png"
                }
            });
            assert(false, "Case 4: Phải báo lỗi khi file > 20MB");
        } catch (err) {
            assert(err.statusCode === 400, "Case 4: File vượt quá 20MB trả về 400");
        }

        // Case 5: Định dạng không hỗ trợ (mimetype không cho phép)
        try {
            await messageService.sendAttachment({
                conversationId: testConversationId,
                content: "Test",
                clientRequestId: crypto.randomUUID(),
                sentByUserId: testUserId,
                file: {
                    buffer: Buffer.from("MZ..."),
                    size: 5,
                    mimetype: "application/x-msdownload",
                    originalname: "virus.exe"
                }
            });
            assert(false, "Case 5: Phải báo lỗi với file exe");
        } catch (err) {
            assert(err.statusCode === 400 && err.message === "Unsupported file type", "Case 5: Mimetype không hỗ trợ trả về 400 Unsupported file type");
        }

        console.log("\n--- 2. KIỂM TRA LƯU STORAGE, DB & GỌI TELEGRAM THÀNH CÔNG ---");

        // Giả lập telegramClient.sendTelegramAttachment thành công
        const originalSendTelegramAttachment = telegramClient.sendTelegramAttachment;
        telegramClient.sendTelegramAttachment = async (params) => {
            return {
                externalMessageId: "tg_msg_8888",
                externalFileId: "tg_file_photo_9999",
                sentAt: new Date().toISOString()
            };
        };

        const testClientRequestId = crypto.randomUUID();
        const fileContent = "This is test image file buffer content 123456";
        const fileBuffer = Buffer.from(fileContent);
        const testFile = {
            buffer: fileBuffer,
            size: fileBuffer.length,
            mimetype: "image/png",
            originalname: "photo.png"
        };

        const result = await messageService.sendAttachment({
            conversationId: testConversationId,
            content: "Ảnh hóa đơn mua hàng",
            clientRequestId: testClientRequestId,
            sentByUserId: testUserId,
            file: testFile
        });

        assert(result.duplicate === false, "Case 6.1: Gửi lần đầu duplicate = false");
        assert(result.outcomeUnknown === false, "Case 6.2: Gửi thành công outcomeUnknown = false");
        assert(result.message.status === "sent", "Case 6.3: Message status cập nhật thành sent");
        assert(result.message.external_message_id === "tg_msg_8888", "Case 6.4: external_message_id lưu đúng");
        assert(result.attachment.external_file_id === "tg_file_photo_9999", "Case 6.5: Attachment external_file_id lưu đúng");

        // Kiểm tra file thực tế trong storage
        const storagePath = path.join(rootDir, "service", "chat_service", "storage", result.attachment.storage_key);
        assert(fs.existsSync(storagePath), "Case 6.6: File được lưu thực tế trên disk storage");
        const onDiskContent = fs.readFileSync(storagePath, "utf8");
        assert(onDiskContent === fileContent, "Case 6.7: Nội dung file trên disk trùng khớp 100%");

        // Kiểm tra checksum trong database
        const expectedChecksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        assert(result.attachment.checksum_sha256 === expectedChecksum, "Case 6.8: Checksum SHA-256 lưu chính xác trong database");

        // Kiểm tra getMessage trả về attachments array và url
        const messagesResult = await messageService.getMessage(testConversationId, 10);
        const lastMsg = messagesResult.data.find(m => m.id === result.message.id);
        assert(Boolean(lastMsg && Array.isArray(lastMsg.attachments)), "Case 6.9: getMessage trả về mảng attachments");
        assert(lastMsg.attachments.length === 1, "Case 6.10: Mảng attachments có đúng 1 phần tử");
        assert(lastMsg.attachments[0].url === `/api/attachments/${result.attachment.id}`, "Case 6.11: Attachment có trường url định dạng /api/attachments/:id");

        console.log("\n--- 3. KIỂM TRA TÍNH BẤT BIẾN (IDEMPOTENCY / DUPLICATE REQUEST) ---");

        // Gửi lại CHÍNH XÁC request trùng lặp (cùng clientRequestId, cùng file)
        const duplicateResult = await messageService.sendAttachment({
            conversationId: testConversationId,
            content: "Ảnh hóa đơn mua hàng",
            clientRequestId: testClientRequestId,
            sentByUserId: testUserId,
            file: testFile
        });

        assert(duplicateResult.duplicate === true, "Case 7.1: Gửi lại request cũ phát hiện duplicate = true");
        assert(duplicateResult.message.id === result.message.id, "Case 7.2: Trả về đúng message cũ");
        assert(duplicateResult.attachment.id === result.attachment.id, "Case 7.3: Trả về đúng attachment cũ");

        // Gửi lại clientRequestId đó nhưng file nội dung KHÁC
        try {
            await messageService.sendAttachment({
                conversationId: testConversationId,
                content: "Ảnh hóa đơn mua hàng",
                clientRequestId: testClientRequestId,
                sentByUserId: testUserId,
                file: {
                    buffer: Buffer.from("DIFFERENT FILE CONTENT!"),
                    size: Buffer.from("DIFFERENT FILE CONTENT!").length,
                    mimetype: "image/png",
                    originalname: "photo.png"
                }
            });
            assert(false, "Case 8: Phải chặn khi cùng clientRequestId nhưng file khác");
        } catch (err) {
            assert(err.statusCode === 409 && err.message === "Duplicate request has different file content", "Case 8: Chặn đổi file với clientRequestId cũ (409 Duplicate request has different file content)");
        }

        console.log("\n--- 4. KIỂM TRA XỬ LÝ TIMEOUT / LỖI MẠNG TỪ TELEGRAM ---");

        telegramClient.sendTelegramAttachment = async () => {
            const err = new Error("Gateway Timeout from Telegram");
            err.code = "ETIMEDOUT";
            throw err;
        };

        const timeoutRequestId = crypto.randomUUID();
        const timeoutResult = await messageService.sendAttachment({
            conversationId: testConversationId,
            content: "Tài liệu hợp đồng",
            clientRequestId: timeoutRequestId,
            sentByUserId: testUserId,
            file: {
                buffer: Buffer.from("Contract text pdf content"),
                size: Buffer.from("Contract text pdf content").length,
                mimetype: "application/pdf",
                originalname: "contract.pdf"
            }
        });

        assert(timeoutResult.outcomeUnknown === true, "Case 9.1: Khi Telegram timeout, outcomeUnknown = true");
        assert(timeoutResult.message.status === "pending", "Case 9.2: Giữ message ở trạng thái pending để tránh gửi trùng");
        assert(Boolean(timeoutResult.attachment), "Case 9.3: Attachment vẫn được lưu an toàn");

        // Khôi phục telegramClient gốc
        telegramClient.sendTelegramAttachment = originalSendTelegramAttachment;

        console.log("\n--- 5. KIỂM TRA ENDPOINT GET /api/attachments/:id ---");
        const http = require("http");
        const jwt = require("jsonwebtoken");
        const chatApp = require(path.join(rootDir, "service", "chat_service", "src", "app"));

        let chatServer;
        let chatBaseUrl;
        await new Promise((resolve) => {
            chatServer = http.createServer(chatApp);
            chatServer.listen(0, "127.0.0.1", () => {
                chatBaseUrl = `http://127.0.0.1:${chatServer.address().port}`;
                resolve();
            });
        });

        try {
            // Tạo token JWT hợp lệ cho user
            const testToken = jwt.sign(
                { role: "ADMIN" },
                process.env.JWT_SECRET,
                {
                    subject: String(testUserId),
                    algorithm: "HS256",
                    expiresIn: 900,
                    issuer: process.env.JWT_ISSUER,
                    audience: process.env.JWT_AUDIENCE
                }
            );

            // Gọi tải file đính kèm vừa lưu
            const attachRes = await fetch(`${chatBaseUrl}/api/attachments/${result.attachment.id}`, {
                headers: {
                    "Cookie": `mc_access=${testToken}`
                }
            });

            assert(attachRes.status === 200, "Case 10.1: GET /api/attachments/:id trả về HTTP 200");
            assert(attachRes.headers.get("content-type").includes("image/png"), "Case 10.2: Trả về đúng Content-Type image/png");
            const downloadedText = await attachRes.text();
            assert(downloadedText === fileContent, "Case 10.3: Nội dung file tải về trùng khớp 100%");

            // Thử tải với id không tồn tại
            const notFoundRes = await fetch(`${chatBaseUrl}/api/attachments/${crypto.randomUUID()}`, {
                headers: {
                    "Cookie": `mc_access=${testToken}`
                }
            });
            assert(notFoundRes.status === 404, "Case 10.4: ID attachment không tồn tại trả về 404");

        } finally {
            if (chatServer) chatServer.close();
        }

        console.log("\n=======================================================");
        console.log(`  KẾT QUẢ: TẤT CẢ ${passedCount}/${totalCount} TEST CASE ĐÃ VƯỢT QUA XUẤT SẮC!`);
        console.log("=======================================================\n");

    } finally {
        // Dọn dẹp dữ liệu test
        if (testConversationId) {
            await pool.query("DELETE FROM messages WHERE conversation_id = $1", [testConversationId]);
            await pool.query("DELETE FROM conversations WHERE id = $1", [testConversationId]);
        }
        if (closedConversationId) {
            await pool.query("DELETE FROM conversations WHERE id = $1", [closedConversationId]);
        }
        await pool.end();
    }
}

runTests().catch(err => {
    console.error("Test failed with error:", err);
    process.exit(1);
});
