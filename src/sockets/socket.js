let io;

const initSocket = (server) => {

  const { Server } = require("socket.io");
  const jwt = require("jsonwebtoken");

  const allowedOrigins = (process.env.CORS_ORIGINS || 'https://euroman-crmfront-two.vercel.app,http://localhost:5173,http://localhost:3000')
    .split(',')
    .map(o => o.trim());

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
    },
  });

  // Exige un JWT válido para conectar: evita que cualquiera reciba QRs y mensajes en tiempo real sin loguearse
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Token requerido"));
    }
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error("Token inválido"));
    }
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