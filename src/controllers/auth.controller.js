const prisma = require('../config/prisma');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {

  try {

    const { nombre, email, password } = req.body;

    const userExists = await prisma.usuario.findUnique({
      where: {
        email
      }
    });

    if (userExists) {
      return res.status(400).json({
        message: 'El usuario ya existe'
      });
    }

    const hashedPassword =
      await bcrypt.hash(password, 10);

    const user = await prisma.usuario.create({
      data: {
        nombre,
        email,
        password: hashedPassword,
        rol: 'admin'
      }
    });

    res.status(201).json(user);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: 'Error interno'
    });

  }

};
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.usuario.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({
        message: "Credenciales incorrectas"
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password
    );

    if (!validPassword) {
      return res.status(401).json({
        message: "Credenciales incorrectas"
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        rol: user.rol
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error interno"
    });
  }
};


module.exports = {
  register,
  login
};
