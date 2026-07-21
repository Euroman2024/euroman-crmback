const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/prisma');
const qrcode = require('qrcode');
const { getIO } = require('../sockets/socket');

const isUnknownContactName = (name) => {
  if (!name) return true;
  return /^(desconocido|unknown|whatsapp business|whatsapp user|unregistered)$/i.test(String(name).trim());
};

const upsertContactData = async (telefono, nombreReal, allowOverwrite) => {
  try {
    const existingContact = await prisma.contacto.findUnique({ where: { telefono } });
    if (!existingContact) {
      await prisma.contacto.create({ data: { telefono, nombre: nombreReal } });
    } else {
      const currentName = existingContact.nombre;
      const isCurrentUnknown = !currentName || isUnknownContactName(currentName);
      if (isCurrentUnknown || allowOverwrite) {
        await prisma.contacto.update({ where: { telefono }, data: { nombre: nombreReal } });
      }
    }
  } catch(e) {}
};

class WhatsAppService {
  constructor() {
    this.sessions = new Map(); // Store active sessions by accountId
  }

  async startSession(accountId) {
    const sessionDir = path.join(__dirname, '..', '..', 'sessions', accountId);
    
    // Ensure sessions directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }), // Suppress baileys logs
      browser: ['CRM Ventas', 'Chrome', '10.0'], // Identify as CRM
    });

    sock.ev.on('creds.update', saveCreds);

    // Escuchar mensajes entrantes
    const { handleIncomingMessage } = require('./inbound.service');
    sock.ev.on('messages.upsert', (m) => handleIncomingMessage(accountId, m, sock));

    // Escuchar historial al vincular dispositivo
    sock.ev.on('messaging-history.set', async ({ messages, contacts }) => {
      console.log(`[Baileys] Recibiendo historial: ${messages?.length || 0} mensajes y ${contacts?.length || 0} contactos.`);
      
      // Sincronizar Contactos de la Agenda en segundo plano sin bloquear
      if (contacts && contacts.length > 0) {
        console.log(`[Baileys] Sincronizando nombres de la agenda telefónica en segundo plano...`);
        (async () => {
          for (const c of contacts) {
            const nombreReal = c.name || c.notify;
            if (!nombreReal || isUnknownContactName(nombreReal)) continue;

            const remoteJid = c.id;
            if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) continue;
            
            const [idPart, domainPart] = remoteJid.split('@');
            const telefono = `${idPart.split(':')[0]}@${domainPart}`;

            await upsertContactData(telefono, nombreReal, !!c.name);

            if (c.lidJid) {
              const [lidId, lidDomain] = c.lidJid.split('@');
              const lidTelefono = `${lidId.split(':')[0]}@${lidDomain || 'lid'}`;
              await upsertContactData(lidTelefono, nombreReal, !!c.name);
            }
          }
          console.log(`[Baileys] Sincronización de ${contacts.length} contactos finalizada.`);
        })();
      }

      // Procesar solo mensajes de los últimos 3 días para no saturar
      const threeDaysAgo = (Date.now() / 1000) - (3 * 24 * 60 * 60);
      const recentMessages = (messages || []).filter(m => {
        const ts = typeof m.messageTimestamp === 'object' ? m.messageTimestamp.low : m.messageTimestamp;
        return ts > threeDaysAgo;
      });
      
      console.log(`[Baileys] Procesando ${recentMessages.length} mensajes de los últimos 3 días en segundo plano...`);
      
      for (const msg of recentMessages) {
        // Reutilizamos la lógica de entrada
        await handleIncomingMessage(accountId, { messages: [msg], type: 'notify' }, sock);
      }
      console.log(`[Baileys] Sincronización de historial reciente completada.`);
    });

    // Escuchar actualizaciones de contactos nuevos guardados en el teléfono
    sock.ev.on('contacts.upsert', async (contacts) => {
      for (const c of contacts) {
        const nombreReal = c.name || c.notify;
        if (!nombreReal || isUnknownContactName(nombreReal)) continue;
        const remoteJid = c.id;
        if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) continue;
        
        const [idPart, domainPart] = remoteJid.split('@');
        const telefono = `${idPart.split(':')[0]}@${domainPart}`;

        await upsertContactData(telefono, nombreReal, !!c.name);

        if (c.lidJid) {
          const [lidId, lidDomain] = c.lidJid.split('@');
          const lidTelefono = `${lidId.split(':')[0]}@${lidDomain || 'lid'}`;
          await upsertContactData(lidTelefono, nombreReal, !!c.name);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Emit QR to frontend using socket.io
        qrcode.toDataURL(qr, (err, url) => {
          if (err) {
            console.error('Error generating QR', err);
            return;
          }
          console.log(`[Baileys] QR Generated for account ${accountId}`);
          try {
            getIO().emit('qr_generated', { accountId, qr: url });
          } catch (e) {
            console.error('Socket.io error emitting QR:', e.message);
          }
        });
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`[Baileys] Connection closed for account ${accountId}. Reconnecting:`, shouldReconnect);
        
        try {
          // Update DB state
          await prisma.whatsappAccount.update({
            where: { id: accountId },
            data: { estado: 'desconectado' }
          });
          
          try {
            getIO().emit('status_changed', { accountId, status: 'desconectado' });
          } catch (e) {}

          if (shouldReconnect) {
            this.startSession(accountId);
          } else {
            // Logged out: Delete session directory so a new QR can be generated
            fs.rmSync(sessionDir, { recursive: true, force: true });
            this.sessions.delete(accountId);
          }
        } catch (dbError) {
          console.error("DB Error updating account status:", dbError);
        }

      } else if (connection === 'open') {
        console.log(`[Baileys] Connection opened for account ${accountId}`);
        
        try {
          // Extraer número real del socket
          const realNumber = sock.user.id.split(':')[0];
          
          const acc = await prisma.whatsappAccount.findUnique({ where: { id: accountId } });
          
          if (!acc.numero) {
            // Primer escaneo: Asignación dinámica
            const exists = await prisma.whatsappAccount.findFirst({
              where: { numero: realNumber, id: { not: accountId } }
            });
            
            if (exists) {
              console.log(`[Baileys] Rechazado: El número ${realNumber} ya pertenece a ${exists.nombre}.`);
              await sock.logout();
              getIO().emit('auth_error', { accountId, message: `El número escaneado ya pertenece a la línea: ${exists.nombre}.` });
              return;
            }
            
            // Reclamar ranura
            await prisma.whatsappAccount.update({
              where: { id: accountId },
              data: { numero: realNumber, estado: 'conectado' }
            });
          } else {
            // Reconexión: Verificación estricta
            if (acc.numero !== realNumber) {
              console.log(`[Baileys] Rechazado: Ranura de ${acc.numero} escaneada por ${realNumber}.`);
              await sock.logout();
              getIO().emit('auth_error', { accountId, message: `Número incorrecto. Esta ranura es exclusiva para el número ${acc.numero}.` });
              return;
            }
            
            // Restaurado normal
            await prisma.whatsappAccount.update({
              where: { id: accountId },
              data: { estado: 'conectado' }
            });
          }
          
          try {
            getIO().emit('status_changed', { accountId, status: 'conectado' });
          } catch (e) {}
        } catch (dbError) {
          console.error("DB Error updating account status:", dbError);
        }
      }
    });

    this.sessions.set(accountId, sock);
    return sock;
  }

  getSession(accountId) {
    return this.sessions.get(accountId);
  }

  // Restore all accounts on startup
  async restoreSessions() {
    try {
      const accounts = await prisma.whatsappAccount.findMany();
      console.log(`[Baileys] Found ${accounts.length} accounts. Initializing sessions...`);
      for (const acc of accounts) {
        await this.startSession(acc.id);
      }
    } catch (error) {
      console.error("[Baileys] Error restoring sessions on startup:", error);
    }
  }
}

// Export as singleton
module.exports = new WhatsAppService();
