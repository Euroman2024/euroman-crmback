const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const socketRoutes = require('./routes/socket.routes');
const whatsappAccountRoutes = require("./routes/whatsappAccount.routes");
const app = express();

app.use(cors());

app.use(express.json());

// Servir archivos estáticos para probar Sockets/QRs
app.use(express.static('public'));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/socket', socketRoutes);
app.use('/api/whatsapp-accounts', whatsappAccountRoutes);

module.exports = app;