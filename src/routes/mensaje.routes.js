const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const { sendMessage } = require("../controllers/mensaje.controller");

// Enviar un mensaje desde el CRM hacia WhatsApp
router.post("/send", authMiddleware, sendMessage);

module.exports = router;
