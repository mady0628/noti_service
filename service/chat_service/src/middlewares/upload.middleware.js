const multer = require("multer");

const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",

    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "text/plain"
];

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 1
    },

    fileFilter: (req, file, callback) => {
        if (!allowedMimeTypes.includes(file.mimetype)) {
            return callback(
                new Error("File type is not supported")
            );
        }

        callback(null, true);
    }
});

module.exports = upload;