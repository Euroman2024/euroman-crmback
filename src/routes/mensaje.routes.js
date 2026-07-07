const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const { sendMessage, sendMedia } = require("../controllers/mensaje.controller");
const multer = require("multer");
const upload = multer({ dest: 'uploads/' });

// Enviar un mensaje desde el CRM hacia WhatsApp
router.post("/send", authMiddleware, sendMessage);

// Enviar un archivo multimedia
router.post("/send-media", authMiddleware, upload.single('file'), sendMedia);

module.exports = router;
