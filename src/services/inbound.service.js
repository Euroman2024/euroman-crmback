const prisma = require('../config/prisma');
const { getIO } = require('../sockets/socket');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const formatPhoneForDisplay = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';

  let countryCode = '';
  let remaining = digits;

  if (digits.length > 10) {
    countryCode = digits.slice(0, digits.length - 10);
    remaining = digits.slice(countryCode.length);
  }

  const groups = [];
  while (remaining.length > 0) {
    if (remaining.length > 4) {
      groups.push(remaining.slice(0, 3));
      remaining = remaining.slice(3);
    } else {
      groups.push(remaining);
      remaining = '';
    }
  }

  return `${countryCode ? `+${countryCode} ` : ''}${groups.join(' ')}`.trim();
};

const handleIncomingMessage = async (accountId, messageUpsert, sock) => {
  try {
    const { messages, type } = messageUpsert;
    
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      const isFromMe = msg.key.fromMe;
      const whatsappMsgId = msg.key.id;
      
      // Filtros: Ignorar mensajes de grupos o de estados
      if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) {
        continue;
      }

      // Evitar duplicados
      const existingMessage = await prisma.mensaje.findUnique({
        where: { whatsappMsgId }
      });
      if (existingMessage) continue;

      // Extraer número de teléfono preservando el dominio
      const [idPart, domainPart] = remoteJid.split('@');
      const telefono = `${idPart.split(':')[0]}@${domainPart}`;

      // 1. Lógica de Contacto (Auto-creación)
      let contacto = await prisma.contacto.findUnique({
        where: { telefono }
      });

      if (!contacto) {
        const nombreInicial = formatPhoneForDisplay(telefono.split('@')[0]);

        contacto = await prisma.contacto.create({
          data: {
            telefono,
            nombre: nombreInicial || null,
            fotoPerfilUrl: null
          }
        });

        // Obtener foto de perfil en segundo plano sin bloquear
        if (!isFromMe && sock) {
          sock.profilePictureUrl(remoteJid, 'image').then(async (url) => {
            if (url) {
              await prisma.contacto.update({
                where: { id: contacto.id },
                data: { fotoPerfilUrl: url }
              });
            }
          }).catch(() => {});
        }
      }

      // 2. Lógica de Conversación
      let conversacion = await prisma.conversacion.findFirst({
        where: {
          contactoId: contacto.id,
          whatsappAccountId: accountId
        }
      });

      if (!conversacion) {
        conversacion = await prisma.conversacion.create({
          data: {
            contactoId: contacto.id,
            whatsappAccountId: accountId,
            estado: 'nuevo'
          }
        });
      } else {
        if (!isFromMe) {
          conversacion = await prisma.conversacion.update({
            where: { id: conversacion.id },
            data: { estado: 'nuevo' }
          });
        }
      }

      // Extraer contenido y archivos
      let contenido = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      let archivoUrl = null;
      let mimetype = null;

      const isMedia = msg.message.imageMessage || msg.message.documentMessage || msg.message.videoMessage || msg.message.audioMessage || msg.message.stickerMessage;
      
      if (isMedia) {
        try {
          const mediaType = Object.keys(msg.message).find(k => k.includes('Message'));
          mimetype = msg.message[mediaType]?.mimetype || '';
          
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: console });
          
          // Generar nombre único
          const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
          const filename = `${uuidv4()}.${ext}`;
          const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads');
          
          // Crear la carpeta si no existe
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          
          const filepath = path.join(uploadDir, filename);
          fs.writeFileSync(filepath, buffer);
          archivoUrl = `/uploads/${filename}`;
          
          if (!contenido) contenido = `[${mediaType.replace('Message', '')}]`;
        } catch (err) {
          console.error("Error descargando media:", err);
          if (!contenido) contenido = "[Error al descargar archivo]";
        }
      }

      if (!contenido && !archivoUrl) continue;

      let quotedMensajeId = null;
      let quotedContenido = null;

      const contextInfo = msg.message.extendedTextMessage?.contextInfo || msg.message.imageMessage?.contextInfo || msg.message.videoMessage?.contextInfo || msg.message.audioMessage?.contextInfo || msg.message.documentMessage?.contextInfo;
      
      if (contextInfo?.stanzaId) {
         quotedMensajeId = contextInfo.stanzaId; // Este es el whatsappMsgId original
         quotedContenido = contextInfo.quotedMessage?.conversation || contextInfo.quotedMessage?.extendedTextMessage?.text || 'Multimedia';
      }

      // 3. Guardar el Mensaje en la BD
      const timestamp = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date();
      
      const nuevoMensaje = await prisma.mensaje.create({
        data: {
          whatsappMsgId,
          conversacionId: conversacion.id,
          contenido,
          archivoUrl,
          mimetype,
          tipo: isFromMe ? 'outgoing' : 'incoming',
          quotedMensajeId,
          quotedContenido,
          createdAt: timestamp
        }
      });

      // 4. Emitir evento vía Socket.io
      try {
        const io = getIO();
        const eventName = isFromMe ? 'message_sent' : 'new_message';
        io.emit(eventName, {
          conversacionId: conversacion.id,
          mensaje: nuevoMensaje,
          contacto: contacto,
          whatsappAccountId: accountId
        });
      } catch(e) {}
      
    }
  } catch (error) {
    console.error('[Baileys] Error procesando mensaje entrante:', error);
  }
};

module.exports = {
  handleIncomingMessage
};
