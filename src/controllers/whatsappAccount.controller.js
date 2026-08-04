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

    res.json(accounts);
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
      const sessionDir = path.join(__dirname, "..", "..", "sessions", id);
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

// Forzar reinicio de sesión: borrar directorio de sesión y reiniciar startSession
const resetSession = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await prisma.whatsappAccount.findUnique({ where: { id } });
    if (!account) return res.status(404).json({ message: 'Cuenta no encontrada' });

    if (account.estado === 'conectado') {
      return res.status(400).json({ message: 'Cuenta ya conectada' });
    }

    const sessionDir = path.join(__dirname, "..", "..", "sessions", id);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    // Remove from in-memory map if present
    whatsappService.sessions.delete(id);

    // Start session to generate QR
    whatsappService.startSession(id);

    res.json({ message: 'Reinicio solicitado. Si hay QR se emitirá al frontend.' });
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