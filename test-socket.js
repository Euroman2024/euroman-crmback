const { io } = require("socket.io-client");

const socket = io("http://localhost:3000");

socket.on("connect", () => {
  console.log("Conectado:", socket.id);
});

socket.on("test_event", (data) => {
  console.log(data);
});