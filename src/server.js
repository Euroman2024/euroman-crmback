require("dotenv").config();

const http = require("http");

const app = require("./app");

const {
  initSocket,
} = require("./sockets/socket");

const server = http.createServer(app);

initSocket(server);

const PORT =
  process.env.PORT || 3000;

const whatsappService = require('./services/whatsapp.service');

server.listen(PORT, '0.0.0.0', async () => {

  console.log(
    `Server running on ${PORT}`
  );

  // Ejecutar limpieza de LIDs usando los archivos locales de sesión
  try {
    const { fixLidContacts } = require('../fix-lid-contacts');
    await fixLidContacts();
  } catch (err) {
    console.error('Error in fixLidContacts:', err);
  }

  // Fusionar contactos @lid duplicados contra @s.whatsapp.net por nombre
  try {
    const { mergeDuplicates } = require('../cleanup-duplicates');
    if (mergeDuplicates) await mergeDuplicates();
  } catch (err) {
    // cleanup-duplicates.js puede no exportar la función si se ejecuta como script
  }

  // Iniciar todas las sesiones guardadas
  await whatsappService.restoreSessions();

  // ====== AUTO-HEAL: Limpiar chats MERGED_TO cada 5 minutos ======
  // Asegura que nunca queden chats "MERGED_TO:" visibles en el CRM.
  // Si un mensaje llega a un contacto fusionado, este job lo mueve al chat real.
  const autoHealMergedContacts = async () => {
    try {
      const prisma = require('./config/prisma');
      const mergedWithConvs = await prisma.contacto.findMany({
        where: { nombre: { startsWith: 'MERGED_TO:' }, conversaciones: { some: {} } },
        include: { conversaciones: true }
      });
      if (mergedWithConvs.length > 0) {
        console.log(`[Auto-Heal] Reparando ${mergedWithConvs.length} contactos MERGED_TO con conversaciones...`);
        for (const mc of mergedWithConvs) {
          const realTelefono = mc.nombre.replace('MERGED_TO:', '').trim();
          if (realTelefono.includes('_reverse') || realTelefono === '__UNKNOWN__') {
            // Restaurar como contacto LID sin nombre (sin destino real)
            await prisma.contacto.update({ where: { id: mc.id }, data: { nombre: null } });
            continue;
          }
          const real = await prisma.contacto.findUnique({ where: { telefono: realTelefono }, include: { conversaciones: true } });
          if (!real || real.nombre?.startsWith('MERGED_TO:')) continue;
          for (const c of mc.conversaciones) {
            const rc = real.conversaciones.find(x => x.whatsappAccountId === c.whatsappAccountId);
            if (rc) {
              await prisma.mensaje.updateMany({ where: { conversacionId: c.id }, data: { conversacionId: rc.id } });
              await prisma.conversacion.delete({ where: { id: c.id } });
              console.log(`[Auto-Heal] Movido: ${mc.telefono} -> ${real.telefono}`);
            } else {
              await prisma.conversacion.update({ where: { id: c.id }, data: { contactoId: real.id } });
              console.log(`[Auto-Heal] Reasignado: ${mc.telefono} -> ${real.telefono}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('[Auto-Heal] Error:', err.message);
    }
  };

  // Ejecutar al inicio y luego cada 5 minutos
  autoHealMergedContacts();
  setInterval(autoHealMergedContacts, 5 * 60 * 1000);
  // ============================================================

});