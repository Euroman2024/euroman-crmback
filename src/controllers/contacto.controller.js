const prisma = require("../config/prisma");
const fs = require("fs");
const path = require("path");
const { getIO } = require("../services/socket.service");

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

const mergeContactos = async (req, res) => {
  try {
    const { sourceId, targetId } = req.body;

    if (!sourceId || !targetId || sourceId === targetId) {
      return res.status(400).json({ message: "IDs inválidos para fusión" });
    }

    const sourceContact = await prisma.contacto.findUnique({
      where: { id: sourceId },
      include: { conversaciones: true }
    });

    const targetContact = await prisma.contacto.findUnique({
      where: { id: targetId },
      include: { conversaciones: true }
    });

    if (!sourceContact || !targetContact) {
      return res.status(404).json({ message: "Contactos no encontrados" });
    }

    // Merge conversations
    for (const sourceConv of sourceContact.conversaciones) {
      const targetConv = targetContact.conversaciones.find(c => c.whatsappAccountId === sourceConv.whatsappAccountId);
      if (targetConv) {
        // Move messages to existing target conversation
        await prisma.mensaje.updateMany({
          where: { conversacionId: sourceConv.id },
          data: { conversacionId: targetConv.id }
        });
        await prisma.conversacion.delete({ where: { id: sourceConv.id } });
        try { getIO().emit('conversation_merged', { oldId: sourceConv.id, newId: targetConv.id }); } catch(_) {}
      } else {
        // Move conversation to target contact
        await prisma.conversacion.update({
          where: { id: sourceConv.id },
          data: { contactoId: targetContact.id }
        });
        try { getIO().emit('conversation_merged', { oldId: sourceConv.id, newId: sourceConv.id }); } catch(_) {} // Refresh UI
      }
    }

    // Instead of deleting, mark it
    await prisma.contacto.update({ 
      where: { id: sourceId },
      data: { nombre: `MERGED_TO:${targetContact.telefono}` }
    });

    // Update lidMap.json if source was a LID
    if (sourceContact.telefono.endsWith('@lid') && !targetContact.telefono.endsWith('@lid')) {
      try {
        const uploadDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const mapPath = path.join(uploadDir, 'lidMap.json');
        let lidMap = {};
        if (fs.existsSync(mapPath)) {
          lidMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        }
        lidMap[sourceContact.telefono] = targetContact.telefono;
        fs.writeFileSync(mapPath, JSON.stringify(lidMap, null, 2));
      } catch (err) {
        console.error("Error updating lidMap during merge", err);
      }
    }

    res.json({ message: "Fusión completada exitosamente", targetContact });
  } catch (error) {
    console.error("Error al fusionar contactos:", error);
    res.status(500).json({ message: "Error al fusionar contactos" });
  }
};

const searchContactos = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const contactos = await prisma.contacto.findMany({
      where: {
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { telefono: { contains: q } }
        ]
      },
      take: 10
    });
    res.json(contactos);
  } catch (error) {
    res.status(500).json({ message: "Error en búsqueda" });
  }
};

module.exports = {
  updateContacto,
  mergeContactos,
  searchContactos
};
