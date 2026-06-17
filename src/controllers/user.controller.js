const prisma = require("../config/prisma");
const bcrypt = require("bcrypt");

// Obtener todos los usuarios
const getUsers = async (req, res) => {
  try {
    const users = await prisma.usuario.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(users);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });
  }
};

// Obtener usuario por ID
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

    res.json(user);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });
  }
};

// Crear usuario
const createUser = async (req, res) => {
  try {
    const {
      nombre,
      email,
      password,
      rol,
    } = req.body;

    const exists = await prisma.usuario.findUnique({
      where: { email },
    });

    if (exists) {
      return res.status(400).json({
        message: "El email ya existe",
      });
    }

    const hashedPassword =
      await bcrypt.hash(password, 10);

    const user = await prisma.usuario.create({
      data: {
        nombre,
        email,
        password: hashedPassword,
        rol,
      },
    });

    res.status(201).json(user);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });
  }
};

// Actualizar usuario
const updateUser = async (req, res) => {
  try {

    const { id } = req.params;

    const {
      nombre,
      email,
      rol,
      activo,
    } = req.body;

    const user =
      await prisma.usuario.update({
        where: { id },
        data: {
          nombre,
          email,
          rol,
          activo,
        },
      });

    res.json(user);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });

  }
};

// Desactivar usuario
const deleteUser = async (req, res) => {
  try {

    const { id } = req.params;

    await prisma.usuario.update({
      where: { id },
      data: {
        activo: false,
      },
    });

    res.json({
      message: "Usuario desactivado",
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Error interno",
    });

  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};