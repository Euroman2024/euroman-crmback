const prisma = require("../config/prisma");
const whatsappService = require("../services/whatsapp.service");
const { getIO } = require("../sockets/socket");
const fs = require("fs");
const path = require("path");

// Enviar mensaje saliente (Outbound)
const sendMessage = async (req, res) => {
  try {
    const { conversacionId, contenido, quotedMessageId } = req.body;

    if (!conversacionId || !contenido) {
      return res.status(400).json({ message: "ConversacionId y contenido son requeridos" });
    }

    // 1. Obtener la conversación y el contacto
    const conversacion = await prisma.conversacion.findUnique({
      where: { id: conversacionId },
      include: { contacto: true, whatsappAccount: true }
    });

    if (!conversacion) {
      return res.status(404).json({ message: "Conversación no encontrada" });
    }

    if (conversacion.whatsappAccount.estado !== 'conectado') {
      return res.status(400).json({ message: "La cuenta de WhatsApp no está conectada. Por favor escanea el QR." });
    }

    const { whatsappAccountId, contacto } = conversacion;
    const telefono = contacto.telefono;
    const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;

    // 2. Obtener la sesión de Baileys correspondiente
    const sock = whatsappService.getSession(whatsappAccountId);

    if (!sock) {
      return res.status(500).json({ message: "La cuenta de WhatsApp vinculada no está conectada o no tiene sesión activa." });
    }

    // 3. Enviar el mensaje físico a través de WhatsApp
    let options = {};

    // Si se está respondiendo a un mensaje (Citar)
    if (quotedMessageId) {
      const originalMsg = await prisma.mensaje.findUnique({ where: { id: quotedMessageId } });
      if (originalMsg) {
        options.quoted = {
          key: {
            remoteJid: jid,
            fromMe: originalMsg.tipo === 'outgoing',
            id: originalMsg.whatsappMsgId
          },
          message: { conversation: originalMsg.contenido || 'Archivo multimedia' }
        };
      }
    }

    await sock.sendMessage(jid, { text: contenido }, options);

    // 4. Guardar en PostgreSQL
    const nuevoMensaje = await prisma.mensaje.create({
      data: {
        conversacionId,
        contenido,
        tipo: 'outgoing',
        quotedMensajeId: quotedMessageId || null,
        quotedContenido: options.quoted ? options.quoted.message.conversation : null
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

// Enviar archivo multimedia (Outbound)
const sendMedia = async (req, res) => {
  try {
    const { conversacionId, contenido, quotedMessageId } = req.body;
    const file = req.file;

    if (!conversacionId || !file) {
      if (file) fs.unlinkSync(file.path);
      return res.status(400).json({ message: "ConversacionId y archivo son requeridos" });
    }

    const conversacion = await prisma.conversacion.findUnique({
      where: { id: conversacionId },
      include: { contacto: true, whatsappAccount: true }
    });

    if (!conversacion || conversacion.whatsappAccount.estado !== 'conectado') {
      fs.unlinkSync(file.path);
      return res.status(400).json({ message: "Conversación no válida o cuenta desconectada" });
    }

    const { whatsappAccountId, contacto } = conversacion;
    const telefono = contacto.telefono;
    const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;
    const sock = whatsappService.getSession(whatsappAccountId);

    if (!sock) {
      fs.unlinkSync(file.path);
      return res.status(500).json({ message: "La cuenta de WhatsApp no tiene sesión activa." });
    }

    // Preparar archivo
    const buffer = fs.readFileSync(file.path);
    const mimeType = file.mimetype;
    let messageContent = {};

    if (mimeType.startsWith('image/')) {
      messageContent = { image: buffer, caption: contenido || '' };
    } else if (mimeType.startsWith('video/')) {
      messageContent = { video: buffer, caption: contenido || '' };
    } else if (mimeType.startsWith('audio/')) {
      messageContent = { audio: buffer, ptt: false }; // ptt true for voice notes
    } else {
      messageContent = { document: buffer, fileName: file.originalname, mimetype: mimeType };
    }

    // 3. Enviar el mensaje físico a través de WhatsApp
    let options = {};
    if (quotedMessageId) {
      const originalMsg = await prisma.mensaje.findUnique({ where: { id: quotedMessageId } });
      if (originalMsg) {
        options.quoted = {
          key: {
            remoteJid: jid,
            fromMe: originalMsg.tipo === 'outgoing',
            id: originalMsg.whatsappMsgId
          },
          message: { conversation: originalMsg.contenido || 'Archivo multimedia' }
        };
      }
    }

    await sock.sendMessage(jid, messageContent, options);

    // Mover archivo a la carpeta pública si queremos guardarlo (opcional, como inbound)
    const ext = path.extname(file.originalname);
    const fileName = `${Date.now()}_${Math.floor(Math.random()*1000)}${ext}`;
    const newPath = path.join(__dirname, '..', '..', 'uploads', fileName);
    fs.renameSync(file.path, newPath);
    const archivoUrl = `/api/uploads/${fileName}`;

    // 4. Guardar en PostgreSQL
    const nuevoMensaje = await prisma.mensaje.create({
      data: {
        conversacionId,
        contenido: contenido || '',
        archivoUrl,
        mimetype: mimeType,
        tipo: 'outgoing',
        quotedMensajeId: quotedMessageId || null,
        quotedContenido: options.quoted ? options.quoted.message.conversation : null
      }
    });

    // 5. Actualizar estado
    await prisma.conversacion.update({
      where: { id: conversacionId },
      data: { estado: 'respondido' }
    });

    // 6. Emitir evento por Sockets
    try {
      getIO().emit('message_sent', {
        conversacionId,
        mensaje: nuevoMensaje
      });
    } catch (e) {}

    res.status(200).json(nuevoMensaje);

  } catch (error) {
    console.error("Error al enviar multimedia:", error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: "Error interno al enviar el archivo" });
  }
};

module.exports = {
  sendMessage,
  sendMedia
};
