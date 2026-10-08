const router = require('express').Router();

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const { authLimiter } = require('../middlewares/rateLimit.middleware');

const {
  register,
    login
} = require('../controllers/auth.controller');

// Solo un admin ya logueado puede crear usuarios nuevos (evita que cualquiera se cree una cuenta admin)
router.post('/register', authMiddleware, roleMiddleware('admin'), register);
router.post("/login", authLimiter, login);

module.exports = router;
