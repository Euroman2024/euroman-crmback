const { getIO } =
require("../sockets/socket");

const sendTestEvent =
(req, res) => {

  const io = getIO();

  io.emit("test_event", {
    message:
      "Hola desde el backend",
    date: new Date(),
  });

  res.json({
    message: "Evento enviado",
  });

};

module.exports = {
  sendTestEvent,
};