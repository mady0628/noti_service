import { useEffect, useRef, useState } from "react";
import {
    sendConversationMessage,
    sendConversationAttachment
} from "../api/conversation.api";

const MessageInput = ({
    conversationId,
    onMessageSent
}) => {
    const [content, setContent] = useState("");
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [pendingRequestId, setPendingRequestId] = useState(null);

    const fileInputRef = useRef(null);

    useEffect(() => {
        setContent("");
        setFile(null);
        setError("");
        setPendingRequestId(null);
    }, [conversationId]);

    // Tạo preview URL khi chọn ảnh
    useEffect(() => {
        if (file && file.type.startsWith("image/")) {
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            return () => URL.revokeObjectURL(url);
        }
        setPreviewUrl(null);
    }, [file]);

    const handleFileChange = (event) => {
        const selectedFile = event.target.files?.[0] || null;
        if (selectedFile) {
            if (selectedFile.size > 20 * 1024 * 1024) {
                setError("Dung lượng tệp không được vượt quá 20MB.");
                return;
            }
            setFile(selectedFile);
            setError("");
            setPendingRequestId(null);
        }
    };

    const handleRemoveFile = () => {
        setFile(null);
        setPreviewUrl(null);
        setPendingRequestId(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleSend = async (event) => {
        event.preventDefault();

        const text = content.trim();

        // Nếu không có cả file lẫn chữ thì không gửi
        if ((!text && !file) || sending) return;

        const requestId = pendingRequestId || crypto.randomUUID();
        setPendingRequestId(requestId);
        setSending(true);
        setError("");

        try {
            let result;

            if (file) {
                // Gửi tệp đính kèm kèm caption
                result = await sendConversationAttachment(
                    conversationId,
                    file,
                    text,
                    requestId
                );
            } else {
                // Gửi tin nhắn văn bản thông thường
                result = await sendConversationMessage(
                    conversationId,
                    text,
                    requestId
                );
            }

            setContent("");
            handleRemoveFile();
            setPendingRequestId(null);

            onMessageSent?.(result.data);

        } catch (err) {
            console.error(err);
            setError(
                err.message ||
                "Không thể xác nhận kết quả gửi. Hãy kiểm tra lại kết nối mạng."
            );
        } finally {
            setSending(false);
        }
    };

    const handleChange = (value) => {
        setContent(value);
        setPendingRequestId(null);
    };

    return (
        <form className="message-input-container" onSubmit={handleSend}>
            {/* Vùng xem trước file đính kèm trước khi gửi */}
            {file && (
                <div className="attachment-preview-bar">
                    {previewUrl ? (
                        <div className="preview-image-box">
                            <img
                                src={previewUrl}
                                alt="Xem trước ảnh"
                                className="preview-image"
                            />
                        </div>
                    ) : (
                        <div className="preview-file-icon">📄</div>
                    )}

                    <div className="preview-file-meta">
                        <span className="preview-file-name">{file.name}</span>
                        <span className="preview-file-size">
                            {(file.size / 1024).toFixed(1)} KB
                        </span>
                    </div>

                    <button
                        type="button"
                        className="preview-remove-btn"
                        onClick={handleRemoveFile}
                        title="Hủy tệp"
                        disabled={sending}
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Thanh nhập tin nhắn và nút thao tác */}
            <div className="message-input-row">
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
                    onChange={handleFileChange}
                    disabled={sending}
                />

                <button
                    type="button"
                    className="attachment-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Đính kèm tệp hoặc hình ảnh"
                    disabled={sending}
                >
                    📎
                </button>

                <input
                    type="text"
                    className="message-text-input"
                    value={content}
                    onChange={(event) => handleChange(event.target.value)}
                    placeholder={
                        file
                            ? "Nhập chú thích cho tệp (tùy chọn)..."
                            : "Nhập tin nhắn..."
                    }
                    maxLength={file ? 1024 : 4096}
                    disabled={sending}
                />

                <button
                    type="submit"
                    className="send-btn"
                    disabled={(!content.trim() && !file) || sending}
                >
                    {sending ? "Đang gửi..." : "Gửi"}
                </button>
            </div>

            {error && <p className="send-error">{error}</p>}
        </form>
    );
};

export default MessageInput;
