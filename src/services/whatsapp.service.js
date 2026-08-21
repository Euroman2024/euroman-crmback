const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
    this.startRetries = new Map(); // Retry counters per account
    this.reconnectTimers = new Map(); // Store timeout IDs for reconnection
    this.pendingResets = new Set(); // Prevent duplicate resets
    this.qrs = new Map(); // Store latest generated QRs

    // Poll interval configurable via env (ms). Default 10s in production for faster QR generation.
    this.pollInterval = parseInt(process.env.SESSION_WATCHER_INTERVAL_MS || '10000', 10);

    // Sessions directory configurable (use Persistent Volume in production)
    this.sessionsBase = process.env.SESSIONS_DIR || path.join(__dirname, '..', '..', 'sessions');

    // (Watcher removed)
  }

  // Removed _startDisconnectedWatcher to prevent accidental session deletion

  async startSession(accountId) {
    // Destroy existing socket if it exists to prevent concurrent connections
    const existingSock = this.sessions.get(accountId);
    if (existingSock) {
      try { existingSock.ev.removeAllListeners(); } catch (e) {}
      try { existingSock.ws.close(); } catch (e) {}
      this.sessions.delete(accountId);
    }

    // Clear any pending reconnect timers
    if (this.reconnectTimers.has(accountId)) {
      clearTimeout(this.reconnectTimers.get(accountId));
      this.reconnectTimers.delete(accountId);
    }

    const sessionDir = path.join(this.sessionsBase, accountId);
    
    // Ensure sessions directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    let state, saveCreds;
    try {
      ({ state, saveCreds } = await useMultiFileAuthState(sessionDir));
    } catch (err) {
      console.error(`[Baileys] Error creando auth state para ${accountId}:`, err.message || err);
      try { getIO().emit('auth_error', { accountId, message: 'Error al preparar autenticación' }); } catch(e){}
      throw err;
    }

    // Notify frontend that we are attempting to connect
    try { getIO().emit('status_changed', { accountId, status: 'conectando' }); } catch(e){}

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[Baileys] Fetching WA Web Version for ${accountId}: v${version.join('.')} (isLatest: ${isLatest})`);

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }), // Suppress baileys logs
      markOnlineOnConnect: false, // Prevents hanging on initial sync
      syncFullHistory: false, // Prevents hanging on large chats
      browser: Browsers.macOS('Desktop'), // Standard browser string
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
            if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) continue;
            
            const [idPart, domainPart] = remoteJid.split('@');
            const telefono = `${idPart.split(':')[0]}@${domainPart}`;

            await upsertContactData(telefono, nombreReal, !!c.name);

            if (c.lidJid) {
              const [lidId, lidDomain] = c.lidJid.split('@');
              const lidTelefono = `${lidId.split(':')[0]}@${lidDomain || 'lid'}`;
              await upsertContactData(lidTelefono, nombreReal, !!c.name);
              
              // Persist mapping
              try {
                const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
                if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                const mapPath = path.join(uploadsDir, 'lidMap.json');
                let lidMap = {};
                if (fs.existsSync(mapPath)) {
                  lidMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                }
                lidMap[lidTelefono] = telefono;
                fs.writeFileSync(mapPath, JSON.stringify(lidMap, null, 2));
              } catch (err) {
                console.error("Error saving lid mapping", err);
              }
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
        if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) continue;
        
        const [idPart, domainPart] = remoteJid.split('@');
        const telefono = `${idPart.split(':')[0]}@${domainPart}`;

        await upsertContactData(telefono, nombreReal, !!c.name);

        if (c.lidJid) {
          const [lidId, lidDomain] = c.lidJid.split('@');
          const lidTelefono = `${lidId.split(':')[0]}@${lidDomain || 'lid'}`;
          await upsertContactData(lidTelefono, nombreReal, !!c.name);
          
          // Persist mapping
          try {
            const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
            const mapPath = path.join(uploadsDir, 'lidMap.json');
            let lidMap = {};
            if (fs.existsSync(mapPath)) {
              lidMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            }
            lidMap[lidTelefono] = telefono;
            fs.writeFileSync(mapPath, JSON.stringify(lidMap, null, 2));
          } catch (err) {
            console.error("Error saving lid mapping", err);
          }
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
          this.qrs.set(accountId, url);
          try {
            getIO().emit('qr_generated', { accountId, qr: url });
          } catch (e) {
            console.error('Socket.io error emitting QR:', e.message);
          }
        });
      }

      if (connection === 'close') {
        this.qrs.delete(accountId);
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`[Baileys] Connection closed for account ${accountId}. Reconnecting:`, shouldReconnect, 'reason:', lastDisconnect?.error);

        try {
          if (!shouldReconnect) {
            // Update DB state to desconectado ONLY if it's a permanent logout
            await prisma.whatsappAccount.update({
              where: { id: accountId },
              data: { estado: 'desconectado' }
            });
            try { getIO().emit('status_changed', { accountId, status: 'desconectado' }); } catch (e) {}
          }

          if (shouldReconnect) {
            // Exponential backoff reconnect
            const retries = this.startRetries.get(accountId) || 0;
            const delay = Math.min(5 * 60 * 1000, 1000 * Math.pow(2, retries)); // max 5 minutes
            this.startRetries.set(accountId, retries + 1);
            console.log(`[Baileys] Scheduling reconnect for ${accountId} in ${delay}ms (attempt ${retries + 1})`);
            const timerId = setTimeout(() => {
              this.reconnectTimers.delete(accountId);
              this.startSession(accountId).catch(err => {
                console.error(`[Baileys] Reconnect attempt failed for ${accountId}:`, err?.message || err);
              });
            }, delay);
            this.reconnectTimers.set(accountId, timerId);
          } else {
            // Logged out: Delete session directory so a new QR can be generated
            try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch(e){}
            this.sessions.delete(accountId);
            try { getIO().emit('auth_error', { accountId, message: 'Sesión cerrada (logout). Escanea el QR para volver a vincular.' }); } catch(e){}
            
            // Iniciar nueva sesión para que genere un nuevo QR
            const timerId = setTimeout(() => {
              this.reconnectTimers.delete(accountId);
              this.startSession(accountId).catch(console.error);
            }, 1000);
            this.reconnectTimers.set(accountId, timerId);
          }
        } catch (dbError) {
          console.error("DB Error updating account status:", dbError);
        }

      } else if (connection === 'open') {
        this.qrs.delete(accountId);
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
          
          try { getIO().emit('status_changed', { accountId, status: 'conectado' }); } catch (e) {}

          // Reset retry counter on successful open
          this.startRetries.set(accountId, 0);
        } catch (dbError) {
          console.error("DB Error updating account status:", dbError);
        }
      }
    });

    // Save session socket reference
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
        // ALWAYS try to restore the session. Do not delete the session folder just because the DB says 'desconectado'.
        // If the session is truly invalid, Baileys will fire a loggedOut disconnect event which handles deletion.
        await this.startSession(acc.id);
      }
    } catch (error) {
      console.error("[Baileys] Error restoring sessions on startup:", error);
    }
  }
}

// Export as singleton
module.exports = new WhatsAppService();
