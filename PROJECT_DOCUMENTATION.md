# TÀI LIỆU TOÀN DIỆN DỰ ÁN HỆ THỐNG MULTI-CHANNEL CHAT MICROSERVICES
*(Kafka Event-Driven Architecture, Transactional Outbox, Multi-Bot Telegram & SSE Real-time Dashboard)*

---

## MỤC LỤC
1. [Tổng Quan Hệ Thống & Kiến Trúc Tổng Thể](#1-tổng-quan-hệ-thống--kiến-trúc-tổng-thể)
2. [Cơ Sở Dữ Liệu PostgreSQL & Data Model Chi Tiết](#2-cơ-sở-dữ-liệu-postgresql--data-model-chi-tiết)
3. [Phân Tích Chi Tiết Từng Service: File, Hàm & Nhiệm Vụ](#3-phân-tích-chi-tiết-từng-service-file-hàm--nhiệm-vụ)
   - [3.1. Auth Service (Port 3001)](#31-auth-service-port-3001)
   - [3.2. Chat Service (Port 3002)](#32-chat-service-port-3002)
   - [3.3. Telegram Service (Port 3003)](#33-telegram-service-port-3003)
   - [3.4. Frontend React Dashboard (Vite - Port 5173)](#34-frontend-react-dashboard-vite---port-5173)
4. [Các Luồng Nghiệp Vụ Hoạt Động Cốt Lõi (End-to-End Flows)](#4-các-luồng-nghiệp-vụ-hoạt-động-cốt-lõi-end-to-end-flows)
   - [Luồng 1: Xác Thực, Cấp Phát & Refresh Token Rotation (Chống Tấn Công Tái Sử Dụng Token)](#luồng-1-xác-thực-cấp-phát--refresh-token-rotation-chống-tấn-công-tái-sử-dụng-token)
   - [Luồng 2: Gửi Tin Nhắn Text Outgoing (Transactional Outbox + Kafka + Claim Gen + SSE)](#luồng-2-gửi-tin-nhắn-text-outgoing-transactional-outbox--kafka--claim-gen--sse)
   - [Luồng 3: Gửi Ảnh & Tài Liệu Outgoing (Reference Pattern + Binary Stream + Dọn Dẹp Orphan)](#luồng-3-gửi-ảnh--tài-liệu-outgoing-reference-pattern--binary-stream--dọn-dẹp-orphan)
   - [Luồng 4: State Machine Xử Lý Lỗi, Retry Delay (HTTP 429) & Claim Thế Hệ (Attempt Generation)](#luồng-4-state-machine-xử-lý-lỗi-retry-delay-http-429--claim-thế-hệ-attempt-generation)
   - [Luồng 5: Tiếp Nhận Tin Nhắn Đến (Telegram Webhook $\rightarrow$ Kafka Incoming $\rightarrow$ Deduplication $\rightarrow$ SSE)](#luồng-5-tiếp-nhận-tin-nhắn-đến-telegram-webhook--kafka-incoming--deduplication--sse)
5. [Cẩm Nang Vận Hành, Chạy Service & Kiểm Thử Toàn Diện](#5-cẩm-nang-vận-hành-chạy-service--kiểm-thử-toàn-diện)

---

## 1. TỔNG QUAN HỆ THỐNG & KIẾN TRÚC TỔNG THỂ

### 1.1. Mục Tiêu Dự Án
Dự án được xây dựng nhằm giải quyết bài toán chăm sóc khách hàng đa kênh (trọng tâm là Telegram, hỗ trợ mở rộng Zalo/Facebook Messenger), cho phép nhân viên trực tổng đài (Support / Admin) nhắn tin hai chiều (Text, Ảnh, File PDF/Docs) theo thời gian thực (Real-time).

Hệ thống được thiết kế theo kiến trúc **Microservices hướng sự kiện (Event-Driven Architecture)** với **Apache Kafka** làm xương sống truyền thông tin bất đồng bộ, kết hợp với mẫu thiết kế **Transactional Outbox Pattern** để đảm bảo tính nhất quán dữ liệu (Data Consistency), chống mất tin nhắn khi crash, và hỗ trợ **Attempt Generation Claiming** để ngăn chặn gửi trùng tin nhắn hoặc race condition khi retry.

### 1.2. Sơ Đồ Kiến Trúc Tổng Thể

```mermaid
flowchart TB
    subgraph ClientLayer ["Client & Frontend Layer"]
        UI["React Dashboard (Vite)\n(Port 5173)"]
    end

    subgraph GatewayAuth ["Authentication & Security"]
        AuthSvc["Auth Service\n(Port 3001)\nJWT + Refresh Rotation"]
    end

    subgraph ChatDomain ["Chat Service Domain (Port 3002)"]
        ChatAPI["Chat REST API\n(/api/conversations)"]
        ChatInternal["Internal API\n(/internal)"]
        SSEHub["SSE Event Stream\n(/api/events)"]
        OutboxWorker["Outbox Worker\n(Poll outbox_events)"]
        ResultConsumer["Result Consumer\n(topic: telegram.message.result)"]
        IncomingConsumer["Incoming Consumer\n(topic: telegram.message.incoming)"]
        RetryScheduler["Retry Worker / Scheduler\n(next_retry_at scanner)"]
        ReconWorker["Reconciliation Worker\n(Processing timeout sweeper)"]
        Storage["Local Disk Storage\n(storage/attachments/)"]
    end

    subgraph KafkaBroker ["Apache Kafka Broker (Port 9092)"]
        T_Send["topic: telegram.message.send"]
        T_Result["topic: telegram.message.result"]
        T_Incoming["topic: telegram.message.incoming"]
        T_DLT["topic: telegram.message.dlt"]
    end

    subgraph TelegramDomain ["Telegram Integration Service (Port 3003)"]
        TGWebhook["Webhook Controller\n(/webhook/:botId)"]
        TGSendConsumer["Send Consumer\n(telegram-send-workers)"]
        TGDispatcher["Send Dispatcher\n(Text / Photo / Document)"]
        BotMgr["Bot Manager\n(Multi-Bot Telegraf)"]
    end

    subgraph ExternalPlatforms ["External World"]
        TelegramAPI["Telegram Bot API\n(api.telegram.org)"]
        CustomerUser["Khách Hàng Cuối\n(Telegram App)"]
    end

    subgraph DatabaseLayer ["PostgreSQL 16"]
        PG[(PostgreSQL Database)]
    end

    %% Giao tiếp Auth
    UI -->|1. Đăng nhập / Refresh Cookie| AuthSvc
    AuthSvc <--> PG

    %% Giao tiếp Chat UI
    UI -->|2. Gửi Text / Upload File (Cookie)| ChatAPI
    UI <-->|3. Nhận trạng thái Real-time (SSE)| SSEHub
    ChatAPI <--> PG
    ChatAPI --> Storage

    %% Outbox & Publish
    OutboxWorker <-->|Quét outbox_events| PG
    OutboxWorker -->|Publish Send Command| T_Send

    %% Telegram Outbound
    T_Send --> TGSendConsumer
    TGSendConsumer -->|Claim Attempt Gen| ChatInternal
    TGSendConsumer -->|Tải file nhị phân nếu là ảnh/file| ChatInternal
    ChatInternal --> Storage
    TGSendConsumer --> TGDispatcher
    TGDispatcher --> BotMgr
    BotMgr -->|Gọi Telegram API| TelegramAPI
    TelegramAPI --> CustomerUser

    %% Telegram Kết quả gửi
    TGSendConsumer -->|Ghi nhận Delivery Result| ChatInternal
    ChatInternal --> PG
    ChatInternal -->|Tạo Result Outbox| PG
    OutboxWorker -->|Publish Result Event| T_Result
    T_Result --> ResultConsumer
    ResultConsumer -->|Apply Delivery Result| PG
    ResultConsumer -->|Broadcast Message Updated| SSEHub

    %% Retry & DLT
    RetryScheduler <-->|Quét retry_waiting đến hạn| PG
    RetryScheduler -->|Tạo Outbox thế hệ mới| PG
    TGSendConsumer -.->|Permanent Error| T_DLT

    %% Inbound Webhook
    CustomerUser -->|Gửi tin nhắn Telegram| TelegramAPI
    TelegramAPI -->|Webhook Update| TGWebhook
    TGWebhook -->|Publish Inbound Event| T_Incoming
    T_Incoming --> IncomingConsumer
    IncomingConsumer -->|POST /internal/messages/incoming| ChatInternal
    ChatInternal --> PG
    ChatInternal -->|Broadcast new_message| SSEHub
```

---

## 2. CƠ SỞ DỮ LIỆU POSTGRESQL & DATA MODEL CHI TIẾT

Cơ sở dữ liệu được định nghĩa chuẩn tại file [`database/init.sql`](file:///d:/micro_noti_service/database/init.sql), bao gồm **11 bảng nghiệp vụ** có quan hệ chặt chẽ, tối ưu hóa cho mô hình Event-Driven Microservices:

```mermaid
erDiagram
    ROLES ||--o{ USERS : "has role"
    USERS ||--o{ REFRESH_SESSIONS : "owns"
    CHANNELS ||--o{ CHANNEL_ACCOUNTS : "supports"
    CHANNEL_ACCOUNTS ||--o{ CONVERSATIONS : "belongs to"
    CHANNEL_ACCOUNTS ||--o{ WEBHOOK_EVENTS : "logs"
    CONVERSATIONS ||--o{ MESSAGES : "contains"
    USERS ||--o{ MESSAGES : "sent by"
    MESSAGES ||--o{ MESSAGE_ATTACHMENTS : "has files"
    MESSAGES ||--o| TELEGRAM_DELIVERY_ATTEMPTS : "tracks attempt"
    MESSAGES ||--o{ OUTBOX_EVENTS : "triggers"

    ROLES {
        uuid id PK
        varchar code UK "ADMIN / SUPPORT"
        varchar name
        text description
        timestamptz created_at
    }

    USERS {
        uuid id PK
        uuid role_id FK
        varchar username UK
        varchar email UK
        varchar password_hash
        varchar full_name
        varchar status "active / inactive / suspended"
        timestamptz last_login_at
        timestamptz created_at
        timestamptz updated_at
    }

    REFRESH_SESSIONS {
        uuid id PK
        uuid user_id FK
        uuid family_id "Nhóm session xoay vòng"
        varchar token_hash UK "SHA-256 hash"
        timestamptz expires_at
        timestamptz revoked_at "Phát hiện Replay Attack"
        uuid replaced_by_session_id FK
        text user_agent
        inet ip_address
        timestamptz created_at
    }

    CHANNELS {
        uuid id PK
        varchar code UK "TELEGRAM / ZALO / FB"
        varchar name
        boolean is_active
        timestamptz created_at
    }

    CHANNEL_ACCOUNTS {
        uuid id PK
        uuid channel_id FK
        varchar external_account_id "Bot Token ID / Phone"
        varchar name
        jsonb credentials "Encrypted Bot Token"
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    CONVERSATIONS {
        uuid id PK
        uuid channel_account_id FK
        varchar external_chat_id "Telegram chat_id"
        varchar customer_id
        varchar display_name
        varchar status "open / pending / closed"
        timestamptz last_message_at
        timestamptz created_at
        timestamptz updated_at
    }

    MESSAGES {
        uuid id PK
        uuid conversation_id FK
        uuid sent_by_user_id FK "NULL nếu incoming"
        varchar client_request_id UK "Chống gửi trùng UI"
        varchar direction "incoming / outgoing"
        varchar message_type "text / image / document"
        text content
        varchar status "pending / sent / failed"
        varchar external_message_id "Telegram message_id"
        text error_message
        timestamptz sent_at
        timestamptz created_at
        timestamptz updated_at
    }

    MESSAGE_ATTACHMENTS {
        uuid id PK
        uuid message_id FK
        varchar file_name
        varchar mime_type
        bigint file_size
        text storage_key "storage/attachments/..."
        varchar checksum_sha256
        varchar external_file_id "Telegram file_id"
        timestamptz created_at
    }

    OUTBOX_EVENTS {
        uuid id PK
        uuid aggregate_id "message_id"
        varchar topic "telegram.message.send/result"
        varchar event_key "Partition key: conversation_id"
        jsonb payload "Dữ liệu JSON gửi Kafka"
        varchar status "pending / published / failed"
        int retry_count
        timestamptz published_at
        timestamptz created_at
    }

    TELEGRAM_DELIVERY_ATTEMPTS {
        uuid message_id PK,FK
        varchar status "processing/sent/failed/retry_waiting/unknown"
        varchar external_message_id
        timestamptz telegram_sent_at
        timestamptz started_at
        timestamptz completed_at
        int attempt_generation "Thế hệ lần gửi hiện tại"
        int queued_retry_generation "Thế hệ đã lên lịch Outbox"
        int retry_count "Số lần đã retry (tối đa 3)"
        timestamptz next_retry_at "Mốc thời gian hết hạn Rate Limit"
        text last_error
        varchar last_error_code "RATE_LIMIT / BOT_BLOCKED"
    }

    WEBHOOK_EVENTS {
        uuid id PK
        uuid channel_account_id FK
        varchar external_event_id "update_id từ Telegram"
        varchar event_type "message"
        jsonb payload "Raw webhook update JSON"
        varchar status "pending / processed / failed"
        int retry_count
        timestamptz received_at
        timestamptz processed_at
    }
```

### Các Bảng Dữ Liệu Chi Tiết:

#### Bảng 1: `roles` (Bảng Phân Quyền Vai Trò)
- `id` (`UUID`, PK): Định danh duy nhất của vai trò (`gen_random_uuid()`).
- `code` (`VARCHAR(50)`, UNIQUE, NOT NULL): Mã vai trò hệ thống (`ADMIN`, `SUPPORT`).
- `name` (`VARCHAR(100)`, NOT NULL): Tên hiển thị (Quản trị viên, Nhân viên CSKH).
- `description` (`TEXT`): Mô tả phạm vi quyền hạn.
- `created_at` (`TIMESTAMPTZ`, NOT NULL, Default `NOW()`): Thời điểm tạo.

#### Bảng 2: `users` (Bảng Người Dùng Nội Bộ)
- `id` (`UUID`, PK): Định danh người dùng.
- `role_id` (`UUID`, FK `roles.id`, NOT NULL): Vai trò được phân bổ.
- `username` (`VARCHAR(50)`, UNIQUE, NOT NULL): Tên đăng nhập.
- `email` (`VARCHAR(255)`, UNIQUE, NOT NULL): Email liên hệ.
- `password_hash` (`VARCHAR(255)`, NOT NULL): Mật khẩu băm an toàn qua `bcryptjs` (salt rounds 10).
- `full_name` (`VARCHAR(100)`, NOT NULL): Họ và tên nhân viên.
- `status` (`VARCHAR(20)`, NOT NULL, Default `'active'`): Trạng thái tài khoản (`active`, `inactive`, `suspended`).
- `last_login_at` (`TIMESTAMPTZ`): Thời điểm đăng nhập thành công gần nhất.
- `created_at` & `updated_at` (`TIMESTAMPTZ`, NOT NULL): Được tự động cập nhật bởi Trigger.

#### Bảng 3: `refresh_sessions` (Bảng Phiên Refresh Token Rotation)
- `id` (`UUID`, PK): Khóa chính phiên đăng nhập.
- `user_id` (`UUID`, FK `users.id`, NOT NULL): Nhân viên sở hữu phiên.
- `family_id` (`UUID`, NOT NULL): Mã nhóm phiên (Session Family) gắn liền từ lúc đăng nhập. Dùng để hủy toàn bộ chuỗi token khi phát hiện tấn công tái sử dụng (Token Reuse / Replay Attack).
- `token_hash` (`VARCHAR(64)`, UNIQUE, NOT NULL): Mã băm `SHA-256` của refresh token thô (không lưu plain text token vào DB).
- `expires_at` (`TIMESTAMPTZ`, NOT NULL): Thời điểm hết hạn (7 ngày sau khi cấp).
- `revoked_at` (`TIMESTAMPTZ`): Thời điểm bị thu hồi. Nếu một request refresh mang token có `revoked_at != NULL`, hệ thống lập tức kích hoạt cơ chế tự vệ thu hồi toàn bộ `family_id`.
- `replaced_by_session_id` (`UUID`, FK `refresh_sessions.id`): Liên kết đến session mới thay thế khi xoay vòng token.
- `user_agent` (`TEXT`) & `ip_address` (`INET`): Lưu thông tin thiết bị và IP để kiểm tra an toàn.

#### Bảng 4: `channels` (Bảng Kênh Giao Tiếp Hỗ Trợ)
- `id` (`UUID`, PK): Khóa chính.
- `code` (`VARCHAR(50)`, UNIQUE, NOT NULL): Mã kênh (`TELEGRAM`, `ZALO`, `FACEBOOK`).
- `name` (`VARCHAR(100)`, NOT NULL): Tên hiển thị của kênh.
- `is_active` (`BOOLEAN`, NOT NULL, Default `TRUE`): Trạng thái bật/tắt toàn kênh.

#### Bảng 5: `channel_accounts` (Bảng Tài Khoản Kênh / Bot Instance)
- `id` (`UUID`, PK): Khóa chính của bot account.
- `channel_id` (`UUID`, FK `channels.id`, NOT NULL): Thuộc loại kênh nào.
- `external_account_id` (`VARCHAR(255)`, NOT NULL): Định danh bot (ID Bot Telegram do BotFather cấp).
- `name` (`VARCHAR(100)`, NOT NULL): Tên định danh của Bot (ví dụ: "CSKH Bot 1").
- `credentials` (`JSONB`, NOT NULL): Thông tin bí mật (chứa `botToken`, `webhookSecret`).
- `is_active` (`BOOLEAN`, NOT NULL, Default `TRUE`): Trạng thái kích hoạt bot.
- **Ràng buộc**: `UNIQUE (channel_id, external_account_id)`.

#### Bảng 6: `conversations` (Bảng Hội Thoại Luồng Chat)
- `id` (`UUID`, PK): Khóa chính cuộc hội thoại.
- `channel_account_id` (`UUID`, FK `channel_accounts.id`, NOT NULL): Bot tiếp nhận cuộc chat.
- `external_chat_id` (`VARCHAR(255)`, NOT NULL): ID phòng chat trên Telegram (`chat_id` của khách hàng).
- `customer_id` (`VARCHAR(255)`): Định danh khách hàng (nếu có liên kết CRM).
- `display_name` (`VARCHAR(255)`): Tên hiển thị của khách hàng Telegram (`First Name + Last Name` hoặc `username`).
- `status` (`VARCHAR(20)`, NOT NULL, Default `'open'`): Trạng thái (`open`, `pending`, `closed`).
- `last_message_at` (`TIMESTAMPTZ`): Tự động cập nhật bởi DB Trigger mỗi khi có tin nhắn mới.
- **Ràng buộc**: `UNIQUE (channel_account_id, external_chat_id)`. Đảm bảo mỗi khách hàng chat với 1 bot chỉ tạo ra đúng 1 Conversation duy nhất.

#### Bảng 7: `messages` (Bảng Tin Nhắn Hai Chiều)
- `id` (`UUID`, PK): Khóa chính tin nhắn.
- `conversation_id` (`UUID`, FK `conversations.id`, NOT NULL): Thuộc hội thoại nào.
- `sent_by_user_id` (`UUID`, FK `users.id`): Nhân viên gửi tin (NULL nếu khách gửi đến).
- `client_request_id` (`VARCHAR(100)`, UNIQUE): UUID do Frontend React sinh ra trước khi gửi. **Ngăn chặn tuyệt đối việc click đúp hoặc mạng lag gửi lại 2 lần tin nhắn giống nhau**.
- `direction` (`VARCHAR(20)`, NOT NULL): Chiều tin nhắn (`incoming`: Khách gửi đến, `outgoing`: Nhân viên gửi đi).
- `message_type` (`VARCHAR(20)`, NOT NULL): Loại nội dung (`text`, `image`, `document`).
- `content` (`TEXT`): Nội dung tin nhắn văn bản hoặc Caption của ảnh/file đính kèm.
- `status` (`VARCHAR(20)`, NOT NULL, Default `'pending'`): Trạng thái (`pending`, `sent`, `failed`).
- `external_message_id` (`VARCHAR(255)`): `message_id` trên máy chủ Telegram sau khi gửi thành công.
- `error_message` (`TEXT`): Lý do thất bại (nếu có).
- `sent_at` (`TIMESTAMPTZ`): Thời điểm tin nhắn được Telegram ghi nhận gửi.

#### Bảng 8: `message_attachments` (Bảng Quản Lý Tệp Đính Kèm)
- `id` (`UUID`, PK): Khóa chính tệp đính kèm.
- `message_id` (`UUID`, FK `messages.id`, NOT NULL): Thuộc tin nhắn nào.
- `file_name` (`VARCHAR(255)`, NOT NULL): Tên file gốc (ví dụ: `bang_bao_gia.pdf`).
- `mime_type` (`VARCHAR(100)`, NOT NULL): Kiểu định dạng MIME (`image/png`, `application/pdf`...).
- `file_size` (`BIGINT`, NOT NULL): Dung lượng file tính bằng bytes.
- `storage_key` (`TEXT`, NOT NULL): Đường dẫn tương đối lưu trữ file trên ổ cứng (`YYYY/MM/uuid.ext`).
- `checksum_sha256` (`VARCHAR(64)`): Mã băm SHA-256 kiểm tra toàn vẹn tệp.
- `external_file_id` (`VARCHAR(255)`): ID tệp trên máy chủ Telegram (`file_id`).

#### Bảng 9: `outbox_events` (Bảng Transactional Outbox)
- `id` (`UUID`, PK): Khóa chính sự kiện Outbox.
- `aggregate_id` (`UUID`, NOT NULL): ID đối tượng nghiệp vụ (thường là `message_id`).
- `topic` (`VARCHAR(100)`, NOT NULL): Tên Kafka topic tiếp nhận (`telegram.message.send`, `telegram.message.result`).
- `event_key` (`VARCHAR(255)`, NOT NULL): Khóa phân vùng Kafka (Partition Key, dùng `conversation_id` hoặc `message_id` để đảm bảo thứ tự gửi).
- `payload` (`JSONB`, NOT NULL): Toàn bộ dữ liệu sự kiện dạng JSON.
- `status` (`VARCHAR(20)`, NOT NULL, Default `'pending'`): Trạng thái (`pending`, `published`, `failed`).
- `retry_count` (`INT`, NOT NULL, Default `0`): Số lần Outbox Worker đã thử đẩy sang Kafka.
- `published_at` (`TIMESTAMPTZ`): Thời điểm Kafka broker đã ACK thành công.
- **Ràng buộc**: `UNIQUE (aggregate_id, topic, (payload->>'attemptGeneration'))` đảm bảo mỗi thế hệ gửi/retry chỉ sinh đúng duy nhất 1 sự kiện Outbox.

#### Bảng 10: `telegram_delivery_attempts` (Bảng Quản Lý Vòng Đời Lượt Gửi Telegram)
- `message_id` (`UUID`, PK, FK `messages.id`): Liên kết 1-1 với tin nhắn outgoing.
- `status` (`VARCHAR(20)`, NOT NULL): Trạng thái gửi (`processing`, `retry_waiting`, `sent`, `failed`, `unknown`).
- `attempt_generation` (`INT`, NOT NULL, Default `1`): **Thế hệ của lần gửi hiện tại**. Tăng dần mỗi khi kích hoạt retry (1, 2, 3...) để loại bỏ kết quả trễ (stale results).
- `queued_retry_generation` (`INT`): **Thế hệ đã được đưa vào hàng đợi Outbox**. Tránh việc scheduler quét lặp tạo ra nhiều Outbox event trùng lặp trong khi worker chưa kịp claim.
- `retry_count` (`INT`, NOT NULL, Default `0`): Số lần tin nhắn đã được thử lại (giới hạn tối đa 3 lần).
- `next_retry_at` (`TIMESTAMPTZ`): Mốc thời gian hết hạn Rate Limit delay (`NOW() + retryAfterSeconds`). Sau mốc này Retry Scheduler mới được phép quét.
- `last_error` (`TEXT`) & `last_error_code` (`VARCHAR(100)`): Chi tiết lỗi từ Telegram API (`RATE_LIMIT`, `BOT_BLOCKED`, `CHAT_NOT_FOUND`).

#### Bảng 11: `webhook_events` (Bảng Nhật Ký Webhook Telegram Tiếp Nhận)
- `id` (`UUID`, PK): Khóa chính nhật ký webhook.
- `channel_account_id` (`UUID`, FK `channel_accounts.id`, NOT NULL): Tiếp nhận từ Bot nào.
- `external_event_id` (`VARCHAR(255)`, NOT NULL): ID sự kiện từ Telegram (`update_id`).
- `event_type` (`VARCHAR(100)`, NOT NULL, Default `'message'`): Loại sự kiện webhook.
- `payload` (`JSONB`, NOT NULL): Toàn bộ payload JSON thô Telegram gửi sang.
- `status` (`VARCHAR(20)`, NOT NULL, Default `'pending'`): Trạng thái (`pending`, `processing`, `processed`, `failed`).
- `received_at` (`TIMESTAMPTZ`, NOT NULL, Default `NOW()`): Thời điểm nhận webhook.
- `processed_at` (`TIMESTAMPTZ`): Thời điểm hoàn tất lưu tin nhắn.
- **Ràng buộc**: `UNIQUE (channel_account_id, external_event_id)`: Chặn tuyệt đối việc Telegram gửi lại cùng một `update_id` gây duplicate tin nhắn.

---

## 3. PHÂN TÍCH CHI TIẾT TỪNG SERVICE: FILE, HÀM & NHIỆM VỤ

---

### 3.1. Auth Service (Port 3001)

Dịch vụ chuyên trách quản lý người dùng, phân quyền RBAC và quản lý phiên làm việc thông qua chuẩn **HttpOnly Cookie** chống tấn công XSS, kết hợp cơ chế **Refresh Token Rotation** chống Replay Attack.

```
service/auth_service/
├── src/
│   ├── app.js                          # Cấu hình Express, Cookie Parser, CORS, gắn Route
│   ├── server.js                       # Khởi chạy HTTP Server lắng nghe cổng 3001
│   ├── config/database.js              # PostgreSQL Pool kết nối DB micro_chat_db
│   ├── controllers/auth.controller.js  # Tiếp nhận HTTP request /auth/login, /refresh, /logout, /me
│   ├── middlewares/trusted-origin.middleware.js # Chặn request giả mạo nguồn gốc qua Origin whitelist
│   ├── repositories/
│   │   ├── session.repository.js       # Thao tác bảng refresh_sessions (tạo session, khóa FOR UPDATE, revoke family)
│   │   └── user.repository.js          # Tìm user theo login/id, cập nhật last_login_at
│   ├── routes/auth.routes.js           # Định tuyến các endpoint /auth/*
│   └── services/
│       ├── auth.service.js             # Nghiệp vụ xác thực mật khẩu bcrypt, phát hiện Replay Attack
│       └── token.service.js            # Ký Access Token JWT (15m) & sinh ngẫu nhiên Refresh Token (64 bytes)
```

#### Chi Tiết Từng File & Hàm Của Auth Service:

#### File: [`controllers/auth.controller.js`](file:///d:/micro_noti_service/service/auth_service/src/controllers/auth.controller.js)
1. **`login(req, res)`**:
   - **Đầu vào**: `req.body` chứa `username`, `password`.
   - **Xử lý**:
     - Kiểm tra dữ liệu: Nếu `username` hoặc `password` không phải chuỗi hoặc rỗng, trả về HTTP 400 Bad Request.
     - Gọi `authService.login(username, password)`.
     - Nhận về `{ accessToken, refreshToken, user }`.
     - Thiết lập 2 cookie HttpOnly trên `res`:
       - `mc_access`: Chứa JWT, `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 15 * 60 * 1000` (15 phút).
       - `mc_refresh`: Chứa refresh token thô, `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 7 * 24 * 60 * 60 * 1000` (7 ngày).
     - Trả về HTTP 200 OK: `{ success: true, data: user }`.
   - **Lỗi**: Nếu thông tin sai hoặc tài khoản bị khóa, trả về HTTP 401 Unauthorized `{ success: false, message: error.message }`.

2. **`refresh(req, res)`**:
   - **Đầu vào**: `req.cookies.mc_refresh`.
   - **Xử lý**:
     - Kiểm tra sự tồn tại của cookie `mc_refresh`. Nếu thiếu, trả về HTTP 401 `{ success: false, message: 'Missing refresh token' }`.
     - Gọi `authService.refresh(oldRefreshToken)`.
     - Nhận về cặp token mới `{ accessToken, refreshToken, user }`.
     - Ghi đè 2 cookie mới vào trình duyệt với hạn dùng mới (Token Rotation).
     - Trả về HTTP 200 OK: `{ success: true, data: user }`.
   - **Lỗi**: Nếu token đã bị thu hồi hoặc phát hiện tấn công tái sử dụng (Replay Attack), trả về HTTP 401, tự động xóa sạch cookie trên client.

3. **`logout(req, res)`**:
   - **Đầu vào**: `req.cookies.mc_refresh`.
   - **Xử lý**:
     - Đọc refresh token từ cookie. Nếu có, gọi `authService.logout(refreshToken)` để vô hiệu hóa toàn bộ chuỗi session trong DB.
     - Dùng `res.clearCookie('mc_access')` và `res.clearCookie('mc_refresh')` để xóa session khỏi trình duyệt.
     - Trả về HTTP 200 OK: `{ success: true, message: 'Logged out successfully' }`.

4. **`me(req, res)`**:
   - **Đầu vào**: `req.user.id` (được giải mã từ Access Token bởi Auth Middleware).
   - **Xử lý**: Gọi `authService.getCurrentUser(userId)` để lấy thông tin mới nhất của nhân viên (họ tên, email, vai trò). Trả về HTTP 200 OK: `{ success: true, data: user }`.

---

#### File: [`services/auth.service.js`](file:///d:/micro_noti_service/service/auth_service/src/services/auth.service.js)
1. **`login(loginName, password)`**:
   - **Đầu vào**: `loginName` (username hoặc email), `password` (chuỗi thô).
   - **Đầu ra**: `{ accessToken, refreshToken, user }`.
   - **Các bước chi tiết**:
     1. Gọi `userRepository.findByLogin(loginName)`. Nếu không tồn tại, ném lỗi 401 (`Invalid credentials`).
     2. Dùng `bcrypt.compare(password, user.password_hash)` để so khớp mật khẩu. Nếu không khớp hoặc `user.status !== 'active'`, ném lỗi 401.
     3. Tạo `accessToken` qua `tokenService.createAccessToken(user)` (chứa payload `id`, `username`, `role`).
     4. Tạo `refreshToken` ngẫu nhiên qua `tokenService.createRefreshToken()`.
     5. Sinh mã gia đình phiên `familyId = crypto.randomUUID()`.
     6. Tính mã băm SHA-256 của refresh token qua `tokenService.hashRefreshToken(refreshToken)`.
     7. Gọi `sessionRepository.createSession(...)` lưu vào bảng `refresh_sessions` với thời hạn 7 ngày.
     8. Gọi `userRepository.updateLastLogin(user.id)` cập nhật thời điểm đăng nhập.
     9. Trả về token và thông tin công khai của user.

2. **`refresh(oldRefreshToken)`**:
   - **Đầu vào**: `oldRefreshToken` (chuỗi hex 128 ký tự).
   - **Đầu ra**: Cặp token mới `{ accessToken, refreshToken, user }`.
   - **Các bước chi tiết (Thuật toán Chống Replay Attack)**:
     1. Tính mã băm `oldHash = tokenService.hashRefreshToken(oldRefreshToken)`.
     2. Mở Client từ DB Pool, bắt đầu Transaction `BEGIN`.
     3. Khóa dòng tìm kiếm: Gọi `sessionRepository.findByHashForUpdate(client, oldHash)` thực thi câu lệnh SQL `SELECT ... FOR UPDATE`. Việc khóa dòng ngăn chặn Race Condition khi 2 request refresh đến cùng 1 microsecond.
     4. Nếu không tìm thấy session: Ném lỗi 401 (`Invalid refresh token`).
     5. **Kiểm tra Tái Sử Dụng (Token Reuse Detection)**:
        - Nếu `oldSession.revoked_at !== null`: Nghĩa là token này **đã từng được sử dụng để đổi token mới trước đây**, nhưng kẻ tấn công (hoặc mã độc) đang cố gắng gửi lại lần thứ hai!
        - Ngay lập tức gọi `sessionRepository.revokeFamily(client, oldSession.family_id)`: **Hủy toàn bộ tất cả các session đang hoạt động thuộc nhóm `family_id` này**.
        - `COMMIT` transaction và ném lỗi 401 (`Refresh token reuse detected`). Kẻ tấn công lẫn nạn nhân đều bị đăng xuất ngay lập tức để bảo vệ tài khoản.
     6. Kiểm tra hết hạn: Nếu `new Date(oldSession.expires_at) <= new Date()`, ném lỗi 401 (`Refresh token expired`).
     7. Kiểm tra trạng thái User: Tìm user qua `userRepository.findById(oldSession.user_id, client)`. Nếu `user.status !== 'active'`, gọi `revokeFamily` và ném lỗi 401.
     8. Sinh `newRefreshToken` mới và băm SHA-256.
     9. Gọi `sessionRepository.insertReplacement(...)` chèn bản ghi session mới kế thừa cùng `family_id`.
     10. Gọi `sessionRepository.replaceSession(client, oldSession.id, newSession.id)` đánh dấu session cũ: `revoked_at = NOW()`, `replaced_by_session_id = newSession.id`.
     11. Ký `newAccessToken` mới cho User.
     12. `COMMIT` transaction và trả về cặp token mới.

3. **`logout(refreshToken)`**:
   - **Đầu vào**: `refreshToken`.
   - **Xử lý**: Băm SHA-256 tìm session trong DB. Nếu tìm thấy, gọi `sessionRepository.revokeFamily(client, session.family_id)` để đánh dấu `revoked_at = NOW()` cho toàn bộ họ token đó.

4. **`getCurrentUser(userId)`**:
   - **Đầu vào**: `userId`.
   - **Xử lý**: Lấy thông tin user từ `userRepository.findById(userId)`. Nếu không tồn tại hoặc bị khóa, ném lỗi 401.

---

#### File: [`services/token.service.js`](file:///d:/micro_noti_service/service/auth_service/src/services/token.service.js)
1. **`createAccessToken(user)`**: Ký JWT với thuật toán HMAC SHA-256 bằng bí mật `JWT_ACCESS_SECRET`, payload `{ id, username, role }`, thời hạn sống ngắn `expiresIn: '15m'`.
2. **`createRefreshToken()`**: Sử dụng `crypto.randomBytes(64).toString('hex')` tạo ra chuỗi ngẫu nhiên có độ dài 128 ký tự hex (độ hỗn loạn entropy cực cao, không thể đoán trước).
3. **`hashRefreshToken(token)`**: Dùng `crypto.createHash('sha256').update(token).digest('hex')` để băm token trước khi ghi vào database. Đảm bảo dù database bị rò rỉ (DB leak), kẻ tấn công cũng không thể giả mạo refresh token.
4. **`verifyAccessToken(token)`**: Xác thực tính hợp lệ của JWT qua thư viện `jsonwebtoken`. Trả về payload giải mã.
5. **`createRefreshExpiry()`**: Trả về đối tượng `Date` tại mốc `NOW() + 7 ngày`.

---

#### File: [`repositories/session.repository.js`](file:///d:/micro_noti_service/service/auth_service/src/repositories/session.repository.js)
1. **`createSession({ userId, familyId, tokenHash, expiresAt })`**: Chèn bản ghi phiên mới vào bảng `refresh_sessions`.
2. **`findByHashForUpdate(client, tokenHash)`**: Chạy câu lệnh `SELECT * FROM refresh_sessions WHERE token_hash = $1 FOR UPDATE`. Khóa độc quyền dòng bản ghi trong suốt transaction để chống tấn công đồng thời (concurrency race condition).
3. **`replaceSession(client, oldSessionId, newSessionId)`**: Cập nhật `UPDATE refresh_sessions SET revoked_at = NOW(), replaced_by_session_id = $2 WHERE id = $1`.
4. **`insertReplacement(client, { userId, familyId, tokenHash, expiresAt })`**: Chèn bản ghi session thay thế trong cùng transaction.
5. **`revokeFamily(client, familyId)`**: Thu hồi toàn bộ session cùng họ: `UPDATE refresh_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL`.

---

#### File: [`repositories/user.repository.js`](file:///d:/micro_noti_service/service/auth_service/src/repositories/user.repository.js)
1. **`findByLogin(loginName)`**: Truy vấn `SELECT u.*, r.code AS role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.username = $1 OR u.email = $1`.
2. **`findById(id, client)`**: Lấy thông tin người dùng kèm tên vai trò (Admin / Support).
3. **`updateLastLogin(userId)`**: Cập nhật `UPDATE users SET last_login_at = NOW() WHERE id = $1`.

---

#### File: [`middlewares/trusted-origin.middleware.js`](file:///d:/micro_noti_service/service/auth_service/src/middlewares/trusted-origin.middleware.js)
1. **`trustedOrigin(req, res, next)`**:
   - Trích xuất header `Origin` hoặc `Referer` từ HTTP request của trình duyệt.
   - So khớp với danh sách cấu hình `ALLOWED_ORIGINS` (ví dụ: `http://localhost:5173`).
   - Nếu request đến từ trình duyệt nhưng mang Origin lạ (dấu hiệu tấn công CSRF), lập tức chặn và trả về HTTP 403 Forbidden `{ success: false, message: 'Untrusted origin' }`.

---

### 3.2. Chat Service (Port 3002)

Được mệnh danh là "Bộ Não Trung Tâm" của toàn bộ hệ thống: Xử lý tiếp nhận tin nhắn từ Dashboard, lưu trữ Transactional Outbox, quản lý tệp đính kèm cục bộ, tiếp nhận kết quả Telegram qua Kafka, điều phối thử lại (Retry) và phát tín hiệu Server-Sent Events (SSE) cho Client theo thời gian thực.

```
service/chat_service/
├── storage/attachments/                # Thư mục lưu trữ nhị phân file (YYYY/MM/uuid.ext)
├── src/
│   ├── app.js                          # Khởi tạo Express, CORS, Multipart Multer, Auth Middleware
│   ├── server.js                       # Start server cổng 3002
│   ├── config/database.js              # PostgreSQL Pool
│   ├── controllers/
│   │   ├── conversation.controller.js  # Lấy danh sách hội thoại, tài khoản bot
│   │   ├── message.controller.js       # Phân trang tin nhắn (keyset), gửi text (202), gửi file (202)
│   │   ├── attachment.controller.js    # Tải file xem trước cho React Dashboard (/api/attachments/:id)
│   │   ├── internal.controller.js      # Internal API (claim-send, delivery-result, download-attachment, incoming)
│   │   └── sse.controller.js           # Duy trì kết nối SSE stream (/api/events)
│   ├── kafka/
│   │   ├── kafka.client.js             # Khởi tạo KafkaJS Client
│   │   ├── result.consumer.js          # Lắng nghe topic 'telegram.message.result' -> DB -> SSE
│   │   └── incoming.consumer.js        # Lắng nghe topic 'telegram.message.incoming' -> Lưu DB -> SSE
│   ├── repository/
│   │   └── message.repository.js       # Truy vấn hội thoại, Transaction Message + Outbox, Keyset Pagination
│   ├── repositories/
│   │   ├── telegram-delivery.repository.js # Quản lý Claim thế hệ (claimMessage, claimRetryMessage, applyDeliveryResult)
│   │   ├── delivery-result.repository.js   # Ghi nhận kết quả từ Telegram, kiểm tra MAX_RETRIES, tạo Result Outbox
│   │   ├── retry.repository.js         # scheduleDueRetries: Khóa các attempt retry_waiting đến hạn, tạo Outbox gen mới
│   │   ├── outbox.repository.js        # Quét outbox pending, update published / failed
│   │   └── attachment.repository.js    # Truy vấn metadata file đính kèm cho Telegram tải
│   ├── services/
│   │   ├── message.service.js          # Logic gửi text, gửi file, kiểm tra idempotency, xóa orphan file
│   │   ├── chat.service.js             # Lưu tin nhắn incoming, upsert conversation, deduplicate webhook
│   │   ├── attachment.service.js       # Lưu tệp đính kèm vào ổ cứng, xóa file vật lý khi rollback
│   │   └── sse.service.js              # Broadcast sự kiện SSE tới active clients, gửi heartbeat :ping
│   └── workers/
│       ├── outbox.worker.js            # Quét outbox_events mỗi 500ms -> bắn Kafka telegram.message.send/result
│       ├── retry.worker.js             # Quét attempt retry_waiting mỗi 3s -> sinh outbox thế hệ mới
│       └── delivery-reconciliation.worker.js # Quét các lần gửi kẹt 'processing' quá 60s -> đánh dấu 'unknown'
```

#### Chi Tiết Từng File & Hàm Của Chat Service:

#### File: [`controllers/message.controller.js`](file:///d:/micro_noti_service/service/chat_service/src/controllers/message.controller.js)
1. **`getMessage(req, res, next)`**:
   - **Đầu vào**: `req.params.conversationId`, `req.query.limit` (mặc định 20, tối đa 100), `req.query.cursor` (chuỗi base64url).
   - **Xử lý**: Gọi `messageService.getMessage(conversationId, limit, cursor)`. Trả về HTTP 200 OK `{ success: true, ...result }` gồm danh sách tin nhắn và `nextCursor` cho lần tải trang tiếp theo.
2. **`sendMessage(req, res, next)`**:
   - **Đầu vào**: `req.params.conversationId`, `req.body.content`, `req.body.clientRequestId`, `req.user.id`.
   - **Xử lý**:
     - Kiểm tra dữ liệu: `content` không rỗng, `clientRequestId` phải là UUID hợp lệ.
     - Gọi `messageService.sendMessage(...)`.
     - Nhận về `{ message, duplicate, outcomeUnknown }`.
     - Nếu là tin nhắn gửi mới: Trả về **HTTP 202 Accepted** `{ success: true, data: message }`.
     - Nếu phát hiện click đúp trùng lặp (`duplicate = true`): Trả về HTTP 200/202 kèm bản ghi cũ mà không gửi lại lệnh vào Outbox.
3. **`sendAttachment(req, res, next)`**:
   - **Đầu vào**: `req.params.conversationId`, `req.file` (từ multer memoryStorage), `req.body.content` (caption tùy chọn), `req.body.clientRequestId`.
   - **Xử lý**:
     - Kiểm tra sự tồn tại của file tải lên và kích thước (tối đa 20MB).
     - Gọi `messageService.sendAttachment(...)`.
     - Trả về **HTTP 202 Accepted** `{ success: true, data: { message, attachmentId } }`.

---

#### File: [`controllers/internal.controller.js`](file:///d:/micro_noti_service/service/chat_service/src/controllers/internal.controller.js)
1. **`claimTelegramMessage(req, res)`**:
   - **Đầu vào**: `req.params.messageId`, `req.body.attemptGeneration` (mặc định 1).
   - **Xử lý**:
     - Nếu `attemptGeneration === 1`: Gọi `telegramDeliveryRepository.claimMessage(messageId)`.
     - Nếu `attemptGeneration > 1`: Gọi `telegramDeliveryRepository.claimRetryMessage({ messageId, attemptGeneration })`.
     - Trả về HTTP 200 OK `{ success: true, data: { claimed: boolean, data: object, attemptGeneration } }`.
2. **`recordTelegramResult(req, res)`**:
   - **Đầu vào**: `req.body` chứa `{ messageId, attemptGeneration, status, externalMessageId, sentAt, errorCode, errorMessage, retryAfterSeconds }`.
   - **Xử lý**:
     - Validate dữ liệu đầu vào.
     - Gọi `deliveryResultRepository.saveDeliveryResultWithOutbox(req.body)`.
     - Trả về HTTP 200 OK `{ success: true, data: result }`. Nếu có lỗi generation cũ, trả về HTTP 409 Conflict.
3. **`downloadInternalAttachment(req, res)`**:
   - **Đầu vào**: `req.params.messageId`, `req.params.attachmentId`, header `x-internal-api-key`.
   - **Xử lý (Bảo Mật Đường Dẫn & Stream Nhị Phân)**:
     - Gọi `attachmentRepository.findAttachmentForTelegram(messageId, attachmentId)`. Nếu không thấy, trả về HTTP 404.
     - Kiểm tra chống tấn công Path Traversal: Kiểm tra `storage_key` không chứa dấu `..` và không phải đường dẫn tuyệt đối.
     - Tạo ReadStream: `fs.createReadStream(filePath)`.
     - Thiết lập header: `Content-Type: mime_type`, `Content-Disposition: attachment`.
     - Pipe dòng dữ liệu trực tiếp sang HTTP response (`fileStream.pipe(res)`). Giúp truyền file hàng chục MB mà không tốn RAM của Chat Service.
4. **`receiveIncomingMessage(req, res)`**:
   - **Đầu vào**: `req.body` chứa dữ liệu tin nhắn Telegram webhook.
   - **Xử lý**:
     - Gọi `chatService.saveTelegramMessage(req.body)`.
     - Nếu tin nhắn được tạo mới (`result.created === true`), kích hoạt `sseService.broadcast('new_message', { conversationId, messageId, direction: 'incoming' })`.
     - Trả về HTTP 201 Created (hoặc 200 nếu duplicate).
5. **`notifyMessageUpdated(req, res)`**:
   - **Đầu vào**: `req.body` chứa `{ conversationId, messageId, status }`.
   - **Xử lý**: Gọi `sseService.broadcast('message_updated', req.body)` để thông báo cho toàn bộ nhân viên đang mở Dashboard.

---

#### File: [`services/message.service.js`](file:///d:/micro_noti_service/service/chat_service/src/services/message.service.js)
1. **`encodeCursor(message)`**: Chuyển đổi `{ createdAt: ISOString, id: UUID }` thành chuỗi `base64url`.
2. **`decodeCursor(cursor)`**: Giải mã chuỗi `base64url`, validate định dạng ISO Date và regex UUID. Ném lỗi 400 nếu cursor bị người dùng can thiệp sửa đổi.
3. **`getMessage(conversationId, limit, cursor)`**:
   - Kiểm tra conversation có tồn tại trong DB không (404).
   - Truy vấn DB lấy `limit + 1` bản ghi theo kỹ thuật **Keyset Pagination**: Lọc `(m.created_at, m.id) < (cursorDate, cursorId) ORDER BY m.created_at DESC, m.id DESC`.
   - Nếu số bản ghi trả về vượt quá `limit`, gán `hasMore = true` và lấy bản ghi thứ `limit` để mã hóa `nextCursor`.
   - Đảo ngược mảng trả về (`reverse()`) để Frontend hiển thị từ cũ đến mới theo đúng thứ tự dòng thời gian.
4. **`sendMessage({ conversationId, content, clientRequestId, sentByUserId })`**:
   - Tìm và kiểm tra conversation: Phải thuộc kênh `TELEGRAM` và có trạng thái `status = 'open'`.
   - Gọi `messageRepository.createPendingWithOutbox(...)` để lưu đồng thời tin nhắn `messages` và sự kiện `outbox_events` trong 1 transaction.
   - Nếu `result.duplicate === true`: Kiểm tra tính nhất quán (nếu cùng `clientRequestId` nhưng `content` khác thì ném lỗi 409 Conflict; nếu trùng khớp hoàn toàn thì trả về bản ghi cũ).
   - Trả về `{ message, duplicate: false }`.
5. **`sendAttachment({ conversationId, content, clientRequestId, sentByUserId, file })`**:
   - Kiểm tra loại MIME cho phép (`ALLOWED_MIME_TYPES`: JPEG, PNG, WEBP, PDF, DOCX, XLSX, TXT) và kích thước file ($\le 20\text{MB}$).
   - Kiểm tra Idempotency qua `clientRequestId`.
   - **Lưu file vật lý trước**: Gọi `attachmentService.saveFile(file)` ghi file vào ổ cứng (`storage/attachments/YYYY/MM/uuid.ext`).
   - Mở Transaction DB: Gọi `messageRepository.createAttachmentMessageWithOutbox(...)`.
   - **Cơ Chế Tự Dọn Dẹp File Rác (Orphan Cleanup)**:
     - Nằm trong khối `try/catch`. Nếu bất kỳ thao tác database nào bị lỗi và Rollback, khối `catch` sẽ ngay lập tức gọi `attachmentService.deleteFile(savedFile.absolutePath)`. Đảm bảo ổ cứng không bao giờ bị rác bởi những file mồ côi không có bản ghi DB.

---

#### File: [`services/attachment.service.js`](file:///d:/micro_noti_service/service/chat_service/src/services/attachment.service.js)
1. **`saveFile(file)`**:
   - Lấy năm và tháng hiện tại để tạo thư mục lưu trữ phân cấp: `storage/attachments/2026/11/`.
   - Sinh tên file ngẫu nhiên an toàn: `crypto.randomUUID() + path.extname(file.originalname)`.
   - Ghi dữ liệu nhị phân `fs.promises.writeFile(absolutePath, file.buffer)`.
   - Trả về đối tượng `{ storageKey, absolutePath, size }`.
2. **`deleteFile(filePath)`**: Sử dụng `fs.promises.unlink(filePath)` để xóa file khi có yêu cầu rollback hoặc dọn dẹp.

---

#### File: [`services/sse.service.js`](file:///d:/micro_noti_service/service/chat_service/src/services/sse.service.js)
1. **`addClient(res)`**: Thêm kết nối HTTP response của nhân viên vào danh sách `activeClients = new Set()`. Gửi gói tin chào đón `event: connected`.
2. **`removeClient(res)`**: Xóa client khỏi danh sách khi đóng tab hoặc mất mạng.
3. **`broadcast(event, data)`**: Lặp qua tất cả kết nối trong `activeClients`, ghi dữ liệu theo đúng chuẩn W3C SSE:
   ```text
   event: message_updated\n
   data: {"messageId":"...","status":"sent"}\n\n
   ```
4. **`sendHeartbeat()`**: Gửi gói tin comment `:ping\n\n` định kỳ mỗi 20 giây để giữ kết nối TCP luôn sống, chống việc router hoặc proxy (Nginx/Cloudflare) tự động đóng kết nối vì nhàn rỗi (idle timeout).

---

#### File: [`repository/message.repository.js`](file:///d:/micro_noti_service/service/chat_service/src/repository/message.repository.js)
1. **`createPendingWithOutbox(...)`**:
   - `BEGIN` Transaction.
   - Thử chèn `INSERT INTO messages (id, conversation_id, sent_by_user_id, client_request_id, direction, message_type, content, status) VALUES (...) ON CONFLICT (client_request_id) DO NOTHING`.
   - Nếu `rowCount === 0`: Phát hiện trùng lặp $\rightarrow$ `ROLLBACK`, trả về `{ duplicate: true }`.
   - Nếu chèn thành công: Chèn tiếp vào `INSERT INTO outbox_events (id, aggregate_id, topic, event_key, payload, status) VALUES (...)` với `topic = 'telegram.message.send'`, payload `{ messageId, conversationId, attemptGeneration: 1 }`.
   - `COMMIT` Transaction.
2. **`createAttachmentMessageWithOutbox(...)`**:
   - Chèn đồng thời 3 bảng trong cùng 1 Transaction:
     1. `messages`: Lưu tin nhắn trạng thái `pending`.
     2. `message_attachments`: Lưu `file_name`, `mime_type`, `file_size`, `storage_key`, `checksum_sha256`.
     3. `outbox_events`: Lưu sự kiện Outbox (chỉ chứa `attachmentId` và metadata, tuyệt đối **không chứa nội dung nhị phân** vào Kafka).
   - `COMMIT` Transaction.

---

#### File: [`repositories/telegram-delivery.repository.js`](file:///d:/micro_noti_service/service/chat_service/src/repositories/telegram-delivery.repository.js)
1. **`claimMessage(messageId)`**:
   - Mở Transaction `BEGIN`.
   - Chèn lượt gửi đầu tiên (Generation 1):
     ```sql
     INSERT INTO telegram_delivery_attempts (message_id, status, attempt_generation)
     SELECT m.id, 'processing', 1
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN channel_accounts ca ON ca.id = c.channel_account_id
     JOIN channels ch ON ch.id = ca.channel_id
     WHERE m.id = $1 AND m.status = 'pending' AND ch.code = 'TELEGRAM'
     ON CONFLICT (message_id) DO NOTHING
     RETURNING message_id;
     ```
   - Nếu `rowCount === 0`: Đã có worker khác claim trước $\rightarrow$ `ROLLBACK`, trả về `{ claimed: false }`.
   - Nếu thành công: Truy vấn dữ liệu tin nhắn và attachment từ DB, `COMMIT`, trả về `{ claimed: true, data, attemptGeneration: 1 }`.
2. **`claimRetryMessage({ messageId, attemptGeneration })`**:
   - Cập nhật attempt từ `retry_waiting` sang `processing`:
     ```sql
     UPDATE telegram_delivery_attempts
     SET status = 'processing', attempt_generation = $2, queued_retry_generation = NULL, started_at = NOW()
     WHERE message_id = $1 AND status = 'retry_waiting'
       AND queued_retry_generation = $2
       AND attempt_generation = $2 - 1
       AND next_retry_at <= NOW()
     RETURNING message_id;
     ```
   - Nếu `rowCount === 0`: Không hợp lệ hoặc đã bị claim $\rightarrow$ trả về `{ claimed: false }`.
   - Nếu thành công: Lấy dữ liệu gửi từ DB, `COMMIT`, trả về `{ claimed: true, data, attemptGeneration }`.
3. **`applyDeliveryResult(data)`**:
   - Mở Transaction `BEGIN`.
   - Lấy attempt hiện tại từ DB.
   - **Loại bỏ kết quả cũ (Stale Check)**: Nếu `attempt.attempt_generation !== data.attemptGeneration`, ghi log cảnh báo và bỏ qua (`return { updated: false, stale: true }`).
   - Nếu `data.status === 'sent'`: Cập nhật `messages.status = 'sent'`, gán `external_message_id = $2`, `sent_at = $3`.
   - Nếu `data.status === 'failed'`: Cập nhật `messages.status = 'failed'`, gán `error_message = $2`.
   - `COMMIT` Transaction.

---

#### File: [`repositories/delivery-result.repository.js`](file:///d:/micro_noti_service/service/chat_service/src/repositories/delivery-result.repository.js)
1. **`saveDeliveryResultWithOutbox(data)`**:
   - Mở Transaction `BEGIN`.
   - Khóa bản ghi attempt: `SELECT ... FROM telegram_delivery_attempts a WHERE a.message_id = $1 FOR UPDATE OF a`.
   - So sánh generation: Nếu `attempt.attempt_generation !== generation`, ném lỗi HTTP 409 Conflict (`Stale attempt generation`).
   - Xử lý trạng thái `retry_waiting`:
     - Nếu `attempt.retry_count >= MAX_RETRIES` (3 lần): Đánh dấu attempt thành `failed`, đồng thời chèn Outbox event `telegram.message.result` với `status: 'failed'`.
     - Nếu chưa vượt quá 3 lần: Tính toán `next_retry_at = NOW() + delay INTERVAL`, cập nhật attempt `status = 'retry_waiting'`, tăng `retry_count = retry_count + 1`.
   - Xử lý trạng thái `sent` hoặc `failed`:
     - Cập nhật attempt thành `sent`/`failed`.
     - Chèn bản ghi vào bảng `outbox_events` với `topic = 'telegram.message.result'` để Outbox Worker bắn sang Kafka cho Result Consumer cập nhật.
   - `COMMIT` Transaction.

---

#### File: [`repositories/retry.repository.js`](file:///d:/micro_noti_service/service/chat_service/src/repositories/retry.repository.js)
1. **`scheduleDueRetries(limit = 10)`**:
   - Mở Transaction `BEGIN`.
   - Quét và khóa các attempt đến hạn retry:
     ```sql
     SELECT a.message_id, a.attempt_generation, m.conversation_id
     FROM telegram_delivery_attempts a
     JOIN messages m ON m.id = a.message_id
     WHERE a.status = 'retry_waiting'
       AND a.next_retry_at <= NOW()
       AND a.queued_retry_generation IS NULL
       AND m.status = 'pending'
     ORDER BY a.next_retry_at, a.message_id
     FOR UPDATE OF a SKIP LOCKED
     LIMIT $1;
     ```
   - Với mỗi bản ghi:
     - Tính `nextGeneration = attempt_generation + 1`.
     - Chèn sự kiện gửi lại vào `outbox_events` với `topic = 'telegram.message.send'`, payload chứa `{ messageId, conversationId, attemptGeneration: nextGeneration }`.
     - Cập nhật `telegram_delivery_attempts SET queued_retry_generation = nextGeneration`. Đảm bảo ở các vòng quét tiếp theo scheduler không tạo lặp sự kiện Outbox.
   - `COMMIT` Transaction.

---

#### File: [`repositories/outbox.repository.js`](file:///d:/micro_noti_service/service/chat_service/src/repositories/outbox.repository.js)
1. **`fetchPendingEvents(limit = 20)`**: Quét các bản ghi Outbox đang chờ gửi: `SELECT * FROM outbox_events WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`.
2. **`markAsPublished(ids)`**: Cập nhật danh sách ID sự kiện thành công: `UPDATE outbox_events SET status = 'published', published_at = NOW() WHERE id = ANY($1)`.
3. **`markAsFailed(id, errorMessage)`**: Cập nhật sự kiện lỗi: `UPDATE outbox_events SET status = 'failed', retry_count = retry_count + 1, last_error = $2 WHERE id = $1`.

---

#### File: [`workers/outbox.worker.js`](file:///d:/micro_noti_service/service/chat_service/src/workers/outbox.worker.js)
1. **`processOutbox()`**:
   - Gọi `outboxRepository.fetchPendingEvents(20)`.
   - Với từng event, gọi Kafka Producer gửi vào topic tương ứng (`telegram.message.send` hoặc `telegram.message.result`), dùng `event_key` làm Partition Key.
   - Sau khi Kafka xác nhận (ACK), gọi `outboxRepository.markAsPublished(publishedIds)`.
2. **`startOutboxWorker(intervalMs = 500)`**: Khởi động vòng lặp `setInterval` chạy định kỳ mỗi 500ms.

---

#### File: [`workers/retry.worker.js`](file:///d:/micro_noti_service/service/chat_service/src/workers/retry.worker.js)
1. **`processRetries()`**: Gọi `retryRepository.scheduleDueRetries(10)` để quét và đưa các tin nhắn hết hạn delay vào Outbox.
2. **`startRetryWorker(intervalMs = 3000)`**: Chạy định kỳ mỗi 3 giây một lần.

---

#### File: [`workers/delivery-reconciliation.worker.js`](file:///d:/micro_noti_service/service/chat_service/src/workers/delivery-reconciliation.worker.js)
1. **`reconcileStuckDeliveries(timeoutSeconds = 60)`**:
   - Quét các attempt có `status = 'processing'` nhưng `started_at <= NOW() - 60 seconds`.
   - Đánh dấu các attempt này thành `'unknown'` để tránh việc tin nhắn bị treo mãi mãi khi Telegram Worker bị crash hoặc mất nguồn đột ngột.

---

#### File: [`kafka/result.consumer.js`](file:///d:/micro_noti_service/service/chat_service/src/kafka/result.consumer.js)
1. **`handleSendResult(messagePayload)`**:
   - Đọc payload từ topic `telegram.message.result`.
   - Gọi `telegramDeliveryRepository.applyDeliveryResult(payload)`.
   - Nếu trạng thái tin nhắn được cập nhật thành `sent` hoặc `failed`, gọi Internal API `POST /internal/notify-message-updated` để phát tín hiệu SSE cho React Dashboard.
2. **`startResultConsumer()`**: Đăng ký Consumer Group `chat-result-workers`, subscribe topic `telegram.message.result`.

---

#### File: [`kafka/incoming.consumer.js`](file:///d:/micro_noti_service/service/chat_service/src/kafka/incoming.consumer.js)
1. **`processIncomingMessage(messagePayload)`**:
   - Đọc payload từ topic `telegram.message.incoming`.
   - Gọi Internal API `POST /internal/messages/incoming` để lưu tin nhắn khách hàng vào DB và phát SSE `new_message`.
   - Commit offset thủ công sau khi xử lý thành công.
2. **`startIncomingConsumer()`**: Đăng ký Consumer Group `chat-incoming-workers`, subscribe topic `telegram.message.incoming`.

---

### 3.3. Telegram Service (Port 3003)

Đóng vai trò là Adapter kết nối trực tiếp với Telegram Bot API: Quản lý Multi-Bot Telegraf, tiếp nhận Webhook, lắng nghe Kafka command gửi tin, tải file binary từ Chat Service, gọi Telegram Bot API và phân loại lỗi.

```
service/telegram_service/
├── src/
│   ├── app.js                          # Cấu hình Express app
│   ├── server.js                       # Start server cổng 3003, khởi tạo Multi-bot
│   ├── controller/
│   │   ├── webhook.controller.js       # Nhận Telegram Webhook, kiểm tra secret, bắn Kafka incoming
│   │   └── internal-message.controller.js # Endpoint legacy gửi HTTP trực tiếp
│   ├── kafka/
│   │   ├── kafka.client.js             # KafkaJS Client
│   │   ├── incoming.producer.js        # Publish tin nhắn khách lên 'telegram.message.incoming'
│   │   ├── send.consumer.js            # Lắng nghe 'telegram.message.send', claim và điều phối gửi
│   │   └── dlt.producer.js             # Đẩy vào 'telegram.message.dlt' khi gặp lỗi vĩnh viễn
│   └── services/
│       ├── bot-manager.service.js      # Khởi tạo và quản lý nhiều instance Bot Telegraf trong RAM
│       ├── telegram-send-dispatcher.service.js # Phân luồng: Text -> sendMessage, Ảnh/Doc -> tải buffer -> gửi
│       ├── telegram-message.service.js # Gọi Telegraf: sendTextMessage, sendPhotoMessage, sendDocumentMessage
│       ├── attachment.service.js       # Tải tệp từ Chat Service qua Internal API Stream
│       ├── chat-internal.service.js    # Gọi Chat Service: claimTelegramMessage, recordTelegramResult
│       └── telegram-error.service.js   # Phân loại mã lỗi Telegram (429 Rate Limit, 400/403 Permanent, Timeout)
```

#### Chi Tiết Từng File & Hàm Của Telegram Service:

#### File: [`controller/webhook.controller.js`](file:///d:/micro_noti_service/service/telegram_service/src/controller/webhook.controller.js)
1. **`receiveWebhook(req, res)`**:
   - **Đầu vào**: `req.params.botId`, header `x-telegram-bot-api-secret-token`, `req.body` (Telegram Update).
   - **Xử lý**:
     - Lấy cấu hình bot từ `botManagerService.getBot(botId)`. Nếu không tồn tại, trả về HTTP 404.
     - **Chống Timing Attack**: So khớp secret token qua `secretsMatch(receivedSecret, entry.webhookSecret)`.
     - Nếu hợp lệ: Trích xuất thông tin tin nhắn khách hàng (chatId, messageId, text, senderId, senderName).
     - Đóng gói dữ liệu và gọi `incomingProducer.publishIncomingMessage(inboundData)`.
     - **Chỉ trả về HTTP 200 OK sau khi Kafka đã ghi nhận bền vững** (acks = -1). Đảm bảo nếu container bị crash, tin nhắn của khách hàng cũng không bao giờ bị rơi rớt.
2. **`secretsMatch(received, expected)`**: Sử dụng `crypto.timingSafeEqual` để so sánh độ dài và từng byte ký tự, ngăn chặn hacker đo thời gian phản hồi để đoán secret token.

---

#### File: [`services/bot-manager.service.js`](file:///d:/micro_noti_service/service/telegram_service/src/services/bot-manager.service.js)
1. **`initializeBots()`**: Đọc cấu hình danh sách token từ biến môi trường hoặc gọi Chat Service để lấy danh sách các bot đang kích hoạt. Khởi tạo từng đối tượng `new Telegraf(token)` và lưu vào bộ nhớ `Map<botId, BotEntry>`.
2. **`getBot(botId)`**: Tìm và trả về instance Bot theo ID.
3. **`getAllBots()`**: Trả về toàn bộ danh sách bot đang trực tuyến.

---

#### File: [`services/telegram-send-dispatcher.service.js`](file:///d:/micro_noti_service/service/telegram_service/src/services/telegram-send-dispatcher.service.js)
1. **`sendTelegramMessage(data)`**:
   - Nhận dữ liệu payload từ lượt claim thành công (`message_type`, `content`, `external_account_id`, `external_chat_id`, `attachment_id`, `file_name`).
   - Nếu `message_type === 'text'`: Gọi `telegramMessageService.sendTextMessage(...)`.
   - Nếu `message_type === 'image'` hoặc `'document'`:
     - Kiểm tra `data.attachment_id`. Nếu thiếu, ném lỗi `Attachment ID is required`.
     - Gọi `attachmentService.downloadAttachment({ messageId, attachmentId })` để tải file binary dạng `Buffer` qua mạng nội bộ từ Chat Service.
     - Nếu là `image`: Gọi `telegramMessageService.sendPhotoMessage({ buffer, fileName, caption: data.content })`.
     - Nếu là `document`: Gọi `telegramMessageService.sendDocumentMessage({ buffer, fileName, caption: data.content })`.

---

#### File: [`services/telegram-message.service.js`](file:///d:/micro_noti_service/service/telegram_service/src/services/telegram-message.service.js)
1. **`resolveBotEntry(externalAccountId)`**: Tìm instance Telegraf theo ID tài khoản bot. Nếu không thấy, ném lỗi 404.
2. **`sendTextMessage({ externalAccountId, externalChatId, content })`**:
   - Gọi `bot.telegram.sendMessage(externalChatId, content)`.
   - Trả về `{ externalMessageId: String(result.message_id), sentAt: ISOString }`.
3. **`sendPhotoMessage({ externalAccountId, externalChatId, buffer, fileName, caption })`**:
   - Đóng gói file qua `Input.fromBuffer(buffer, fileName)`.
   - Gọi `bot.telegram.sendPhoto(externalChatId, input, { caption })`.
   - Trả về `{ externalMessageId, externalFileId, sentAt }`.
4. **`sendDocumentMessage({ externalAccountId, externalChatId, buffer, fileName, caption })`**:
   - Đóng gói file qua `Input.fromBuffer(buffer, fileName)`.
   - Gọi `bot.telegram.sendDocument(externalChatId, input, { caption })`.
   - Trả về `{ externalMessageId, externalFileId, sentAt }`.

---

#### File: [`services/attachment.service.js`](file:///d:/micro_noti_service/service/telegram_service/src/services/attachment.service.js)
1. **`downloadAttachment({ messageId, attachmentId })`**:
   - Thực hiện HTTP GET tới `CHAT_SERVICE_URL/internal/messages/:messageId/attachments/:attachmentId` kèm header `x-internal-api-key`.
   - Đọc Stream dữ liệu, kiểm tra dung lượng tối đa 10MB.
   - Ghép các chunk thành `Buffer` hoàn chỉnh và trả về.

---

#### File: [`services/chat-internal.service.js`](file:///d:/micro_noti_service/service/telegram_service/src/services/chat-internal.service.js)
1. **`claimTelegramMessage(messageId, attemptGeneration)`**: Gửi yêu cầu HTTP POST tới Chat Service `/internal/messages/:messageId/claim-send` với body `{ attemptGeneration }`. Nhận về kết quả claim.
2. **`recordTelegramResult(resultData)`**: Gửi yêu cầu HTTP POST tới Chat Service `/internal/messages/delivery-result` chứa kết quả gửi Telegram.

---

#### File: [`services/telegram-error.service.js`](file:///d:/micro_noti_service/service/telegram_service/src/services/telegram-error.service.js)
1. **`classifyTelegramError(error)`**:
   - Phân tích mã lỗi Telegram:
     - **Lỗi 429 (Too Many Requests)**: Phân loại `type: 'retryable'`, mã `code: 'RATE_LIMIT'`, trích xuất `retryAfterSeconds = error.parameters?.retry_after || 5`.
     - **Lỗi 400 / 403 (Chat not found, Bot was blocked by the user)**: Phân loại `type: 'permanent'`, mã `code: 'PERMANENT_ERROR'`.
     - **Lỗi Mạng (ETIMEDOUT, ECONNRESET, Timeout)**: Phân loại `type: 'unknown'`, mã `code: 'NETWORK_TIMEOUT'`.

---

#### File: [`kafka/send.consumer.js`](file:///d:/micro_noti_service/service/telegram_service/src/kafka/send.consumer.js)
1. **`handleSendMessage(command)`**:
   - Trích xuất `attemptGeneration = command.attemptGeneration ?? 1`.
   - Gọi `claimTelegramMessage(command.messageId, attemptGeneration)`.
   - Nếu `claim.claimed === false`: Dừng lại ngay lập tức (bỏ qua lệnh trùng hoặc lệnh thế hệ cũ).
   - Nếu claim thành công: Gọi `sendTelegramMessage(claim.data)` trong khối `try/catch` riêng để bắt lỗi Telegram API.
   - Bắt lỗi qua `classifyTelegramError(error)`:
     - Lỗi 429: Chuyển trạng thái `retry_waiting` kèm `retryAfterSeconds`.
     - Lỗi 400/403: Chuyển trạng thái `failed`.
     - Lỗi timeout: Chuyển trạng thái `unknown`.
   - Gọi `recordTelegramResult(resultEvent)` ngoài khối `try/catch` Telegram để ghi nhận kết quả vào database Chat Service.

---

#### File: [`kafka/incoming.producer.js`](file:///d:/micro_noti_service/service/telegram_service/src/kafka/incoming.producer.js)
1. **`publishIncomingMessage(data)`**: Kết nối Producer, bắn dữ liệu vào topic `telegram.message.incoming` với Partition Key `${externalAccountId}:${externalChatId}`, cấu hình `acks: -1` đảm bảo dữ liệu được ghi vào toàn bộ Kafka In-Sync Replicas.

---

### 3.4. Frontend React Dashboard (Vite - Port 5173)

Giao diện người dùng thời gian thực (Single Page Application) phục vụ nhân viên trực chat:
- **[`App.jsx`](file:///d:/micro_noti_service/frontend/chat-dashboard/src/App.jsx)**: Component gốc, khởi tạo layout danh sách chat và cửa sổ nhắn tin.
- **[`useChatEvents.js`](file:///d:/micro_noti_service/frontend/chat-dashboard/src/hooks/useChatEvents.js)**:
  - Khởi tạo kết nối SSE tại `/api/events`.
  - Lắng nghe sự kiện `new_message`: Tự động thêm tin nhắn mới vào danh sách chat nếu đang mở conversation tương ứng, hoặc hiển thị chỉ báo tin nhắn mới ở `ConversationList`.
  - Lắng nghe sự kiện `message_updated`: Tự động cập nhật badge trạng thái của tin nhắn từ `pending` sang `sent` (kèm icon tích xanh) hoặc `failed` (icon cảnh báo đỏ) mà không cần người dùng tải lại trang (F5).
- **[`MessageInput.jsx`](file:///d:/micro_noti_service/frontend/chat-dashboard/src/components/MessageInput.jsx)**:
  - Sinh mã `clientRequestId = crypto.randomUUID()` cho mỗi lần bấm gửi.
  - Hỗ trợ chọn tệp (Ảnh, File PDF, Word) và gửi thông qua `multipart/form-data` tới `/api/conversations/:id/attachments`.

---

## 4. CÁC LUỒNG NGHIỆP VỤ HOẠT ĐỘNG CỐT LÕI (END-TO-END FLOWS)

---

### Luồng 1: Xác Thực, Cấp Phát & Refresh Token Rotation (Chống Tấn Công Tái Sử Dụng Token)

Luồng xác thực bảo vệ tuyệt đối session của nhân viên thông qua HttpOnly Cookie và thuật toán Session Family Rotation:

```mermaid
sequenceDiagram
    autonumber
    actor User as Nhân Viên
    participant React as React Dashboard
    participant Auth as Auth Service
    participant DB as PostgreSQL

    User->>React: Nhập username/password
    React->>Auth: POST /auth/login (Origin check)
    Auth->>DB: Tìm user, kiểm tra mật khẩu bcrypt
    Auth->>DB: INSERT user_sessions (family_id = UUID, token_hash)
    Auth-->>React: HTTP 200 (Set-Cookie: mc_access, mc_refresh HttpOnly)

    Note over React,Auth: Khi Access Token hết hạn (15 phút)
    React->>Auth: POST /auth/refresh (Gửi mc_refresh)
    Auth->>DB: Tìm session theo hash của mc_refresh
    alt Token hợp lệ và chưa từng bị dùng lại
        Auth->>DB: Đánh dấu session cũ revoked_at = NOW(), replaced_by = new_session_id
        Auth->>DB: INSERT session mới (cùng family_id)
        Auth-->>React: Cấp cặp Cookie mới (Rotated)
    else Phát hiện Replay Attack (Token cũ đã bị thu hồi)
        Auth->>DB: UPDATE user_sessions SET revoked_at = NOW() WHERE family_id = target
        Auth-->>React: HTTP 401 Unauthorized (Toàn bộ phiên bị hủy an toàn)
    end
```

#### Diễn Giải Chi Tiết Từng Bước Trong Code:
1. **Bước 1 (Đăng nhập)**: Nhân viên điền `username` và `password` trên form React Dashboard và bấm Đăng nhập. Trình duyệt gửi `POST http://localhost:3001/auth/login`. Header `Origin: http://localhost:5173` được middleware `trustedOrigin` kiểm tra hợp lệ.
2. **Bước 2 (Kiểm tra mật khẩu & Tạo Session)**:
   - `authService.login()` truy vấn DB tìm user. So khớp hash mật khẩu bằng `bcrypt.compare`.
   - Sinh `family_id = crypto.randomUUID()`.
   - Sinh `refreshToken` ngẫu nhiên (128 ký tự hex), băm `tokenHash = SHA256(refreshToken)`.
   - Lưu vào bảng `refresh_sessions` với `expires_at = NOW() + 7 ngày`.
   - Ký `accessToken` JWT (thời hạn 15 phút).
   - Thiết lập 2 Cookie `mc_access` và `mc_refresh` có cờ `HttpOnly`, `SameSite: 'lax'`. Trả về HTTP 200 `{ success: true, data: user }`.
3. **Bước 3 (Gọi API nghiệp vụ)**: Khi nhân viên chat, trình duyệt tự động gửi cookie `mc_access` kèm theo. Middleware xác thực kiểm tra chữ ký JWT mà không cần truy vấn DB (Stateless Authentication).
4. **Bước 4 (Hết hạn & Xoay Vòng Token - Rotation)**: Sau 15 phút, Access Token hết hạn (trả về 401). React Axios Interceptor tự động gửi `POST /auth/refresh` mang theo cookie `mc_refresh`.
5. **Bước 5 (Xử lý Refresh & Khóa Transaction)**:
   - `authService.refresh()` băm SHA-256 token nhận được.
   - Bắt đầu transaction và thực thi câu lệnh SQL:
     ```sql
     SELECT * FROM refresh_sessions WHERE token_hash = $1 FOR UPDATE;
     ```
     Lệnh `FOR UPDATE` khóa độc quyền dòng bản ghi, ngăn chặn 2 request đồng thời cạnh tranh token.
6. **Bước 6 (Nhánh Bình Thường - Token Hợp Lệ)**:
   - Nếu `oldSession.revoked_at IS NULL` và chưa hết hạn:
     - Đánh dấu session cũ: `UPDATE refresh_sessions SET revoked_at = NOW(), replaced_by_session_id = $newId WHERE id = $oldId`.
     - Chèn session mới kế thừa cùng `family_id`: `INSERT INTO refresh_sessions (..., family_id, token_hash, expires_at)`.
     - Ký `accessToken` mới. `COMMIT` transaction và cấp cặp cookie mới cho trình duyệt.
7. **Bước 7 (Nhánh Bất Thường - Phát Hiện Replay Attack)**:
   - Giả sử kẻ tấn công đánh cắp được `mc_refresh` cũ và cố gắng gửi request refresh.
   - Khi `authService.refresh()` kiểm tra thấy `oldSession.revoked_at !== null` (nghĩa là token này đã bị thu hồi trong lần xoay vòng trước đó):
     - Hệ thống phát hiện ngay dấu hiệu bị đánh cắp token!
     - Lập tức kích hoạt lệnh tự vệ:
       ```sql
       UPDATE refresh_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL;
       ```
     - Toàn bộ token thuộc `family_id` này lập tức bị hủy bỏ. Kẻ tấn công lẫn nhân viên hợp lệ đều bị đá văng khỏi hệ thống (`HTTP 401 Refresh token reuse detected`), buộc phải đăng nhập lại bằng mật khẩu.

---

### Luồng 2: Gửi Tin Nhắn Text Outgoing (Transactional Outbox + Kafka + Claim Gen + SSE)

Luồng gửi tin nhắn văn bản từ React Dashboard đến Telegram của khách hàng:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Nhân Viên (UI)
    participant ChatAPI as Chat Service API
    participant DB as PostgreSQL
    participant Outbox as Outbox Worker
    participant Kafka as Kafka Broker
    participant TGConsumer as Telegram Send Consumer
    participant TGAPI as Telegram Bot API
    participant ResultConsumer as Result Consumer
    participant SSE as SSE Stream

    Admin->>ChatAPI: POST /api/conversations/:id/messages {content, clientRequestId}
    ChatAPI->>DB: BEGIN Transaction
    ChatAPI->>DB: INSERT messages (status = 'pending')
    ChatAPI->>DB: INSERT outbox_events (topic = 'telegram.message.send', status = 'pending')
    ChatAPI->>DB: COMMIT Transaction
    ChatAPI-->>Admin: HTTP 202 Accepted {id, status: 'pending'}

    Outbox->>DB: Quét outbox_events WHERE status = 'pending'
    Outbox->>Kafka: Publish topic 'telegram.message.send'
    Outbox->>DB: UPDATE outbox_events SET status = 'published'

    Kafka->>TGConsumer: Consume Send Command (attemptGeneration = 1)
    TGConsumer->>DB: Claim Message qua Internal API (INSERT telegram_delivery_attempts status = 'processing')
    alt Claim thành công
        TGConsumer->>TGAPI: Gọi Telegram sendMessage()
        TGAPI-->>TGConsumer: Trả về {message_id: 9988, date: ...}
        TGConsumer->>ChatAPI: POST /internal/messages/delivery-result (status: 'sent')
        ChatAPI->>DB: UPDATE telegram_delivery_attempts SET status = 'sent'
        ChatAPI->>DB: INSERT outbox_events (topic = 'telegram.message.result')
        Outbox->>Kafka: Publish topic 'telegram.message.result'
        Kafka->>ResultConsumer: Consume Delivery Result
        ResultConsumer->>DB: UPDATE messages SET status = 'sent', external_message_id = '9988'
        ResultConsumer->>SSE: Broadcast event 'message_updated'
        SSE-->>Admin: UI tự động cập nhật trạng thái tin nhắn sang 'sent'
    else Claim thất bại (Trùng lặp hoặc thế hệ cũ)
        TGConsumer->>TGConsumer: Bỏ qua (Duplicate or Stale Command)
    end
```

#### Diễn Giải Chi Tiết Từng Bước Trong Code:
1. **Bước 1 (Gửi Request)**: Nhân viên gõ "Chào bạn" và bấm Gửi. Frontend sinh `clientRequestId = crypto.randomUUID()` và gửi `POST /api/conversations/:id/messages`.
2. **Bước 2 (Lưu Pending & Outbox Event Atomic)**:
   - `messageService.sendMessage()` mở Transaction DB.
   - Chèn vào bảng `messages` với `status = 'pending'`, gán `client_request_id`. Nếu trùng `client_request_id`, DB trả về trùng lặp và không ghi Outbox.
   - Chèn vào bảng `outbox_events` với `topic = 'telegram.message.send'`, payload `{ messageId, conversationId, attemptGeneration: 1 }`.
   - `COMMIT` transaction. Trả về ngay **HTTP 202 Accepted**. Giao diện React hiển thị tin nhắn với icon đồng hồ cát (Pending).
3. **Bước 3 (Outbox Worker Quét & Publish)**:
   - `outbox.worker.js` quét định kỳ mỗi 500ms các bản ghi `status = 'pending'`.
   - Gọi Kafka Producer gửi lên topic `telegram.message.send`, partition key là `conversation_id` (đảm bảo thứ tự gửi của hội thoại).
   - Khi Kafka ACK, cập nhật `outbox_events SET status = 'published'`.
4. **Bước 4 (Telegram Consumer Nhận Lệnh & Claim Quyền)**:
   - `send.consumer.js` của Telegram Service nhận command từ Kafka.
   - Gọi Internal API Chat Service `POST /internal/messages/:id/claim-send` với `attemptGeneration = 1`.
   - Chat Service thực thi câu lệnh SQL:
     ```sql
     INSERT INTO telegram_delivery_attempts (message_id, status, attempt_generation)
     VALUES ($1, 'processing', 1)
     ON CONFLICT (message_id) DO NOTHING;
     ```
   - Nhờ ràng buộc khóa chính `message_id`, **chỉ duy nhất 1 worker claim thành công**. Nếu worker khác nhận trùng message từ Kafka, `rowCount = 0` $\rightarrow$ Trả về `claimed: false` $\rightarrow$ Worker bỏ qua an toàn.
5. **Bước 5 (Gọi Telegram API)**:
   - Telegram Service lấy thông tin bot từ `botManagerService`, gọi Telegraf `bot.telegram.sendMessage(externalChatId, content)`.
   - Máy chủ Telegram trả về `{ message_id: 9988, date: 1731139200 }`.
6. **Bước 6 (Ghi Nhận Kết Quả Gửi Thành Công)**:
   - Telegram Service gọi `POST /internal/messages/delivery-result` gửi payload `{ messageId, attemptGeneration: 1, status: 'sent', externalMessageId: '9988', sentAt }`.
   - Chat Service mở Transaction: Cập nhật `telegram_delivery_attempts SET status = 'sent'` và chèn sự kiện vào `outbox_events` với `topic = 'telegram.message.result'`.
7. **Bước 7 (Result Consumer & Cập Nhật Giao Diện Real-time Qua SSE)**:
   - Outbox Worker đẩy sự kiện sang topic `telegram.message.result`.
   - `result.consumer.js` nhận kết quả, gọi `applyDeliveryResult()`: Cập nhật `messages SET status = 'sent', external_message_id = '9988'`.
   - Gọi `sseService.broadcast('message_updated', { messageId, status: 'sent' })`.
   - Trình duyệt nhân viên nhận được SSE stream, component `MessageList` tự động đổi badge từ "Pending" sang tích xanh "Sent" ngay lập tức.

---

### Luồng 3: Gửi Ảnh & Tài Liệu Outgoing (Reference Pattern + Binary Stream + Dọn Dẹp Orphan)

Tại sao không đẩy trực tiếp file nhị phân (Buffer) vào Kafka? Vì Kafka không tối ưu cho payload kích thước lớn (gây nghẽn IO mạng broker, phình bộ nhớ RAM JVM). Hệ thống áp dụng mô hình **Reference/Pointer Pattern**:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Nhân Viên
    participant ChatAPI as Chat Service
    participant Disk as Local Storage
    participant DB as PostgreSQL
    participant Kafka as Kafka
    participant TG as Telegram Service
    participant Bot as Telegram Bot API

    Admin->>ChatAPI: POST /api/conversations/:id/attachments (Multipart)
    ChatAPI->>Disk: Lưu file vật lý
    ChatAPI->>DB: BEGIN Transaction
    ChatAPI->>DB: INSERT messages (pending)
    ChatAPI->>DB: INSERT message_attachments (storage_key)
    ChatAPI->>DB: INSERT outbox_events (chỉ chứa metadata & attachmentId)
    ChatAPI->>DB: COMMIT
    ChatAPI-->>Admin: HTTP 202 Accepted

    Kafka->>TG: Consume Command (attachmentId, messageType = 'image')
    TG->>ChatAPI: POST /internal/messages/:id/claim-send
    ChatAPI-->>TG: Claimed = true (kèm metadata file)
    TG->>ChatAPI: GET /internal/messages/:id/attachments/:attachmentId
    ChatAPI->>Disk: Đọc tệp stream
    ChatAPI-->>TG: Truyền nhị phân (binary stream)
    TG->>Bot: Gửi telegram.sendPhoto({source: buffer})
    Bot-->>TG: Thành công {message_id: 5544}
    TG->>ChatAPI: Ghi nhận kết quả gửi -> Đồng bộ SSE lên Dashboard
```

#### Diễn Giải Chi Tiết Từng Bước Trong Code:
1. **Bước 1 (Upload File)**: Nhân viên chọn file ảnh `bao_gia.png` (2MB) và bấm Gửi. Trình duyệt gửi form `multipart/form-data` đến `POST /api/conversations/:id/attachments`.
2. **Bước 2 (Lưu File Ổ Cứng & Dọn Dẹp File Rác Khi Rollback)**:
   - Multer nạp file vào RAM tạm thời.
   - `messageService.sendAttachment()` kiểm tra MIME type. Gọi `attachmentService.saveFile(file)`.
   - File được ghi xuống đĩa cứng tại `storage/attachments/2026/11/<uuid>.png`.
   - Mở Transaction DB:
     - Chèn vào `messages` (`message_type = 'image'`, `status = 'pending'`).
     - Chèn vào `message_attachments` (`storage_key = '2026/11/<uuid>.png'`, dung lượng, checksum SHA-256).
     - Chèn vào `outbox_events` (`topic = 'telegram.message.send'`, payload chỉ chứa `{ messageId, conversationId, messageType: 'image', attachmentId }`).
   - **Xử lý Rollback**: Nếu database gặp lỗi (ví dụ disk đầy hoặc mất kết nối DB), khối `catch` gọi `attachmentService.deleteFile(savedFile.absolutePath)` để xóa ngay file vừa ghi xuống đĩa, tránh rác ổ cứng.
   - Trả về **HTTP 202 Accepted**.
3. **Bước 3 (Kafka & Claim Quyền)**:
   - Outbox Worker đẩy metadata lên Kafka topic `telegram.message.send`.
   - `send.consumer.js` của Telegram Service nhận message. Gọi `claimTelegramMessage`.
   - Nhờ câu lệnh `LEFT JOIN LATERAL` trong repository của Chat Service, kết quả claim trả về kèm theo thông tin `attachment_id`, `file_name`, `mime_type`.
4. **Bước 4 (Stream File Nhị Phân Nội Bộ)**:
   - Telegram Service gọi `GET /internal/messages/:id/attachments/:attachmentId` kèm header bí mật `x-internal-api-key`.
   - Chat Service mở ReadStream đọc file từ đĩa cứng và truyền nhị phân (binary stream) sang Telegram Service.
5. **Bước 5 (Gửi Lên Telegram API)**:
   - Telegram Service chuyển Buffer vào Telegraf qua `Input.fromBuffer(buffer, fileName)`.
   - Nếu là ảnh: Gọi `bot.telegram.sendPhoto()`.
   - Nếu là tài liệu (PDF/DOCX): Gọi `bot.telegram.sendDocument()`.
6. **Bước 6 (Hoàn Tất & Đồng Bộ Real-time)**:
   - Telegram phản hồi thành công `message_id`.
   - Kết quả được ghi nhận qua `recordTelegramResult` $\rightarrow$ Outbox `telegram.message.result` $\rightarrow$ Result Consumer cập nhật DB $\rightarrow$ SSE broadcast cập nhật giao diện Dashboard hiển thị ảnh đã gửi thành công.

---

### Luồng 4: State Machine Xử Lý Lỗi, Retry Delay (HTTP 429) & Claim Thế Hệ (Attempt Generation)

Khi Telegram Bot API gặp lỗi hoặc quá tải (HTTP 429 Too Many Requests), hệ thống kích hoạt cơ chế Retry có kiểm soát:

```mermaid
stateDiagram-v2
    [*] --> Processing: Claim Generation 1 thành công
    Processing --> Sent: Telegram gửi thành công (200 OK)
    Processing --> Failed: Telegram từ chối vĩnh viễn (400, 403 Bot Blocked)
    Processing --> RetryWaiting: Telegram trả về HTTP 429 (Rate Limit)

    state RetryWaiting {
        [*] --> InDelay: retry_count++, tính next_retry_at
        InDelay --> Scheduled: Hết thời gian delay (next_retry_at <= NOW)
    }

    Scheduled --> OutboxGenNext: Retry Scheduler tạo Outbox Generation 2\n(queued_retry_generation = 2)
    OutboxGenNext --> Processing: Consumer Claim Retry Generation 2\n(Xóa queued_retry_generation)

    Processing --> Failed: Số lần retry >= MAX_RETRIES (3 lần)
    Processing --> Unknown: Timeout kết nối mạng / Crash không rõ kết quả
```

#### Diễn Giải Chi Tiết Cơ Chế Chống Race Condition & Stale Result:
1. **Bước 1 (Gặp Lỗi 429 Rate Limit)**:
   - Worker gửi tin lên Telegram nhưng nhận về lỗi HTTP 429 (Too Many Requests), kèm thông số `parameters.retry_after = 5`.
   - Hàm `classifyTelegramError(error)` phân loại đây là lỗi `retryable`, trích xuất `retryAfterSeconds = 5`.
2. **Bước 2 (Chuyển Trạng Thái `retry_waiting`)**:
   - Worker gọi `recordTelegramResult` với status `retry_waiting`.
   - `deliveryResultRepository.saveDeliveryResultWithOutbox()` khóa attempt `FOR UPDATE`.
   - Kiểm tra `attempt.retry_count < 3`.
   - Cập nhật database:
     ```sql
     UPDATE telegram_delivery_attempts
     SET status = 'retry_waiting',
         retry_count = retry_count + 1,
         next_retry_at = NOW() + (5 * INTERVAL '1 second'),
         queued_retry_generation = NULL,
         last_error = 'Rate limited',
         last_error_code = 'RATE_LIMIT'
     WHERE message_id = $1;
     ```
3. **Bước 3 (Retry Scheduler Quét & Lên Lịch Thế Hệ Mới)**:
   - `retry.worker.js` chạy ngầm mỗi 3 giây gọi `retryRepository.scheduleDueRetries()`.
   - Câu lệnh SQL quét các bản ghi:
     ```sql
     WHERE status = 'retry_waiting'
       AND next_retry_at <= NOW()
       AND queued_retry_generation IS NULL
     FOR UPDATE SKIP LOCKED;
     ```
   - Khi đã qua 5 giây (`next_retry_at <= NOW()`):
     - Scheduler tính thế hệ tiếp theo: `nextGeneration = attempt_generation + 1` (ví dụ từ 1 lên 2).
     - Ghi sự kiện mới vào `outbox_events` với `attemptGeneration = 2`.
     - Đánh dấu `queued_retry_generation = 2`. Nhờ cột này, các lần quét tiếp theo của scheduler sẽ **không bao giờ sinh thêm Outbox trùng lặp**.
4. **Bước 4 (Claim Retry Thế Hệ Mới)**:
   - Outbox Worker đẩy sự kiện Generation 2 sang Kafka.
   - Telegram Consumer nhận lệnh Gen 2, gọi `claimRetryMessage({ messageId, attemptGeneration: 2 })`.
   - Chat Service cập nhật:
     ```sql
     UPDATE telegram_delivery_attempts
     SET status = 'processing',
         attempt_generation = 2,
         queued_retry_generation = NULL,
         started_at = NOW()
     WHERE message_id = $1
       AND status = 'retry_waiting'
       AND queued_retry_generation = 2
       AND attempt_generation = 1;
     ```
   - Claim thành công $\rightarrow$ Thực hiện gửi lại Telegram lần 2.
5. **Ý Nghĩa Trọng Yếu Của Cơ Chế Chống Kết Quả Trễ (Stale Result Prevention)**:
   - Giả sử Lần 1 gửi bị treo mạng tưởng là hỏng. Scheduler đã chuyển sang Generation 2.
   - Bất ngờ, phản hồi trễ của Lần 1 bay về với `attemptGeneration = 1`.
   - Chat Service kiểm tra: `attempt.attempt_generation (đang là 2) !== data.attemptGeneration (là 1)`.
   - Hệ thống lập tức từ chối và ném lỗi **HTTP 409 Stale attempt generation** $\rightarrow$ Loại bỏ hoàn toàn nguy cơ gói tin trễ làm hỏng trạng thái của lượt gửi mới!
6. **Bước 6 (Vượt Quá Giới Hạn Max Retries)**:
   - Nếu tin nhắn đã thử lại đủ 3 lần (`retry_count >= 3`) mà vẫn gặp lỗi, `deliveryResultRepository` tự động đánh dấu attempt thành `failed`, sinh Outbox `telegram.message.result` để chuyển `messages.status = 'failed'` và thông báo SSE icon cảnh báo đỏ cho nhân viên.

---

### Luồng 5: Tiếp Nhận Tin Nhắn Đến (Telegram Webhook $\rightarrow$ Kafka Incoming $\rightarrow$ Deduplication $\rightarrow$ SSE)

Luồng tiếp nhận tin nhắn khi khách hàng gửi từ ứng dụng Telegram về hệ thống:

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Khách Hàng
    participant TGServer as Telegram Server
    participant TGService as Telegram Service
    participant Kafka as Kafka Broker
    participant InConsumer as Chat Incoming Consumer
    participant ChatAPI as Chat Internal API
    participant DB as PostgreSQL
    participant SSE as SSE Stream
    participant UI as React Dashboard

    Customer->>TGServer: Gửi "Xin chào shop!"
    TGServer->>TGService: POST /webhook/:botId (X-Telegram-Bot-Api-Secret-Token)
    TGService->>TGService: Xác thực Secret Token hợp lệ
    TGService->>Kafka: Publish topic 'telegram.message.incoming'\n(key: botId:chatId, acks: -1)
    Kafka-->>TGService: Broker ACK (Đã ghi bền vững)
    TGService-->>TGServer: HTTP 200 OK

    Kafka->>InConsumer: Consume Inbound Event
    InConsumer->>ChatAPI: POST /internal/messages/incoming
    ChatAPI->>DB: BEGIN Transaction
    ChatAPI->>DB: INSERT webhook_events ON CONFLICT (channel_account_id, external_event_id) DO NOTHING
    alt Sự kiện chưa từng xử lý
        ChatAPI->>DB: UPSERT conversations (external_chat_id)
        ChatAPI->>DB: INSERT messages (direction = 'incoming', status = 'sent')
        ChatAPI->>DB: COMMIT Transaction
        ChatAPI->>SSE: Broadcast event 'new_message'
        SSE-->>UI: Tin nhắn khách hàng xuất hiện ngay trên màn hình chat
        InConsumer->>Kafka: Commit Offset (Thủ công)
    else Sự kiện trùng lặp (Duplicate Webhook)
        ChatAPI->>DB: ROLLBACK / Bỏ qua
        InConsumer->>Kafka: Commit Offset
    end
```

#### Diễn Giải Chi Tiết Từng Bước Trong Code:
1. **Bước 1 (Khách Nhắn Tin)**: Khách hàng mở Telegram nhắn "Cho mình xin giá sản phẩm". Máy chủ Telegram gửi HTTP POST Webhook tới `http://localhost:3003/webhook/<botId>` kèm header `X-Telegram-Bot-Api-Secret-Token`.
2. **Bước 2 (Xác Thực Secret & Bắn Kafka Incoming)**:
   - `webhook.controller.js` so khớp Secret Token bằng `secretsMatch` chống Timing Attack.
   - Trích xuất thông tin: `externalChatId`, `externalMessageId`, `text`, `senderName`.
   - Gọi `incomingProducer.publishIncomingMessage()` đẩy vào Kafka topic `telegram.message.incoming`. Partition key là `${externalAccountId}:${externalChatId}` để đảm bảo toàn bộ tin nhắn của khách hàng này đi vào cùng 1 partition theo đúng trình tự.
   - Cấu hình `acks: -1` yêu cầu toàn bộ replica Kafka ghi nhận.
   - **Chỉ sau khi Kafka ACK, Telegram Service mới trả về HTTP 200 OK cho Telegram Server**. Nếu hệ thống bị crash giữa chừng, Telegram Server sẽ tự động gửi lại webhook sau vài phút.
3. **Bước 3 (Incoming Consumer Tiếp Nhận)**:
   - `incoming.consumer.js` nhận message từ Kafka.
   - Gọi `POST /internal/messages/incoming` sang Chat Service.
4. **Bước 4 (Deduplicate Bằng Bảng `webhook_events`)**:
   - Chat Service mở Transaction DB.
   - Thực thi câu lệnh kiểm tra trùng:
     ```sql
     INSERT INTO webhook_events (channel_account_id, external_event_id, payload, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (channel_account_id, external_event_id) DO NOTHING;
     ```
   - Nhờ ràng buộc `UNIQUE (channel_account_id, external_event_id)`, nếu Telegram gửi lặp lại cùng một `update_id`, `rowCount` trả về 0 $\rightarrow$ Chat Service phát hiện sự kiện trùng lặp, bỏ qua và không tạo thêm tin nhắn rác.
5. **Bước 5 (UPSERT Conversation & Lưu Tin Nhắn Incoming)**:
   - Nếu sự kiện là mới:
     - Tìm hoặc tạo mới hội thoại: `INSERT INTO conversations (channel_account_id, external_chat_id, display_name) VALUES (...) ON CONFLICT (channel_account_id, external_chat_id) DO UPDATE SET display_name = EXCLUDED.display_name, last_message_at = NOW() RETURNING id`.
     - Chèn vào bảng `messages` với `direction = 'incoming'`, `status = 'sent'`, gán `external_message_id = $telegramMsgId`.
     - Cập nhật `webhook_events SET status = 'processed', processed_at = NOW()`.
     - `COMMIT` Transaction.
6. **Bước 6 (SSE Broadcast Lên React Dashboard)**:
   - Chat Service gọi `sseService.broadcast('new_message', { conversationId, messageId, direction: 'incoming' })`.
   - Kết nối SSE gửi dữ liệu xuống trình duyệt của nhân viên trực chat.
   - Component `App.jsx` và `useChatEvents.js` nhận được sự kiện:
     - Nếu nhân viên đang mở đúng cuộc chat đó: Tin nhắn mới lập tức xuất hiện ở cuối khung chat kèm âm báo.
     - Nếu nhân viên đang mở cuộc chat khác: `ConversationList` tự động nhảy hội thoại này lên đầu danh sách kèm badge thông báo tin nhắn chưa đọc.
   - Incoming Consumer hoàn tất commit offset lên Kafka.

---

## 5. CẨM NANG VẬN HÀNH, CHẠY SERVICE & KIỂM THỬ TOÀN DIỆN

### 5.1. Bảng Biến Môi Trường (.env)

#### Auth Service (`service/auth_service/.env`):
```env
PORT=3001
DATABASE_URL=postgresql://postgres:password@localhost:5432/micro_chat_db
JWT_ACCESS_SECRET=your_jwt_access_secret_key_123456
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key_654321
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

#### Chat Service (`service/chat_service/.env`):
```env
PORT=3002
DATABASE_URL=postgresql://postgres:password@localhost:5432/micro_chat_db
JWT_ACCESS_SECRET=your_jwt_access_secret_key_123456
INTERNAL_API_KEY=internal_secret_chat_telegram_secure_key_2026
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
KAFKA_BROKERS=localhost:9092
CHAT_SERVICE_URL=http://127.0.0.1:3002
```

#### Telegram Service (`service/telegram_service/.env`):
```env
PORT=3003
INTERNAL_API_KEY=internal_secret_chat_telegram_secure_key_2026
CHAT_SERVICE_URL=http://127.0.0.1:3002
KAFKA_BROKERS=localhost:9092
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
WEBHOOK_SECRET=your_telegram_webhook_secret
```

---

### 5.2. Thứ Tự Khởi Động Hệ Thống Chuẩn

Để toàn bộ hệ thống hoạt động chính xác, khởi chạy các tiến trình theo thứ tự sau:

| Bước | Tiến Trình | Thư Mục / Lệnh Chạy | Ghi Chú |
| :--- | :--- | :--- | :--- |
| **1** | **Kafka & PostgreSQL** | `docker start mtd-kafka` | Khởi động Docker container Kafka và PostgreSQL port 5432 |
| **2** | **Auth Service** | `cd service/auth_service && npm start` | Cung cấp API đăng nhập, xác thực Session (Port 3001) |
| **3** | **Chat Service API** | `cd service/chat_service && npm start` | Cung cấp REST API & Internal API (Port 3002) |
| **4** | **Telegram Service API** | `cd service/telegram_service && npm start` | Nhận Webhook và tương tác Telegram API (Port 3003) |
| **5** | **Chat Outbox Worker** | `cd service/chat_service && npm run kafka:outbox` | Quét bảng `outbox_events` đẩy sang Kafka |
| **6** | **Telegram Send Consumer** | `cd service/telegram_service && npm run kafka:consumer` | Tiếp nhận command từ Kafka, claim và gửi tin Telegram |
| **7** | **Chat Result Consumer** | `cd service/chat_service && npm run kafka:result` | Nhận kết quả từ Kafka, cập nhật DB và phát SSE |
| **8** | **Chat Retry Worker** | `cd service/chat_service && npm run kafka:retry` | Quét attempt `retry_waiting` đến hạn để sinh outbox mới |
| **9** | **Chat Incoming Consumer**| `cd service/chat_service && npm run kafka:incoming` | Nhận tin khách hàng từ Kafka lưu vào DB và phát SSE |
| **10**| **React Dashboard** | `cd frontend/chat-dashboard && npm run dev` | Giao diện tổng đài chat (Port 5173) |

---

### 5.3. Các Lệnh Script Kiểm Thử Đã Tích Hợp Sẵn

Trong thư mục [`scripts/`](file:///d:/micro_noti_service/scripts/) và `scratch/`, các kịch bản kiểm thử tự động đã được tích hợp sẵn:

* **Kiểm tra Xác thực & RBAC Toàn Diện (40/40 tests)**:
  ```bash
  node scripts/test-auth.js
  ```
  *Kiểm tra login, token rotation, replay attack detection, thu hồi family session, origin middleware, SSE token auth và RBAC chặn quyền.*

* **Kiểm tra Attempt Generation, Retry Scheduler & Outbox**:
  ```bash
  node scratch/test_attempt_generation.js
  ```
  *Kiểm tra trọn vẹn vòng đời: Generation 1 $\rightarrow$ Lỗi 429 Rate limit $\rightarrow$ Scheduler tạo Gen 2 $\rightarrow$ Claim Gen 2 $\rightarrow$ Từ chối gói tin trễ Gen 1 $\rightarrow$ Xử lý quá 3 lần retry chuyển `failed`.*

* **Kiểm tra Outgoing Kafka Cho File Ảnh & Tài Liệu**:
  ```bash
  node scratch/test_kafka_attachments.js
  ```
  *Kiểm tra tạo pending message kèm attachment metadata trong Outbox $\rightarrow$ Claim kèm attachment $\rightarrow$ Stream file nội bộ qua Internal API.*

* **Kiểm tra Incoming Webhook Đẩy Vào Kafka**:
  ```bash
  node scratch/test_kafka_incoming.js
  ```
  *Kiểm tra Producer bắn tin inbound vào Kafka topic $\rightarrow$ Consumer chuyển tiếp vào `/internal/messages/incoming` $\rightarrow$ Lưu DB và deduplicate chống trùng.*

---

### 5.4. Các Câu Lệnh SQL Giám Sát Vận Hành (DBA / Technical Support)

#### 1. Kiểm tra 20 tin nhắn gửi đi gần nhất kèm trạng thái Outbox và Telegram Attempt:
```sql
SELECT 
    m.id AS message_id,
    m.message_type,
    m.content,
    m.status AS message_status,
    a.status AS attempt_status,
    a.attempt_generation,
    a.retry_count,
    a.next_retry_at,
    a.external_message_id,
    a.last_error,
    m.created_at
FROM messages m
LEFT JOIN telegram_delivery_attempts a ON a.message_id = m.id
WHERE m.direction = 'outgoing'
ORDER BY m.created_at DESC
LIMIT 20;
```

#### 2. Kiểm tra tiến độ xử lý hàng đợi Outbox Events:
```sql
SELECT 
    topic,
    status,
    COUNT(*) AS total_events,
    MIN(created_at) AS oldest_event
FROM outbox_events
GROUP BY topic, status;
```

#### 3. Kiểm tra các tin nhắn đang chờ Retry (Rate Limit):
```sql
SELECT 
    message_id,
    attempt_generation,
    queued_retry_generation,
    retry_count,
    next_retry_at,
    NOW() AS current_time,
    next_retry_at - NOW() AS time_remaining,
    last_error
FROM telegram_delivery_attempts
WHERE status = 'retry_waiting'
ORDER BY next_retry_at ASC;
```

#### 4. Kiểm tra tin nhắn khách hàng gửi đến và trạng thái Webhook Event:
```sql
SELECT 
    w.external_event_id,
    w.status AS webhook_status,
    m.id AS message_id,
    m.content,
    c.display_name AS customer_name,
    m.created_at
FROM webhook_events w
JOIN channel_accounts ca ON ca.id = w.channel_account_id
JOIN conversations c ON c.channel_account_id = ca.id
JOIN messages m ON m.conversation_id = c.id
WHERE m.direction = 'incoming'
ORDER BY m.created_at DESC
LIMIT 20;
```
