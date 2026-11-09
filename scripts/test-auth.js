const path = require("path");
const rootDir = path.join(__dirname, "..");
const authNodeModules = path.join(rootDir, "service", "auth_service", "node_modules");
module.paths.push(authNodeModules);
const chatNodeModules = path.join(rootDir, "service", "chat_service", "node_modules");
module.paths.push(chatNodeModules);

require("dotenv").config({ path: path.join(rootDir, "service", "auth_service", ".env") });
// Ensure both env configs are populated
const chatEnv = require("dotenv").config({ path: path.join(rootDir, "service", "chat_service", ".env") }).parsed || {};
for (const [k, v] of Object.entries(chatEnv)) {
    if (!process.env[k]) process.env[k] = v;
}

const http = require("http");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require(path.join(rootDir, "service", "auth_service", "src", "config", "database"));

const authApp = require(path.join(rootDir, "service", "auth_service", "src", "app"));
const chatApp = require(path.join(rootDir, "service", "chat_service", "src", "app"));

let authServer;
let chatServer;
let authBaseUrl;
let chatBaseUrl;

// Helper to extract cookies from Set-Cookie headers
const parseCookies = (setCookieHeaders) => {
    const cookies = {};
    if (!setCookieHeaders) return cookies;
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const item of list) {
        const parts = item.split(";")[0].split("=");
        cookies[parts[0].trim()] = parts.slice(1).join("=").trim();
    }
    return cookies;
};

