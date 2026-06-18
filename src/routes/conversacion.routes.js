const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const {
  getConversaciones,
  getMensajesByConversacionId,
  updateConversacion,
} = require("../controllers/conversacion.controller");

// Obtener todas las conversaciones activas
router.get("/", authMiddleware, getConversaciones);

// Obtener historial de mensajes de una conversación
router.get("/:id/mensajes", authMiddleware, getMensajesByConversacionId);

// Actualizar estado o asignar vendedor a una conversación
router.put("/:id", authMiddleware, updateConversacion);

module.exports = router;
