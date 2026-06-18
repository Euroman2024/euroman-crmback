const prisma = require("../config/prisma");
const whatsappService = require("../services/whatsapp.service");
const { getIO } = require("../sockets/socket");

// Enviar mensaje saliente (Outbound)
const sendMessage = async (req, res) => {
  try {
    const { conversacionId, contenido } = req.body;

    if (!conversacionId || !contenido) {
      return res.status(400).json({ message: "ConversacionId y contenido son requeridos" });
    }

    // 1. Obtener la conversación y el contacto
    const conversacion = await prisma.conversacion.findUnique({
      where: { id: conversacionId },
      include: { contacto: true }
    });

    if (!conversacion) {
      return res.status(404).json({ message: "Conversación no encontrada" });
    }

    const { whatsappAccountId, contacto } = conversacion;
    const telefono = contacto.telefono;
    const jid = `${telefono}@s.whatsapp.net`;

    // 2. Obtener la sesión de Baileys correspondiente
    const sock = whatsappService.getSession(whatsappAccountId);

    if (!sock) {
      return res.status(500).json({ message: "La cuenta de WhatsApp vinculada no está conectada o no tiene sesión activa." });
    }

    // 3. Enviar el mensaje físico a través de WhatsApp
    await sock.sendMessage(jid, { text: contenido });

    // 4. Guardar en PostgreSQL
    const nuevoMensaje = await prisma.mensaje.create({
      data: {
        conversacionId,
        contenido,
        tipo: 'outgoing'
      }
    });

    // 5. Actualizar estado de la conversación a "respondido"
    await prisma.conversacion.update({
      where: { id: conversacionId },
      data: { estado: 'respondido' }
    });

    // 6. Emitir evento por Sockets para actualizar la UI
    try {
      getIO().emit('message_sent', {
        conversacionId,
        mensaje: nuevoMensaje
      });
    } catch (e) {
       console.error("Error al emitir socket:", e.message);
    }

    res.status(200).json(nuevoMensaje);

  } catch (error) {
    console.error("Error al enviar mensaje:", error);
    res.status(500).json({ message: "Error interno al enviar el mensaje" });
  }
};

module.exports = {
  sendMessage
};
