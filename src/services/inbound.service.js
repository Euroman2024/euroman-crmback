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

// Tipos de envolturas que WhatsApp usa para mensajes especiales.
// Hay que desenvolver para llegar al mensaje real (imageMessage, videoMessage, etc.)
const WRAPPER_TYPES = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'reactionMessage',
];

// Desenvuelve capas de mensajes especiales de WhatsApp hasta llegar
// al contenido real (imageMessage, videoMessage, audioMessage, etc.)
const extractRealMessage = (msgObj) => {
  if (!msgObj) return msgObj;
  for (const wrapperKey of WRAPPER_TYPES) {
    if (msgObj[wrapperKey]) {
      // Los wrappers suelen tener el mensaje real en .message
      const inner = msgObj[wrapperKey]?.message || msgObj[wrapperKey];
      return extractRealMessage(inner);
    }
  }
  return msgObj;
};

// Extrae la clave del tipo de media real del objeto de mensaje
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
const getMediaType = (realMsg) => {
  if (!realMsg) return null;
  return MEDIA_TYPES.find(t => realMsg[t]) || null;
};

// Convierte mimetype a extensión de archivo de forma segura
const mimetypeToExt = (mimetype = '') => {
  const base = mimetype.split(';')[0].trim();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/mpeg': 'mpeg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
  };
  if (map[base]) return map[base];
  // fallback: tomar la parte despues de /
  return base.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
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
      
      // Filtros: Ignorar mensajes de grupos, estados o canales de WhatsApp
      if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) {
        continue;
      }

      // Evitar duplicados
      const existingMessage = await prisma.mensaje.findUnique({
        where: { whatsappMsgId }
      });
      if (existingMessage) continue;

      // Extraer número de teléfono preservando el dominio
      const [idPart, domainPart] = remoteJid.split('@');
      let telefono = `${idPart.split(':')[0]}@${domainPart}`;
      const isLid = domainPart === 'lid';

      // Resolve LID to real phone if mapped
      if (isLid) {
        console.log(`[LID DEBUG] Incoming LID message from: ${telefono}`);
        try {
          const mapPath = process.env.UPLOADS_DIR ? path.join(process.env.UPLOADS_DIR, 'lidMap.json') : path.join(__dirname, '..', '..', 'public', 'uploads', 'lidMap.json');
          console.log(`[LID DEBUG] Checking lidMap at: ${mapPath}`);
          if (fs.existsSync(mapPath)) {
            const lidMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            if (lidMap[telefono]) {
              console.log(`[LID DEBUG] Successfully mapped ${telefono} to ${lidMap[telefono]}`);
              telefono = lidMap[telefono];
            } else {
              console.log(`[LID DEBUG] No mapping found in lidMap.json for ${telefono}`);
            }
          } else {
            console.log(`[LID DEBUG] lidMap.json does NOT exist at ${mapPath}`);
          }
        } catch (e) {
          console.error("[LID DEBUG] Error resolving lid mapping", e);
        }
      }

      if (isLid && telefono.includes('@lid')) {
        console.log("UNMAPPED LID MESSAGE RECEIVED! Raw payload:");
        console.log(JSON.stringify(msg, null, 2));
      }

      // 1. Extraer contenido y archivos PRIMERO para descartar mensajes de sistema sin contenido
      // Primero desenvolver cualquier capa especial de WhatsApp (viewOnce, ephemeral, etc.)
      const realMsg = extractRealMessage(msg.message);
      let contenido = realMsg?.conversation || realMsg?.extendedTextMessage?.text || 
                      msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      let archivoUrl = null;
      let mimetype = null;

      const mediaType = getMediaType(realMsg);
      const isMedia = !!mediaType;

      if (isMedia) {
        try {
          mimetype = realMsg[mediaType]?.mimetype || '';
          
          // Leer el caption (texto que acompaña a la imagen/video/documento)
          const caption = realMsg[mediaType]?.caption || '';
          if (caption && !contenido) {
            contenido = caption;
          }
          
          // downloadMediaMessage necesita el msg original (con la clave del wrapper intacta)
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: { level: 'silent', ...console, trace: () => {}, debug: () => {} } });
          
          if (buffer && buffer.length > 0) {
            // Generar nombre único con extensión correcta
            const ext = mimetypeToExt(mimetype);
            const filename = `${uuidv4()}.${ext}`;
            const uploadDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'public', 'uploads');
            
            // Crear la carpeta si no existe
            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, buffer);
            archivoUrl = `/uploads/${filename}`;
            console.log(`[Media] Guardado: ${filename} (${mimetype}, ${buffer.length} bytes)`);
          } else {
            console.warn(`[Media] Buffer vacío para ${mediaType}, omitiendo archivo.`);
          }
          
          // Solo poner [image]/[video]/etc si no hay caption ni texto previo
          if (!contenido) contenido = `[${mediaType.replace('Message', '')}]`;
        } catch (e) {
          console.error(`[Media] Error al procesar multimedia:`, e);
          if (!contenido) contenido = `[Error adjunto]`;
        }
      }

      // 2. Descartar el mensaje si NO TIENE CONTENIDO (mensajes de sistema, sincronizaciones, etc)
      if (!contenido && !archivoUrl && !isMedia) continue;

      // 3. Lógica de Contacto (Auto-creación)
      let contacto = await prisma.contacto.findUnique({
        where: { telefono }
      });

      // NOVEDAD: Leer el mapeo persistente directo desde la Base de Datos
      if (contacto && contacto.nombre && contacto.nombre.startsWith('MERGED_TO:')) {
        const realTelefono = contacto.nombre.replace('MERGED_TO:', '').trim();
        console.log(`[LID DEBUG] DB Redirect: ${telefono} -> ${realTelefono}`);
        telefono = realTelefono;
        contacto = await prisma.contacto.findUnique({ where: { telefono } });
      }

      // Si el JID es @lid y no encontramos el contacto por teléfono,
      // buscar por pushName para evitar crear duplicados
      if (!contacto && isLid && telefono.includes('@lid') && msg.pushName) {
        const byName = await prisma.contacto.findFirst({
          where: {
            OR: [
              { nombre: { contains: msg.pushName, mode: 'insensitive' } },
              { nombre: { contains: `~${msg.pushName}`, mode: 'insensitive' } }
            ],
            telefono: { endsWith: '@s.whatsapp.net' }
          }
        });
        if (byName) {
          // Guardar el mapeo @lid -> @s.whatsapp.net para mensajes futuros
          try {
            const mapPath = process.env.UPLOADS_DIR ? path.join(process.env.UPLOADS_DIR, 'lidMap.json') : path.join(__dirname, '..', '..', 'public', 'uploads', 'lidMap.json');
            const lidMap = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};
            lidMap[telefono] = byName.telefono;
            fs.writeFileSync(mapPath, JSON.stringify(lidMap, null, 2));
          } catch (e) {}
          // Usar el contacto existente con número real
          contacto = byName;
          telefono = byName.telefono;
        }
      }

      if (!contacto) {
        try {
          contacto = await prisma.contacto.create({
            data: {
              telefono,
              nombre: !isFromMe && msg.pushName ? `~${msg.pushName}` : null,
              fotoPerfilUrl: null
            }
          });
        } catch (e) {
          // Condición de carrera: otro mensaje concurrente ya creó este contacto
          if (e.code === 'P2002') {
            contacto = await prisma.contacto.findUnique({ where: { telefono } });
          } else {
            throw e;
          }
        }

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
      } else if (!contacto.nombre && !isFromMe && msg.pushName) {
        // Update name if missing
        contacto = await prisma.contacto.update({
          where: { id: contacto.id },
          data: { nombre: `~${msg.pushName}` }
        });
      }

      // 4. Lógica de Conversación (upsert atómico: la BD garantiza que nunca
      // se creen dos conversaciones para el mismo contacto+cuenta, incluso
      // si dos mensajes llegan casi al mismo tiempo)
      let conversacion = await prisma.conversacion.upsert({
        where: {
          contactoId_whatsappAccountId: {
            contactoId: contacto.id,
            whatsappAccountId: accountId
          }
        },
        create: {
          contactoId: contacto.id,
          whatsappAccountId: accountId,
          estado: isFromMe ? 'leido' : 'nuevo'
        },
        update: {}
      });

      if (!isFromMe && conversacion.estado !== 'nuevo') {
        conversacion = await prisma.conversacion.update({
          where: { id: conversacion.id },
          data: { estado: 'nuevo' }
        });
      } else if (isFromMe && conversacion.estado === 'nuevo') {
        conversacion = await prisma.conversacion.update({
          where: { id: conversacion.id },
          data: { estado: 'leido' }
        });
      }

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
