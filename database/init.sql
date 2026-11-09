-- MULTI-CHANNEL CHAT SERVICE DATABASE
-- PostgreSQL - Fresh database schema

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0. DROP TABLES NẾU CHẠY LẠI TỪ ĐẦU
DROP TABLE IF EXISTS telegram_delivery_attempts CASCADE;
DROP TABLE IF EXISTS outbox_events CASCADE;
DROP TABLE IF EXISTS refresh_sessions CASCADE;
DROP TABLE IF EXISTS message_attachments CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS channel_accounts CASCADE;
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- 1. ROLES
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE, -- Mã vai trò: ADMIN, SUPPORT
    name VARCHAR(100) NOT NULL, -- Tên hiển thị vai trò
    description TEXT, -- Mô tả vai trò
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_roles_code
        CHECK (code IN ('ADMIN', 'SUPPORT'))
);

-- 2. USERS
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    role_id UUID NOT NULL REFERENCES roles(id), -- Vai trò, tham chiếu roles

    username VARCHAR(100) NOT NULL UNIQUE, -- Tên đăng nhập
    email VARCHAR(200) NOT NULL UNIQUE, -- Email đăng nhập
    password_hash VARCHAR(255) NOT NULL, -- Mật khẩu băm bcrypt
    full_name VARCHAR(255), -- Họ tên nhân viên

    status VARCHAR(20) NOT NULL DEFAULT 'active', -- Trạng thái: active, inactive, banned

    last_login_at TIMESTAMPTZ, -- Lần đăng nhập cuối
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_users_status
        CHECK (status IN ('active', 'inactive', 'banned'))
);

CREATE UNIQUE INDEX uq_users_email_lower
ON users (LOWER(email));

CREATE UNIQUE INDEX uq_users_username_lower
ON users (LOWER(username));

-- 3. REFRESH SESSIONS (Phục vụ Auth Service & Refresh Token Rotation)
CREATE TABLE refresh_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    family_id UUID NOT NULL, -- Nhóm các token phát sinh từ cùng một phiên đăng nhập

    token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hash của refresh token

    expires_at TIMESTAMPTZ NOT NULL, -- Thời điểm hết hạn

    revoked_at TIMESTAMPTZ, -- Thời điểm token bị thu hồi/sử dụng

    replaced_by_id UUID, -- ID phiên mới thay thế phiên cũ

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- 4. CHANNELS
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(30) NOT NULL UNIQUE, -- Mã nền tảng: TELEGRAM, WHATSAPP, MESSENGER
    name VARCHAR(100) NOT NULL, -- Tên hiển thị
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- Trạng thái hoạt động

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. CHANNEL ACCOUNTS
CREATE TABLE channel_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    channel_id UUID NOT NULL REFERENCES channels(id), -- Nền tảng bot, tham chiếu channels
    external_account_id VARCHAR(255) NOT NULL, -- ID của bot từ nền tảng

    display_name VARCHAR(255), -- Tên hiển thị bot
    external_username VARCHAR(255), -- Username bot trên nền tảng
    credential_ref VARCHAR(255), -- Thông tin xác thực

    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- Trạng thái hoạt động

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_channel_account
        UNIQUE (channel_id, external_account_id)
);

-- 6. CONVERSATIONS
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    channel_account_id UUID NOT NULL
        REFERENCES channel_accounts(id), -- Bot nhận cuộc trò chuyện

    external_chat_id VARCHAR(255) NOT NULL, -- Chat ID từ nền tảng

    display_name VARCHAR(255), -- Tên hiển thị chat
    username VARCHAR(255), -- Username của khách hàng
    chat_type VARCHAR(30), -- private, group

    status VARCHAR(20) NOT NULL DEFAULT 'open', -- open, closed, archived

    assigned_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL, -- Nhân viên support đang được phân công

    last_message_at TIMESTAMPTZ, -- Thời điểm tin nhắn gần nhất

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_conversation_chat
        UNIQUE (channel_account_id, external_chat_id),

    CONSTRAINT chk_conversation_status
        CHECK (status IN ('open', 'closed', 'archived'))
);

-- 7. MESSAGES
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL
        REFERENCES conversations(id), -- Cuộc trò chuyện của tin nhắn

    external_message_id VARCHAR(255), -- Message ID từ nền tảng
    external_sender_id VARCHAR(255), -- ID người gửi trên nền tảng

    sent_by_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL, -- Nhân viên support đã gửi tin outgoing

    direction VARCHAR(10) NOT NULL, -- incoming, outgoing
    message_type VARCHAR(30) NOT NULL DEFAULT 'text', -- text, image, video, document, ...

    content TEXT, -- Nội dung tin nhắn
    payload JSONB, -- Dữ liệu json bổ sung

    status VARCHAR(20) NOT NULL, -- pending, sent, delivered, read, failed, received
    error_message TEXT, -- Thông tin lỗi nếu gửi thất bại

    client_request_id UUID, -- ID chống gửi lặp từ client

    sent_at TIMESTAMPTZ, -- Thời điểm gửi
    delivered_at TIMESTAMPTZ, -- Thời điểm đã giao
    read_at TIMESTAMPTZ, -- Thời điểm đã đọc

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_message_direction
        CHECK (direction IN ('incoming', 'outgoing')),

    CONSTRAINT chk_message_type
        CHECK (
            message_type IN (
                'text', 'image', 'video',
                'audio', 'document', 'other'
            )
        ),

    CONSTRAINT chk_message_status
        CHECK (
            status IN (
                'pending', 'sent', 'delivered',
                'read', 'failed', 'received'
            )
        )
);

CREATE UNIQUE INDEX uq_external_message
ON messages(conversation_id, external_message_id)
WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX uq_client_request
ON messages(client_request_id)
WHERE client_request_id IS NOT NULL;

