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

});