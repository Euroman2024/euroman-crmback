const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const { sendMessage, sendMedia, forwardMessage, editMessage, deleteMessage } = require("../controllers/mensaje.controller");
const multer = require("multer");
const upload = multer({ dest: 'uploads/' });

// Enviar un mensaje desde el CRM hacia WhatsApp
router.post("/send", authMiddleware, sendMessage);

// Enviar un archivo multimedia
router.post("/send-media", authMiddleware, upload.single('file'), sendMedia);

// Reenviar mensaje
router.post("/forward", authMiddleware, forwardMessage);

// Editar mensaje (solo texto)
router.put("/:mensajeId/edit", authMiddleware, editMessage);

// Eliminar mensaje
router.delete("/:mensajeId", authMiddleware, deleteMessage);

module.exports = router;
