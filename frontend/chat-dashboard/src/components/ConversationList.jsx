const ConversationList = ({
    conversations,
    selectedId,
    onSelect,
    loading,
    pagination,
    onPageChange,
    botAccounts = [],
    selectedBotId = "",
    onSelectBot
}) => {
    return (
        <aside className="conversation-sidebar">
            <div className="sidebar-header">
                <div>
                    <h2>Cuộc trò chuyện</h2>
                    <p>{pagination.total} cuộc trò chuyện</p>
                </div>
            </div>

            {/* Bộ lọc theo Bot */}
            {botAccounts && botAccounts.length > 0 && (
                <div className="bot-filter-bar">
                    <label htmlFor="bot-select" className="bot-filter-label">Kênh Bot:</label>
                    <select
                        id="bot-select"
                        value={selectedBotId || ""}
                        onChange={(e) => onSelectBot && onSelectBot(e.target.value || null)}
                        className="bot-filter-select"
                    >
                        <option value="">Tất cả Bot</option>
                        {botAccounts.map((bot) => (
                            <option key={bot.id} value={bot.id}>
                                🤖 {bot.botName || bot.botUsername || bot.botId}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="conversation-list">
                {loading && (
                    <p className="empty-state">
                        Đang tải danh sách...
                    </p>
                )}

                {!loading && conversations.length === 0 && (
                    <p className="empty-state">
                        Chưa có cuộc trò chuyện nào.
                    </p>
                )}

                {!loading && conversations.map((conversation) => (
                    <button
                        type="button"
                        key={conversation.id}
                        className={
                            "conversation-item " +
                            (selectedId === conversation.id
                                ? "selected"
                                : "")
                        }
                        onClick={() => onSelect(conversation.id)}
                    >
                        <div className="conversation-avatar">
                            {(conversation.displayName ||
                                conversation.display_name ||
                                conversation.external_chat_id ||
                                "?")
                                .charAt(0)
                                .toUpperCase()}
                        </div>

                        <div className="conversation-info">
                            <div className="conversation-title-row">
                                <strong className="customer-name">
                                    {conversation.displayName ||
                                        conversation.display_name ||
                                        conversation.external_chat_id}
                                </strong>
                                {conversation.botName && (
                                    <span
                                        className="bot-badge"
                                        title={`Phụ trách bởi: ${conversation.botName}${conversation.botUsername ? ` (@${conversation.botUsername})` : ""}`}
                                    >
                                        🤖 {conversation.botName}
                                    </span>
                                )}
                            </div>

                            <span className="channel-label">
                                {conversation.channelCode || conversation.channel_code}
                            </span>

                            <p className="conversation-last-msg">
                                {conversation.last_message_content ||
                                    conversation.last_message ||
                                    "Chưa có nội dung"}
                            </p>
                        </div>
                    </button>
                ))}
            </div>

            <div className="pagination-bar">
                <button
                    type="button"
                    disabled={
                        loading ||
                        !pagination.hasPreviousPage
                    }
                    onClick={() =>
                        onPageChange(pagination.page - 1)
                    }
                >
                    Trước
                </button>

                <span>
                    {pagination.page} / {pagination.totalPages || 1}
                </span>

                <button
                    type="button"
                    disabled={
                        loading ||
                        !pagination.hasNextPage
                    }
                    onClick={() =>
                        onPageChange(pagination.page + 1)
                    }
                >
                    Sau
                </button>
            </div>
        </aside>
    );
};

export default ConversationList;
