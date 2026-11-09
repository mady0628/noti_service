const path = require("node:path");
const fs = require("node:fs/promises");
const attachmentRepository = require("../repository/attachment.repository");

const STORAGE_DIR = path.resolve(
    __dirname,
    "../../storage"
);

const getAttachment = async (req, res) => {
    try {
        const { id } = req.params;

        const attachment = await attachmentRepository.findAttachmentById(id);

        if (!attachment) {
            return res.status(404).json({
                success: false,
                message: "Attachment not found"
            });
        }

        const absolutePath = path.resolve(
            STORAGE_DIR,
            attachment.storage_key
        );

        // Ngăn đường dẫn thoát khỏi storage
        if (
            absolutePath !== STORAGE_DIR &&
            !absolutePath.startsWith(
                STORAGE_DIR + path.sep
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid storage path"
            });
        }

        const fileBuffer = await fs.readFile(absolutePath);

        res.setHeader(
            "Content-Type",
            attachment.mime_type || "application/octet-stream"
        );

        res.setHeader(
            "Content-Length",
            fileBuffer.length
        );

        res.setHeader(
            "X-Content-Type-Options",
            "nosniff"
        );

        res.setHeader(
            "Cache-Control",
            "private, no-store"
        );

        const safeFileName = encodeURIComponent(
            attachment.file_name || "file"
        );

        res.setHeader(
            "Content-Disposition",
            attachment.mime_type?.startsWith("image/")
                ? `inline; filename*=UTF-8''${safeFileName}`
                : `attachment; filename*=UTF-8''${safeFileName}`
        );

        return res.send(fileBuffer);

    } catch (error) {
        if (error.code === "ENOENT") {
            return res.status(404).json({
                success: false,
                message: "File not found in storage"
            });
        }

        console.error("Get attachment error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to load attachment"
        });
    }
};

module.exports = {
    getAttachment
};
