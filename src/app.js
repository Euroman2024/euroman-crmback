const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const socketRoutes = require('./routes/socket.routes');
const whatsappAccountRoutes = require("./routes/whatsappAccount.routes");
const conversacionRoutes = require("./routes/conversacion.routes");
const mensajeRoutes = require("./routes/mensaje.routes");
const contactoRoutes = require("./routes/contacto.routes");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'https://euroman-crmfront-two.vercel.app,http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Permite peticiones sin origin (curl, apps móviles, Postman)
    callback(null, !origin || allowedOrigins.includes(origin));
  }
}));

app.use(express.json());

// Servir archivos estáticos para probar Sockets/QRs
app.use(express.static('public'));

const path = require('path');
const fs = require('fs');
// Servir directorio de uploads, permitiendo configuración por variable de entorno para volúmenes persistentes
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/socket', socketRoutes);
app.use('/api/whatsapp-accounts', whatsappAccountRoutes);
app.use('/api/conversaciones', conversacionRoutes);
app.use('/api/messages', mensajeRoutes);
app.use('/api/contactos', contactoRoutes);

module.exports = app;