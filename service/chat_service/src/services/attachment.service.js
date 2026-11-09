const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const STORAGE_DIR = path.resolve(
    __dirname,
    "../../storage/attachments"
);

const MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/zip": ".zip",
    "text/plain": ".txt"
};

const saveFile = async (file) => {
    const extension =
        MIME_EXTENSIONS[file.mimetype] ||
        path.extname(file.originalname) ||
        ".bin";

    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");

    const directory = path.join(
        STORAGE_DIR,
        year,
        month
    );

    await fs.mkdir(directory, {
        recursive: true
    });

    const storedName =
        `${crypto.randomUUID()}${extension}`;

    const absolutePath = path.join(
        directory,
        storedName
    );

    const storageKey =
        `attachments/${year}/${month}/${storedName}`;

    await fs.writeFile(
        absolutePath,
        file.buffer,
        { flag: "wx" }
    );

    return {
        storageKey,
        absolutePath,
        fullPath: absolutePath,
        fileName: path.basename(file.originalname || "file"),
        mimeType: file.mimetype,
        fileSize: file.size !== undefined ? file.size : file.buffer.length
    };
};

const deleteFile = async (absolutePath) => {
    if (!absolutePath) return;

    try {
        await fs.unlink(absolutePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("Delete file error:", error);
        }
    }
};

module.exports = {
    saveFile,
    deleteFile
};
