let io;

const initSocket = (server) => {

  const { Server } = require("socket.io");

  io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {

    console.log(
      `Cliente conectado: ${socket.id}`
    );

    socket.on("disconnect", () => {

      console.log(
        `Cliente desconectado: ${socket.id}`
      );

    });

  });

};

const getIO = () => {

  if (!io) {
    throw new Error(
      "Socket.io no inicializado"
    );
  }

  return io;
};

module.exports = {
  initSocket,
  getIO,
};