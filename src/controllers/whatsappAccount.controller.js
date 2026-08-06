const prisma = require("../config/prisma");
const whatsappService = require("../services/whatsapp.service");
const fs = require("fs");
const path = require("path");
// Obtener todas las cuentas
const getAccounts = async (req, res) => {
  try {
    const accounts = await prisma.whatsappAccount.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    const accountsWithQrs = accounts.map(acc => ({
      ...acc,
      qr: whatsappService.qrs.get(acc.id) || null
    }));

    res.json(accountsWithQrs);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });
  }
};

// Obtener una cuenta
const getAccountById = async (req, res) => {
  try {
    const { id } = req.params;

    const account =
      await prisma.whatsappAccount.findUnique({
        where: { id },
      });

    if (!account) {
      return res.status(404).json({
        message: "Cuenta no encontrada",
      });
    }

    res.json(account);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });

  }
};

// Crear cuenta dinámicamente (sin número al inicio)
const createAccount = async (req, res) => {
  try {
    const { nombre } = req.body;

    const account = await prisma.whatsappAccount.create({
      data: {
        nombre,
        numero: null,
        estado: "conectando",
      },
    });

    // Iniciar sesión en Baileys
    whatsappService.startSession(account.id);

    res.status(201).json(account);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });

  }
};

// Actualizar cuenta
const updateAccount = async (req, res) => {
  try {

    const { id } = req.params;

    const {
      nombre,
      numero,
      estado,
    } = req.body;

    const account =
      await prisma.whatsappAccount.update({
        where: { id },
        data: {
          nombre,
          numero,
          estado,
        },
      });

    res.json(account);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });

  }
};

// Eliminar cuenta
const deleteAccount = async (req, res) => {
  try {

    const { id } = req.params;

    // Detener sesión si existe y eliminar archivos
    const sessionDir = path.join(__dirname, "..", "..", "sessions", id);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    // Delete from memory
    whatsappService.sessions.delete(id);

    await prisma.whatsappAccount.delete({
      where: { id },
    });

    res.json({
      message: "Cuenta eliminada",
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });

  }
};

// Cerrar sesión
const logoutAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const sock = whatsappService.getSession(id);
    
    if (sock) {
      await sock.logout(); // Esto invalida la sesión en WhatsApp Web
      // Esperar un segundo para que Baileys procese el evento de cierre y borre el directorio
      setTimeout(() => {
        whatsappService.startSession(id); // Reiniciar para generar un nuevo QR
      }, 2000);
      res.json({ message: "Sesión de WhatsApp cerrada correctamente" });
    } else {
      // Si el socket no está corriendo pero hay sesión guardada
      const sessionDir = path.join(whatsappService.sessionsBase, id);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      whatsappService.startSession(id);
      res.json({ message: "Directorio limpiado. Generando nuevo QR..." });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error interno al cerrar sesión" });
  }
};

// Forzar reinicio de sesión LIMPIO: cierra socket, borra directorio y genera nuevo QR
const resetSession = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await prisma.whatsappAccount.findUnique({ where: { id } });
    if (!account) return res.status(404).json({ message: 'Cuenta no encontrada' });

    // 1. Cerrar socket existente si hay uno
    const existingSock = whatsappService.sessions.get(id);
    if (existingSock) {
      try { existingSock.ev.removeAllListeners(); } catch(e) {}
      try { existingSock.ws.close(); } catch(e) {}
      whatsappService.sessions.delete(id);
    }

    // 2. Cancelar timers de reconexión pendientes
    if (whatsappService.reconnectTimers.has(id)) {
      clearTimeout(whatsappService.reconnectTimers.get(id));
      whatsappService.reconnectTimers.delete(id);
    }

    // 3. Borrar el directorio de sesión completamente
    const sessionDir = path.join(whatsappService.sessionsBase, id);
    console.log(`[Reset] Borrando sesión: ${sessionDir}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[Reset] Directorio borrado exitosamente`);
    }

    // 4. Marcar como desconectado en DB
    await prisma.whatsappAccount.update({
      where: { id },
      data: { estado: 'desconectado' }
    });

    // 5. Iniciar sesión limpia para generar nuevo QR
    setTimeout(() => {
      whatsappService.startSession(id).catch(console.error);
    }, 500);

    res.json({ message: 'Sesión reseteada. Generando nuevo QR...' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error interno al reiniciar sesión' });
  }
};

module.exports = {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  logoutAccount,
  resetSession,
};