-- 8. WEBHOOK EVENTS
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    channel_account_id UUID NOT NULL
        REFERENCES channel_accounts(id),

    external_event_id VARCHAR(255) NOT NULL, -- ID event từ nền tảng
    event_type VARCHAR(100) NOT NULL, -- Loại event
    payload JSONB NOT NULL, -- Dữ liệu event

    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    CONSTRAINT uq_webhook_event
        UNIQUE (channel_account_id, external_event_id),

    CONSTRAINT chk_webhook_status
        CHECK (
            status IN (
                'pending', 'processing',
                'processed', 'failed'
            )
        ),

    CONSTRAINT chk_retry_count
        CHECK (retry_count >= 0)
);

-- 9. MESSAGE ATTACHMENTS
CREATE TABLE message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    message_id UUID NOT NULL
        REFERENCES messages(id)
        ON DELETE CASCADE,

    external_file_id VARCHAR(500),
    file_name VARCHAR(255),
    mime_type VARCHAR(150),
    file_size BIGINT,

    storage_key TEXT,
    checksum_sha256 VARCHAR(64),
    url TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_file_size
        CHECK (file_size IS NULL OR file_size >= 0)
);

--9.Tạo bảng Outbox Event

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY,

    aggregate_id UUID NOT NULL
        REFERENCES messages(id),

    topic VARCHAR(150) NOT NULL,

    event_key VARCHAR(150) NOT NULL,

    payload JSONB NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    attempts INT NOT NULL DEFAULT 0,

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    locked_until TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    published_at TIMESTAMPTZ,

    last_error TEXT,

    lock_token UUID,

    CONSTRAINT ck_outbox_status
        CHECK (status IN (
            'pending',
            'processing',
            'published'
        ))
);

CREATE INDEX IF NOT EXISTS idx_outbox_ready
ON outbox_events (next_attempt_at, created_at, id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_processing
ON outbox_events (locked_until)
WHERE status = 'processing';

-- 10. TELEGRAM DELIVERY ATTEMPTS
CREATE TABLE IF NOT EXISTS telegram_delivery_attempts (
    message_id UUID PRIMARY KEY
        REFERENCES messages(id),

    status VARCHAR(20) NOT NULL DEFAULT 'processing',

    external_message_id VARCHAR(100),

    telegram_sent_at TIMESTAMPTZ,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    last_checked_at TIMESTAMPTZ,

    last_error TEXT,

    last_error_code VARCHAR(100),

    attempt_generation INT NOT NULL DEFAULT 1,

    queued_retry_generation INT,

    retry_count INT NOT NULL DEFAULT 0,

    next_retry_at TIMESTAMPTZ,

    CONSTRAINT ck_delivery_retry_count
        CHECK (retry_count >= 0),

    CONSTRAINT ck_telegram_delivery_status
        CHECK (
            status IN (
                'processing',
                'retry_waiting',
                'sent',
                'failed',
                'unknown'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_delivery_retry
ON telegram_delivery_attempts (next_retry_at)
WHERE status = 'retry_waiting';

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_retry
ON outbox_events (
    aggregate_id,
    topic,
    (payload->>'attemptGeneration')
)
WHERE topic = 'telegram.message.send'
  AND payload ? 'attemptGeneration';


-- INDEXES
CREATE INDEX idx_users_role
ON users(role_id);

CREATE INDEX idx_refresh_sessions_user
ON refresh_sessions(user_id);

CREATE INDEX idx_refresh_sessions_family
ON refresh_sessions(family_id);

CREATE INDEX idx_refresh_sessions_expires
ON refresh_sessions(expires_at);

CREATE INDEX idx_channel_accounts_channel
ON channel_accounts(channel_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_accounts_external
ON channel_accounts (channel_id, external_account_id);

CREATE INDEX idx_conversations_account
ON conversations(channel_account_id);

CREATE INDEX idx_conversations_assigned
ON conversations(assigned_user_id);

CREATE INDEX idx_conversations_last_message
ON conversations(last_message_at DESC NULLS LAST);

CREATE INDEX idx_messages_conversation_time
ON messages(conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_messages_sender
ON messages(sent_by_user_id);

CREATE INDEX idx_webhook_pending
ON webhook_events(received_at)
WHERE status IN ('pending', 'failed');

CREATE INDEX idx_attachments_message
ON message_attachments(message_id);

CREATE INDEX idx_outbox_pending
ON outbox_events (created_at, id)
WHERE status = 'pending';

-- TRIGGERS

-- TRIGGER: AUTO UPDATE updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_channel_accounts_updated_at
BEFORE UPDATE ON channel_accounts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_messages_updated_at
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- TRIGGER: UPDATE LAST MESSAGE TIME
CREATE OR REPLACE FUNCTION update_last_message_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET last_message_at = GREATEST(
        COALESCE(last_message_at, '-infinity'::timestamptz),
        COALESCE(NEW.sent_at, NEW.created_at)
    )
    WHERE id = NEW.conversation_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_last_message_at
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_last_message_at();

-- INITIAL SEED DATA

-- ROLES
INSERT INTO roles (code, name, description)
VALUES
    ('ADMIN', 'Administrator', 'Full system access'),
    ('SUPPORT', 'Support Staff', 'Customer support employee')
ON CONFLICT (code) DO NOTHING;

-- CHANNELS
INSERT INTO channels (code, name)
VALUES
    ('TELEGRAM', 'Telegram'),
    ('WHATSAPP', 'WhatsApp'),
    ('MESSENGER', 'Facebook Messenger')
ON CONFLICT (code) DO NOTHING;

COMMIT;
