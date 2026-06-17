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

  // Iniciar todas las sesiones guardadas
  await whatsappService.restoreSessions();

});