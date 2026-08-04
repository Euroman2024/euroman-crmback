const router = require("express").Router();

const authMiddleware =
require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

const {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  logoutAccount,
} = require(
  "../controllers/whatsappAccount.controller"
);

router.get(
  "/",
  authMiddleware,
  getAccounts
);

router.get(
  "/:id",
  authMiddleware,
  getAccountById
);

router.post(
  "/",
  authMiddleware,
  roleMiddleware('admin'),
  createAccount
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware('admin'),
  updateAccount
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware('admin'),
  deleteAccount
);

router.post(
  "/:id/logout",
  authMiddleware,
  roleMiddleware('admin'),
  logoutAccount
);

// Forzar reinicio de sesión (genera QR si se necesita). Permitir a usuarios autenticados usarlo cuando la cuenta esté desconectada.
router.post(
  "/:id/reset",
  authMiddleware,
  resetSession
);

module.exports = router;