// Form Cookie header string
const toCookieHeader = (cookies) => {
    return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
};

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
    console.log("   KIỂM TRA HỆ THỐNG AUTHENTICATION & RBAC TOÀN DIỆN");
    console.log("=======================================================\n");

    // 1. Khởi động 2 server trên cổng tạm
    await new Promise((resolve) => {
        authServer = http.createServer(authApp);
        authServer.listen(0, "127.0.0.1", () => {
            const port = authServer.address().port;
            authBaseUrl = `http://127.0.0.1:${port}`;
            console.log(`[INIT] Auth Service test listener running at ${authBaseUrl}`);
            resolve();
        });
    });

    await new Promise((resolve) => {
        chatServer = http.createServer(chatApp);
        chatServer.listen(0, "127.0.0.1", () => {
            const port = chatServer.address().port;
            chatBaseUrl = `http://127.0.0.1:${port}`;
            console.log(`[INIT] Chat Service test listener running at ${chatBaseUrl}`);
            resolve();
        });
    });

    try {
        // SUITE 1: AUTH SERVICE BASIC & VALIDATION
        console.log("\n--- [SUITE 1] Auth Service Basic & Security Middleware ---");

        // Test 1: GET /health
        {
            const res = await fetch(`${authBaseUrl}/health`);
            const data = await res.json();
            assert(res.status === 200 && data.status === "running", "Test 1: GET /health trả về 200 và running");
        }

        // Test 2: POST /auth/login không có header Origin -> Phải bị chặn 403
        {
            const res = await fetch(`${authBaseUrl}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "admin", password: "AdminPassword123@" })
            });
            const data = await res.json();
            assert(res.status === 403 && data.message === "Untrusted origin", "Test 2: POST /auth/login không có Origin bị chặn 403 Untrusted origin");
        }

        // Test 3: POST /auth/login với Origin giả mạo (https://evil.com) -> Phải bị chặn 403
        {
            const res = await fetch(`${authBaseUrl}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Origin": "https://evil-hacker.com"
                },
                body: JSON.stringify({ username: "admin", password: "AdminPassword123@" })
            });
            const data = await res.json();
            assert(res.status === 403 && data.message === "Untrusted origin", "Test 3: POST /auth/login từ evil origin bị chặn 403 Untrusted origin");
        }

        // Test 4: POST /auth/login với thông tin đăng nhập sai -> Phải trả về 401
        {
            const res = await fetch(`${authBaseUrl}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Origin": "http://localhost:5173"
                },
                body: JSON.stringify({ username: "admin", password: "WrongPassword999!" })
            });
            const data = await res.json();
            assert(res.status === 401 && data.message === "Invalid credentials", "Test 4: Đăng nhập sai mật khẩu trả về 401 Invalid credentials");
        }

        // Test 5: POST /auth/login với user không tồn tại -> 401
        {
            const res = await fetch(`${authBaseUrl}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Origin": "http://localhost:5173"
                },
                body: JSON.stringify({ username: "non_existent_user_xyz", password: "password" })
            });
            const data = await res.json();
            assert(res.status === 401 && data.message === "Invalid credentials", "Test 5: Đăng nhập user không tồn tại trả về 401 Invalid credentials");
        }

        // SUITE 2: ĐĂNG NHẬP THÀNH CÔNG VÀ KIỂM TRA COOKIES / DATABASE
        console.log("\n--- [SUITE 2] Login thành công, kiểm tra HttpOnly Cookies & Database ---");

        let authCookies = {};
        let adminUser = null;

        // Test 6: POST /auth/login hợp lệ
        {
            const res = await fetch(`${authBaseUrl}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Origin": "http://localhost:5173"
                },
                body: JSON.stringify({ username: "admin", password: "AdminPassword123@" })
            });
            const data = await res.json();
            const setCookieHeader = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
            authCookies = parseCookies(setCookieHeader);

            assert(res.status === 200 && data.success === true, "Test 6.1: Login hợp lệ trả về status 200 và success: true");
            assert(Boolean(authCookies.mc_access), "Test 6.2: Set-Cookie có mc_access (JWT)");
            assert(Boolean(authCookies.mc_refresh), "Test 6.3: Set-Cookie có mc_refresh");
            assert(data.data.user.role === "ADMIN", "Test 6.4: Role của user là ADMIN");
            assert(data.data.user.username === "admin", "Test 6.5: Username là admin");

            adminUser = data.data.user;
        }

        // Test 7: Kiểm tra Database lưu phiên refresh_sessions
        {
            const refreshHash = crypto.createHash("sha256").update(authCookies.mc_refresh).digest("hex");
            const dbRes = await pool.query(
                "SELECT * FROM refresh_sessions WHERE token_hash = $1",
                [refreshHash]
            );
            assert(dbRes.rows.length === 1, "Test 7.1: DB lưu chính xác bản ghi session với token_hash");
            assert(dbRes.rows[0].user_id === adminUser.id, "Test 7.2: Session gắn đúng user_id của admin");
            assert(dbRes.rows[0].revoked_at === null, "Test 7.3: Session mới chưa bị thu hồi (revoked_at is null)");
        }

        // SUITE 3: XÁC THỰC PHIÊN VỚI GET /auth/me
        console.log("\n--- [SUITE 3] GET /auth/me (Current User Profile) ---");

        // Test 8: GET /auth/me với cookie mc_access hợp lệ
        {
            const res = await fetch(`${authBaseUrl}/auth/me`, {
                headers: {
                    "Cookie": toCookieHeader({ mc_access: authCookies.mc_access })
                }
            });
            const data = await res.json();
            assert(res.status === 200 && data.data.user.username === "admin", "Test 8: GET /auth/me với mc_access trả về 200 và user profile");
        }

        // Test 9: GET /auth/me không có cookie
        {
            const res = await fetch(`${authBaseUrl}/auth/me`);
            const data = await res.json();
            assert(res.status === 401 && data.message === "Not authenticated", "Test 9: GET /auth/me không có cookie trả về 401 Not authenticated");
        }

        // Test 10: GET /auth/me với token giả / sửa đổi
        {
            const forgedToken = authCookies.mc_access + "tampered";
            const res = await fetch(`${authBaseUrl}/auth/me`, {
                headers: {
                    "Cookie": toCookieHeader({ mc_access: forgedToken })
                }
            });
            const data = await res.json();
            assert(res.status === 401 && data.message === "Invalid or expired session", "Test 10: GET /auth/me với token giả mạo trả về 401");
        }

        // SUITE 4: REFRESH TOKEN ROTATION & PHÁT HIỆN TẤN CÔNG REPLAY
        console.log("\n--- [SUITE 4] Refresh Token Rotation & Replay Attack Detection ---");

        const firstRefreshToken = authCookies.mc_refresh;
        let secondRefreshToken;
        let secondAccessToken;

        // Test 11: Refresh Token lần 1 hợp lệ
        {
            const res = await fetch(`${authBaseUrl}/auth/refresh`, {
                method: "POST",
                headers: {
                    "Origin": "http://localhost:5173",
                    "Cookie": toCookieHeader({ mc_refresh: firstRefreshToken })
                }
            });
            const data = await res.json();
            const setCookieHeader = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
            const newCookies = parseCookies(setCookieHeader);

            assert(res.status === 200 && data.success === true, "Test 11.1: POST /auth/refresh thành công trả về 200");
            assert(Boolean(newCookies.mc_refresh), "Test 11.2: Server cấp Refresh Token mới (Rotated)");
            assert(newCookies.mc_refresh !== firstRefreshToken, "Test 11.3: Token mới KHÁC token cũ (Rotation confirmed)");

            secondRefreshToken = newCookies.mc_refresh;
            secondAccessToken = newCookies.mc_access;

            // Kiểm tra DB: session cũ phải có replaced_by_session_id
            const oldHash = crypto.createHash("sha256").update(firstRefreshToken).digest("hex");
            const oldDbRes = await pool.query(
                "SELECT * FROM refresh_sessions WHERE token_hash = $1",
                [oldHash]
            );
            assert(oldDbRes.rows[0].replaced_by_session_id !== null, "Test 11.4: Session cũ được đánh dấu replaced_by_session_id");
            assert(oldDbRes.rows[0].revoked_at !== null, "Test 11.5: Session cũ đã bị revoked_at");
        }

        // Test 12: TẤN CÔNG REPLAY: Dùng lại Refresh Token cũ (firstRefreshToken) đã được xoay vòng
        {
            const res = await fetch(`${authBaseUrl}/auth/refresh`, {
                method: "POST",
                headers: {
                    "Origin": "http://localhost:5173",
                    "Cookie": toCookieHeader({ mc_refresh: firstRefreshToken })
                }
            });
            const data = await res.json();
            assert(res.status === 401 && data.message === "Refresh token reuse detected", "Test 12.1: Dùng lại token cũ bị chặn 401 'Refresh token reuse detected'");

            // Kiểm tra DB: toàn bộ family_id phải bị revoked!
            const checkFamily = await pool.query(
                "SELECT * FROM refresh_sessions WHERE family_id = (SELECT family_id FROM refresh_sessions WHERE token_hash = $1)",
                [crypto.createHash("sha256").update(firstRefreshToken).digest("hex")]
            );
            const allRevoked = checkFamily.rows.every(r => r.revoked_at !== null);
            assert(allRevoked === true, "Test 12.2: Hệ thống đã thu hồi TOÀN BỘ session trong family_id để ngăn chặn kẻ tấn công");
        }

        // Test 13: Vì family đã bị revoke, token mới (secondRefreshToken) cũng không thể dùng được nữa!
        {
            const res = await fetch(`${authBaseUrl}/auth/refresh`, {
                method: "POST",
                headers: {
                    "Origin": "http://localhost:5173",
                    "Cookie": toCookieHeader({ mc_refresh: secondRefreshToken })
                }
            });
            const data = await res.json();
            assert(res.status === 401, "Test 13: Token thứ hai cũng bị từ chối do cả family đã bị vô hiệu hóa an toàn");
        }

        // SUITE 5: LOGOUT
        console.log("\n--- [SUITE 5] POST /auth/logout ---");

        // Đăng nhập lại lấy phiên mới để test Logout
        let logoutCookies = {};
        {
            const res = await fetch(`${authBaseUrl}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Origin": "http://localhost:5173" },
                body: JSON.stringify({ username: "admin", password: "AdminPassword123@" })
            });
            const setCookieHeader = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
            logoutCookies = parseCookies(setCookieHeader);
        }

        // Test 14: Gọi logout
        {
            const res = await fetch(`${authBaseUrl}/auth/logout`, {
                method: "POST",
                headers: {
                    "Origin": "http://localhost:5173",
                    "Cookie": toCookieHeader({ mc_refresh: logoutCookies.mc_refresh })
                }
            });
            const data = await res.json();
            assert(res.status === 200 && data.message === "Logged out successfully", "Test 14.1: POST /auth/logout thành công 200");

            // Kiểm tra DB: session phải bị revoked
            const hash = crypto.createHash("sha256").update(logoutCookies.mc_refresh).digest("hex");
            const dbCheck = await pool.query(
                "SELECT * FROM refresh_sessions WHERE token_hash = $1",
                [hash]
            );
            assert(dbCheck.rows[0].revoked_at !== null, "Test 14.2: Session được đánh dấu revoked_at sau logout");
        }

        // SUITE 6: CHAT SERVICE AUTHENTICATION & RBAC (3002)
        console.log("\n--- [SUITE 6] Chat Service Authentication & RBAC Middleware ---");

        // Đăng nhập lại để có Access Token hợp lệ cho Chat Service
        let validAccessCookie;
        {
            const res = await fetch(`${authBaseUrl}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Origin": "http://localhost:5173" },
                body: JSON.stringify({ username: "admin", password: "AdminPassword123@" })
            });
            const setCookieHeader = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
            const cookies = parseCookies(setCookieHeader);
            validAccessCookie = cookies.mc_access;
        }

        // Test 15: Gọi /api/conversations KHÔNG có cookie -> 401
        {
            const res = await fetch(`${chatBaseUrl}/api/conversations`);
            const data = await res.json();
            assert(res.status === 401 && data.message === "Authentication required", "Test 15: Chat Service yêu cầu xác thực nếu thiếu mc_access cookie (401)");
        }

        // Test 16: Gọi /api/conversations với token giả mạo -> 401
        {
            const res = await fetch(`${chatBaseUrl}/api/conversations`, {
                headers: {
                    "Cookie": `mc_access=fake-token-here`
                }
            });
            const data = await res.json();
            assert(res.status === 401 && data.message === "Invalid or expired access token", "Test 16: Chat Service từ chối token giả mạo (401)");
        }

        // Test 17: Gọi /api/conversations với mc_access hợp lệ của ADMIN -> 200
        {
            const res = await fetch(`${chatBaseUrl}/api/conversations`, {
                headers: {
                    "Cookie": `mc_access=${validAccessCookie}`
                }
            });
            const data = await res.json();
            assert(res.status === 200 && data.success === true, "Test 17: Chat Service chấp nhận token hợp lệ từ Admin (200 OK)");
            assert(Array.isArray(data.data), "Test 17.2: Dữ liệu trả về danh sách conversations");
            assert(data.pagination && typeof data.pagination.page === "number", "Test 17.3: Dữ liệu phân trang pagination chuẩn");
        }

        // Test 18: Inactive User Check
        {
            // Lấy role SUPPORT có sẵn trong DB
            const roleRes = await pool.query("SELECT id FROM roles WHERE code = 'SUPPORT'");
            let roleId = roleRes.rows[0]?.id;
            if (!roleId) {
                const newRole = await pool.query("INSERT INTO roles (code, name) VALUES ('SUPPORT', 'Support Agent') RETURNING id");
                roleId = newRole.rows[0].id;
            }

            // Tạo user inactive
            const inactiveUserRes = await pool.query(
                `INSERT INTO users (username, email, password_hash, role_id, full_name, status)
                 VALUES ('inactive_agent', 'inactive@example.com', 'dummy_hash', $1, 'Inactive Agent', 'inactive')
                 ON CONFLICT (username) DO UPDATE SET status = 'inactive'
                 RETURNING id`,
                [roleId]
            );
            const inactiveUserId = inactiveUserRes.rows[0].id;

            // Ký token cho inactive user
            const inactiveToken = jwt.sign(
                { role: "SUPPORT" },
                process.env.JWT_SECRET,
                {
                    subject: String(inactiveUserId),
                    algorithm: "HS256",
                    expiresIn: 900,
                    issuer: process.env.JWT_ISSUER,
                    audience: process.env.JWT_AUDIENCE
                }
            );

            const res = await fetch(`${chatBaseUrl}/api/conversations`, {
                headers: {
                    "Cookie": `mc_access=${inactiveToken}`
                }
            });
            const data = await res.json();
            assert(res.status === 401 && data.message === "Invalid account", "Test 18: User có status 'inactive' bị chặn 401 'Invalid account'");
        }

        // Test 18.2: RBAC - Quyền hạn không khớp (role middleware)
        {
            const roleMiddleware = require(path.join(rootDir, "service", "chat_service", "src", "middlewares", "role.middleware"));
            const reqMock = { user: { role: "SUPPORT" } };
            let statusCalled = null;
            let jsonCalled = null;
            const resMock = {
                status: (code) => { statusCalled = code; return resMock; },
                json: (data) => { jsonCalled = data; return resMock; }
            };
            let nextCalled = false;
            // Endpoint chỉ cho phép ADMIN
            const adminOnly = roleMiddleware("ADMIN");
            adminOnly(reqMock, resMock, () => { nextCalled = true; });

            assert(statusCalled === 403 && jsonCalled.message === "Permission denied" && !nextCalled, "Test 18.2: RBAC allowRoles('ADMIN') chặn thành công role SUPPORT (403 Permission denied)");
        }

        // Test 19: Origin Protection trên POST /api/conversations/:id/messages
        {
            const res = await fetch(`${chatBaseUrl}/api/conversations/00000000-0000-0000-0000-000000000000/messages`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Cookie": `mc_access=${validAccessCookie}`
                    // Cố ý không gửi Origin
                },
                body: JSON.stringify({ content: "Hello" })
            });
            const data = await res.json();
            assert(res.status === 403 && data.message === "Untrusted origin", "Test 19: POST /api/conversations/:id/messages không có Origin bị chặn 403 Untrusted origin");
        }

        // Test 20: SSE Connection /api/events với auth
        {
            // Không có auth cookie
            const noAuthRes = await fetch(`${chatBaseUrl}/api/events`);
            assert(noAuthRes.status === 401, "Test 20.1: SSE /api/events không có cookie trả về 401");

            // Có auth cookie -> nhận stream
            const sseRes = await fetch(`${chatBaseUrl}/api/events`, {
                headers: {
                    "Cookie": `mc_access=${validAccessCookie}`,
                    "Accept": "text/event-stream"
                }
            });
            assert(sseRes.status === 200, "Test 20.2: SSE /api/events với token hợp lệ trả về HTTP 200");
            assert(sseRes.headers.get("content-type").includes("text/event-stream"), "Test 20.3: Content-Type là text/event-stream");

            // Đọc một đoạn stream để xác nhận sự kiện connected
            const reader = sseRes.body.getReader();
            const { value } = await reader.read();
            const text = new TextDecoder().decode(value);
            assert(text.includes("event: connected"), "Test 20.4: Nhận được event 'connected' ban đầu qua SSE stream");
            reader.cancel();
        }

        // Test 21: Internal Webhook (/internal/messages/incoming) không bị ảnh hưởng bởi User Auth
        {
            // Không có internal key -> 401
            const badRes = await fetch(`${chatBaseUrl}/internal/messages/incoming`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
            assert(badRes.status === 401, "Test 21.1: Webhook internal không có API Key bị chặn 401");

            // Có internal key -> vượt qua xác thực internal (báo 400 vì thiếu body hợp lệ, chứng tỏ auth pass)
            const goodRes = await fetch(`${chatBaseUrl}/internal/messages/incoming`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-api-key": process.env.INTERNAL_API_KEY
                },
                body: JSON.stringify({ telegram_chat_id: "123" })
            });
            // 400 hoặc 200, nhưng KHÔNG PHẢI 401/403
            assert(goodRes.status !== 401 && goodRes.status !== 403, "Test 21.2: Webhook internal có API Key xác thực độc lập, không bị chặn bởi JWT middleware");
        }

        console.log("\n=======================================================");
        console.log(`  KẾT QUẢ: TẤT CẢ ${passedCount}/${totalCount} TEST ĐÃ VƯỢT QUA XUẤT SẮC!`);
        console.log("=======================================================\n");

    } finally {
        if (authServer) authServer.close();
        if (chatServer) chatServer.close();
        await pool.end();
    }
}

runTests().catch(err => {
    console.error("Test failed with error:", err);
    process.exit(1);
});
