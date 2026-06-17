const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/prisma');
const qrcode = require('qrcode');
const { getIO } = require('../sockets/socket');

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
          await prisma.whatsappAccount.update({
            where: { id: accountId },
            data: { estado: 'conectado' }
          });
          
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
