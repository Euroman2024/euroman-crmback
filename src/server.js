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

server.listen(PORT, async () => {

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

  // Iniciar todas las sesiones guardadas
  await whatsappService.restoreSessions();

});