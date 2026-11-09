import { apiRequest } from "./api-client";

// Lấy danh sách conversations
export const getConversations = async (
    page = 1,
    limit = 10,
    signal,
    channelAccountId = null
) => {
    const params = new URLSearchParams({
        page: String(page),
        limit: String(limit)
    });

    if (channelAccountId) {
        params.set("channelAccountId", channelAccountId);
    }

    return apiRequest(
        `/api/conversations?${params.toString()}`,
        { signal }
    );
};

// Lấy danh sách bot accounts để lọc
export const getChannelAccounts = async (signal) => {
    return apiRequest(
        "/api/conversations/channel-accounts",
        { signal }
    );
};

// Lấy messages với Cursor Pagination
export const getConversationMessages = async (
    conversationId,
    limit = 20,
    cursor = null,
    signal
) => {
    const params = new URLSearchParams({
        limit: String(limit)
    });

    if (cursor) {
        params.set("cursor", cursor);
    }

    return apiRequest(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
        { signal }
    );
};

// Gửi message
export const sendConversationMessage = async (
    conversationId,
    content,
    clientRequestId
) => {
    return apiRequest(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                content,
                clientRequestId
            })
        }
    );
};

// Gửi attachment (ảnh hoặc tài liệu)
export const sendConversationAttachment = async (
    conversationId,
    file,
    caption,
    clientRequestId
) => {
    const formData = new FormData();

    formData.append("file", file);
    formData.append("content", caption || "");
    formData.append("clientRequestId", clientRequestId);

    return apiRequest(
        `/api/conversations/${encodeURIComponent(conversationId)}/attachments`,
        {
            method: "POST",
            body: formData
        }
    );
};

