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

// Crear cuenta
const createAccount = async (req, res) => {
  try {

    const {
      nombre,
      numero,
    } = req.body;

    const account =
      await prisma.whatsappAccount.create({
        data: {
          nombre,
          numero,
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

module.exports = {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
};