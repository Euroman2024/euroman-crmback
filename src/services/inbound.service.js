const prisma = require('../config/prisma');
const { getIO } = require('../sockets/socket');

const handleIncomingMessage = async (accountId, messageUpsert) => {
  try {
    const { messages, type } = messageUpsert;
    
    // Solo procesamos notificaciones de mensajes nuevos
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      const isFromMe = msg.key.fromMe;
      
      // Filtros: Ignorar mensajes enviados por nosotros, de grupos o de estados
      if (isFromMe || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) {
        continue;
      }

      // Extraer número de teléfono (quitar @s.whatsapp.net)
      const telefono = remoteJid.split('@')[0];

      // Extraer contenido del texto
      let contenido = msg.message.conversation || msg.message.extendedTextMessage?.text;
      
      if (!contenido) {
         // Si es un tipo de mensaje que aún no soportamos (imagen/audio), ponemos un placeholder temporal
         if (msg.message.imageMessage) contenido = "[Imagen adjunta]";
         else if (msg.message.audioMessage) contenido = "[Audio adjunto]";
         else if (msg.message.documentMessage) contenido = "[Documento adjunto]";
         else if (msg.message.videoMessage) contenido = "[Video adjunto]";
         else continue; // Si es otro evento interno, lo ignoramos
      }

      // 1. Lógica de Contacto (Auto-creación)
      let contacto = await prisma.contacto.findUnique({
        where: { telefono }
      });

      if (!contacto) {
        // Obtenemos el pushName (nombre público de WhatsApp) si está disponible
        const nombrePush = msg.pushName || telefono;
        contacto = await prisma.contacto.create({
          data: {
            telefono,
            nombre: nombrePush
          }
        });
      }

      // 2. Lógica de Conversación (Auto-creación o recuperación)
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
        // Si el chat estaba cerrado, lo reabrimos a "nuevo" al recibir mensaje
        if (conversacion.estado === 'cerrado' || conversacion.estado === 'seguimiento') {
           conversacion = await prisma.conversacion.update({
             where: { id: conversacion.id },
             data: { estado: 'nuevo' }
           });
        }
      }

      // 3. Guardar el Mensaje en la BD
      const nuevoMensaje = await prisma.mensaje.create({
        data: {
          conversacionId: conversacion.id,
          contenido,
          tipo: 'incoming' // definido en el schema Prisma (enum TipoMensaje)
        }
      });

      // 4. Emitir evento vía Socket.io para actualizar el Frontend en tiempo real
      try {
        const io = getIO();
        io.emit('new_message', {
          conversacionId: conversacion.id,
          mensaje: nuevoMensaje,
          contacto: contacto,
          whatsappAccountId: accountId
        });
      } catch(e) {
        console.error('Socket no inicializado o error al emitir', e.message);
      }
      
      console.log(`[Baileys] Nuevo mensaje entrante procesado de ${telefono}: ${contenido.substring(0, 20)}...`);
    }
  } catch (error) {
    console.error('[Baileys] Error procesando mensaje entrante:', error);
  }
};

module.exports = {
  handleIncomingMessage
};
