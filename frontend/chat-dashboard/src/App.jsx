import { useCallback, useEffect, useState } from "react";

import ConversationList from "./components/ConversationList";
import MessageList from "./components/MessageList";
import MessageInput from "./components/MessageInput";

import { getConversations, getChannelAccounts } from "./api/conversation.api";
import { useChatEvents } from "./hooks/useChatEvents";

import "./App.css";

const CONVERSATION_LIMIT = 10;

const App = ({ currentUser, onLogout, sessionVersion }) => {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState(1);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [botAccounts, setBotAccounts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [messageRefreshKey, setMessageRefreshKey] = useState(0);
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0);

  const [pagination, setPagination] = useState({
    page: 1,
    limit: CONVERSATION_LIMIT,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false
  });

  const handleNewMessage = useCallback((event) => {
    setConversationRefreshKey((value) => value + 1);
    setMessageRefreshKey((value) => value + 1);
  }, []);

  const handleMessageUpdated = useCallback((event) => {
    setMessageRefreshKey((value) => value + 1);
  }, []);

  useChatEvents(handleNewMessage, sessionVersion, handleMessageUpdated);

  // Tải danh sách các bot accounts để lọc
  useEffect(() => {
    const controller = new AbortController();
    getChannelAccounts(controller.signal)
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setBotAccounts(res.data);
        }
      })
      .catch(() => { });

    return () => controller.abort();
  }, [conversationRefreshKey]);

  // Tải danh sách cuộc trò chuyện theo trang và theo bot
  useEffect(() => {
    const controller = new AbortController();

    const loadConversations = async () => {
      try {
        setLoading(true);
        setError("");

        const result = await getConversations(
          page,
          CONVERSATION_LIMIT,
          controller.signal,
          selectedBotId
        );

        if (controller.signal.aborted) return;

        setConversations(result.data);
        setPagination(result.pagination);

        setSelectedId((previous) => {
          const stillExists = result.data.some(
            (c) => c.id === previous
          );

          return stillExists
            ? previous
            : result.data[0]?.id || null;
        });

      } catch (err) {
        if (controller.signal.aborted) return;

        console.error(err);
        setError(
          "Không thể tải danh sách cuộc trò chuyện."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadConversations();

    return () => controller.abort();
  }, [page, conversationRefreshKey, selectedBotId]);

  const selectedConversation = conversations.find(
    (c) => c.id === selectedId
  );

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="brand">
          <div className="brand-icon">M</div>
          <div>
            <h1>Multi-Channel Chat</h1>
            <p>Customer Support Dashboard</p>
          </div>
        </div>

        <div className="user-section">
          {currentUser && (
            <div className="user-badge">
              <span className="user-name">
                {currentUser.fullName || currentUser.username}
              </span>
              <span className={`role-badge role-${currentUser.role?.toLowerCase()}`}>
                {currentUser.role}
              </span>
            </div>
          )}

          <button
            type="button"
            className="logout-button"
            onClick={onLogout}
            title="Đăng xuất khỏi hệ thống"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      <main className="dashboard-main">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          pagination={pagination}
          onPageChange={setPage}
          botAccounts={botAccounts}
          selectedBotId={selectedBotId}
          onSelectBot={(botId) => {
            setSelectedBotId(botId);
            setPage(1);
          }}
        />

        <section className="chat-area" key={selectedId || "empty"}>
          {selectedConversation ? (
            <>
              <div className="chat-header">
                <div>
                  <h3>
                    {selectedConversation.displayName ||
                      selectedConversation.display_name ||
                      selectedConversation.external_chat_id}
                  </h3>
                  <p>
                    Kênh: {selectedConversation.channelCode || selectedConversation.channel_code}
                    {selectedConversation.botName && (
                      <span className="bot-header-badge">
                        {" "}· 🤖 {selectedConversation.botName}
                      </span>
                    )}
                  </p>
                </div>

                <span className="chat-status">
                  {selectedConversation.status}
                </span>
              </div>

              <MessageList
                key={selectedId}
                conversationId={selectedId}
                refreshKey={messageRefreshKey}
              />

              <MessageInput
                key={selectedId}
                conversationId={selectedId}
                onMessageSent={() => {
                  setMessageRefreshKey((previous) => previous + 1);
                  setConversationRefreshKey((previous) => previous + 1);
                }}
              />
            </>
          ) : (
            <div className="no-conversation">
              Chọn một cuộc trò chuyện để xem lịch sử
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default App;
