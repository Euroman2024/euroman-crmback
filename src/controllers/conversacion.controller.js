const prisma = require("../config/prisma");
const { fixLidContacts } = require("../../fix-lid-contacts");

const isUnknownContactName = (name) => {
  if (!name) return true;
  return /^(desconocido|unknown|whatsapp business|whatsapp user|unregistered)$/i.test(String(name).trim());
};

const normalizeContacto = (contacto) => {
  if (!contacto) return contacto;
  const name = contacto.nombre?.trim();
  if (!name || isUnknownContactName(name)) {
    return {
      ...contacto,
      nombre: null
    };
  }
  return contacto;
};

// Listar conversaciones activas
const getConversaciones = async (req, res) => {
  try {
    // Sincronizar nombres LID en segundo plano cada vez que cargan la página
    fixLidContacts().catch(err => console.error("Error background lid fix:", err));

    const conversaciones = await prisma.conversacion.findMany({
      include: {
        contacto: true,
        whatsappAccount: {
          select: { id: true, nombre: true, estado: true }
        },
        usuario: { // vendedor asignado
          select: { id: true, nombre: true }
        },
        mensajes: {
          orderBy: { createdAt: 'desc' },
          take: 1 // Último mensaje para mostrar en la lista (snippet)
        }
      }
    });

    // Ordenar en memoria por la fecha real del último mensaje (garantiza el mismo orden que WhatsApp)
    conversaciones.sort((a, b) => {
      const dateA = a.mensajes && a.mensajes.length > 0 ? new Date(a.mensajes[0].createdAt).getTime() : new Date(a.createdAt).getTime();
      const dateB = b.mensajes && b.mensajes.length > 0 ? new Date(b.mensajes[0].createdAt).getTime() : new Date(b.createdAt).getTime();
      return dateB - dateA; // Descendente (más nuevos primero)
    });

    const normalized = conversaciones.map((conv) => ({
      ...conv,
      contacto: normalizeContacto(conv.contacto)
    }));
    res.json(normalized);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener conversaciones" });
  }
};

// Obtener todo el historial de mensajes de una conversación
const getMensajesByConversacionId = async (req, res) => {
  try {
    const { id } = req.params;
    const mensajes = await prisma.mensaje.findMany({
      where: { conversacionId: id },
      orderBy: { createdAt: 'asc' }
    });
    
    // Si se abren los mensajes, cambiar estado de "nuevo" a "leido" si queremos
    await prisma.conversacion.update({
      where: { id },
      data: { estado: 'leido' }
    });

    res.json(mensajes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener historial" });
  }
};

// Cambiar estado o asignar vendedor
const updateConversacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, asignadoA } = req.body;

    const conversacion = await prisma.conversacion.update({
      where: { id },
      data: {
        ...(estado && { estado }),
        ...(asignadoA !== undefined && { asignadoA }) // Puede ser null para desasignar
      }
    });

    res.json(conversacion);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al actualizar conversación" });
  }
};

module.exports = {
  getConversaciones,
  getMensajesByConversacionId,
  updateConversacion
};
