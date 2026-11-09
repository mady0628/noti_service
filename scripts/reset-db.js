const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
module.paths.push(path.join(rootDir, "service", "chat_service", "node_modules"));
module.paths.push(path.join(rootDir, "service", "auth_service", "node_modules"));

const bcrypt = require("bcryptjs");
require("dotenv").config({ path: path.join(rootDir, "service", "auth_service", ".env") });
const chatEnv = require("dotenv").config({ path: path.join(rootDir, "service", "chat_service", ".env") }).parsed || {};
for (const [k, v] of Object.entries(chatEnv)) {
    if (!process.env[k]) process.env[k] = v;
}

const pool = require(path.join(rootDir, "service", "chat_service", "src", "config", "database"));

async function reset() {
    console.log("\n=======================================================");
    console.log("          KHỞI TẠO LẠI TOÀN BỘ CƠ SỞ DỮ LIỆU");
    console.log("=======================================================\n");

    try {
        // 1. Đọc và thực thi toàn bộ schema từ init.sql
        const initSqlPath = path.join(rootDir, "database", "init.sql");
        const sql = fs.readFileSync(initSqlPath, "utf8");

        console.log("1. Đang chạy database/init.sql (Drop tables & Recreate schema)...");
        await pool.query(sql);
        console.log("   -> Đã làm sạch và tái cấu trúc database thành công!");

        // 2. Tạo tài khoản Admin mặc định
        console.log("2. Đang tạo tài khoản Admin mặc định...");
        const adminPassword = process.env.ADMIN_PASSWORD || "AdminPassword123@";
        const passwordHash = await bcrypt.hash(adminPassword, 12);

        await pool.query(
            `
            INSERT INTO users (
                role_id,
                username,
                email,
                password_hash,
                full_name,
                status
            )
            SELECT
                r.id,
                'admin',
                'admin@example.com',
                $1,
                'System Administrator',
                'active'
            FROM roles r
            WHERE r.code = 'ADMIN'
            ON CONFLICT (username) DO NOTHING
            `,
            [passwordHash]
        );
        console.log("   -> Tạo Admin thành công:");
        console.log("      * Username: admin");
        console.log(`      * Password: ${adminPassword}`);

        // 3. Dọn dẹp các file rác trong thư mục lưu trữ attachment vật lý
        console.log("3. Đang dọn dẹp thư mục file đính kèm cục bộ (storage/attachments)...");
        const storageDir = path.join(rootDir, "service", "chat_service", "storage", "attachments");
        if (fs.existsSync(storageDir)) {
            const files = fs.readdirSync(storageDir);
            for (const file of files) {
                const fullPath = path.join(storageDir, file);
                fs.rmSync(fullPath, { recursive: true, force: true });
            }
        }
        console.log("   -> Đã dọn dẹp sạch sẽ ổ đĩa lưu trữ tệp!");

        console.log("\n=======================================================");
        console.log("  🎉 HOÀN TẤT: Database đã được làm sạch và sẵn sàng!");
        console.log("=======================================================\n");

    } catch (error) {
        console.error("Lỗi khi reset database:", error);
    } finally {
        await pool.end();
    }
}

reset();

