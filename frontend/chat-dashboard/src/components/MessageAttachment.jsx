const MessageAttachment = ({ attachment }) => {
    const fileUrl = `/api/attachments/${attachment.id}`;

    const isImage = attachment.mimeType?.startsWith("image/");

    const fileSize = attachment.fileSize
        ? (attachment.fileSize / 1024).toFixed(1)
        : null;

    if (isImage) {
        return (
            <div className="message-attachment">
                <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Bấm để xem ảnh kích thước đầy đủ"
                >
                    <img
                        src={fileUrl}
                        alt={attachment.fileName || "Ảnh đính kèm"}
                        className="message-image"
                        loading="lazy"
                    />
                </a>

                {attachment.fileName && (
                    <p className="attachment-filename">{attachment.fileName}</p>
                )}
            </div>
        );
    }

    return (
        <a
            href={fileUrl}
            className="document-attachment"
            download={attachment.fileName || true}
            title="Bấm để tải tệp"
        >
            <span className="document-icon">
                📄
            </span>

            <div className="document-info">
                <strong>{attachment.fileName || "Tài liệu đính kèm"}</strong>
                {fileSize && <small>{fileSize} KB</small>}
            </div>
        </a>
    );
};

export default MessageAttachment;
