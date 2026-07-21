const prisma = require("../config/prisma");

const updateContacto = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;

    const contacto = await prisma.contacto.update({
      where: { id },
      data: { nombre }
    });

    res.json(contacto);
  } catch (error) {
    console.error("Error al actualizar contacto:", error);
    res.status(500).json({ message: "Error al actualizar contacto" });
  }
};

module.exports = {
  updateContacto
};
