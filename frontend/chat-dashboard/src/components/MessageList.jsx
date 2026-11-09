import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from "react";

import {
    getConversationMessages
} from "../api/conversation.api";
import MessageAttachment from "./MessageAttachment";

const MESSAGE_LIMIT = 20;

const MessageList = ({ conversationId, refreshKey }) => {
    const [messages, setMessages] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);

    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");

    const scrollRef = useRef(null);
    const snapshotRef = useRef(null);
    const initializedRef = useRef(false);
    const olderRequestRef = useRef(null);
    const loadingMoreRef = useRef(false);
    const activeConversationIdRef = useRef(conversationId);

    // Khi chuyển sang cuộc hội thoại khác: xóa sạch tin nhắn cũ ngay lập tức
    useEffect(() => {
        activeConversationIdRef.current = conversationId;
        setMessages([]);
        setCursor(null);
        setHasMore(false);
        setError("");
        initializedRef.current = false;
        olderRequestRef.current?.abort();
    }, [conversationId]);

    // Tải 20 tin mới nhất của cuộc hội thoại hiện tại
    useEffect(() => {
        activeConversationIdRef.current = conversationId;
        const controller = new AbortController();

        const loadInitialMessages = async () => {
            try {
                setLoading(true);
                setError("");

                const result = await getConversationMessages(
                    conversationId,
                    MESSAGE_LIMIT,
                    null,
                    controller.signal
                );

                // Nếu request đã bị hủy hoặc người dùng đã chuyển sang cuộc hội thoại khác: bỏ qua
                if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) {
                    return;
                }

                // Lọc chắc chắn chỉ hiển thị tin nhắn thuộc đúng conversationId hiện tại
                const currentMessages = Array.isArray(result?.data)
                    ? result.data.filter((m) => !m.conversation_id || m.conversation_id === conversationId)
                    : [];

                setMessages(currentMessages);
                setCursor(result.pagination?.nextCursor || null);
                setHasMore(Boolean(result.pagination?.hasMore));

            } catch (err) {
                if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) {
                    return;
                }

                console.error(err);
                setError("Không thể tải tin nhắn.");
            } finally {
                if (!controller.signal.aborted && activeConversationIdRef.current === conversationId) {
                    setLoading(false);
                }
            }
        };

        loadInitialMessages();

        return () => {
            controller.abort();
            olderRequestRef.current?.abort();
        };
    }, [conversationId, refreshKey]);

    // Giữ vị trí cuộn sau khi thêm tin cũ hoặc lần đầu mở hội thoại
    useLayoutEffect(() => {
        const container = scrollRef.current;
        if (!container || loading) return;

        if (snapshotRef.current) {
            const snapshot = snapshotRef.current;

            container.scrollTop =
                snapshot.top +
                container.scrollHeight -
                snapshot.height;

            snapshotRef.current = null;
            return;
        }

        // Lần đầu mở conversation: cuộn xuống cuối
        if (!initializedRef.current) {
            container.scrollTop = container.scrollHeight;
            initializedRef.current = true;
        }
    }, [messages, loading]);

    const handleLoadMore = async () => {
        if (
            !hasMore ||
            !cursor ||
            loadingMoreRef.current ||
            loading
        ) {
            return;
        }

        const container = scrollRef.current;

        if (container) {
            snapshotRef.current = {
                top: container.scrollTop,
                height: container.scrollHeight
            };
        }

        const controller = new AbortController();
        olderRequestRef.current = controller;
        loadingMoreRef.current = true;

        setLoadingMore(true);
        setError("");

        try {
            const result = await getConversationMessages(
                conversationId,
                MESSAGE_LIMIT,
                cursor,
                controller.signal
            );

            if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) {
                return;
            }

            setMessages((previous) => {
                const existingIds = new Set(
                    previous.map((m) => m.id)
                );

                const older = (result.data || []).filter(
                    (m) => !existingIds.has(m.id) && (!m.conversation_id || m.conversation_id === conversationId)
                );

                return [...older, ...previous];
            });

            setCursor(result.pagination?.nextCursor || null);
            setHasMore(Boolean(result.pagination?.hasMore));

        } catch (err) {
            if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) {
                return;
            }

            console.error(err);
            snapshotRef.current = null;
            setError("Không thể tải tin nhắn cũ hơn.");
        } finally {
            loadingMoreRef.current = false;
            olderRequestRef.current = null;

            if (!controller.signal.aborted && activeConversationIdRef.current === conversationId) {
                setLoadingMore(false);
            }
        }
    };

    const formatTime = (value) => {
        if (!value) return "";

        return new Date(value).toLocaleString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit"
        });
    };

    return (
        <div className="messages-container" ref={scrollRef}>
            {loading && (
                <div className="message-state">
                    Đang tải tin nhắn...
                </div>
            )}

            {!loading && (
                <>
                    {error && (
                        <p className="message-error">{error}</p>
                    )}

                    {hasMore && (
                        <button
                            type="button"
                            className="load-more-button"
                            disabled={loadingMore}
                            onClick={handleLoadMore}
                        >
                            {loadingMore
                                ? "Đang tải..."
                                : "Tải tin nhắn cũ hơn"}
                        </button>
                    )}

                    {!hasMore && messages.length > 0 && (
                        <p className="history-start">
                            Đã đến đầu lịch sử được lưu
                        </p>
                    )}

                    {messages.length === 0 && !error && (
                        <p className="message-state">
                            Chưa có tin nhắn nào.
                        </p>
                    )}

                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={
                                "message-row " +
                                (message.direction === "outgoing"
                                    ? "outgoing"
                                    : "incoming")
                            }
                        >
                            <div className="message-bubble">
                                {/* 1. Hiển thị attachments (ảnh hoặc tệp đính kèm) */}
                                {message.attachments && message.attachments.length > 0 && (
                                    <div className="message-attachments-group">
                                        {message.attachments.map((attachment) => (
                                            <MessageAttachment
                                                key={attachment.id}
                                                attachment={attachment}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* 2. Nội dung văn bản hoặc chú thích (caption) */}
                                {message.content && (
                                    <p className="message-text">
                                        {message.content}
                                    </p>
                                )}

                                {/* 3. Fallback khi không có content lẫn attachment */}
                                {!message.content && (!message.attachments || message.attachments.length === 0) && (
                                    <p className="message-text">
                                        [{message.message_type}]
                                    </p>
                                )}

                                <div className="message-meta">
                                    <span>
                                        {formatTime(
                                            message.sent_at ||
                                            message.created_at
                                        )}
                                    </span>

                                    {message.direction === "outgoing" && (
                                        <span>{message.status}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

export default MessageList;
