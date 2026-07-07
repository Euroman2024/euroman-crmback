const router = require("express").Router();

const authMiddleware =
require("../middlewares/auth.middleware");

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
  createAccount
);

router.put(
  "/:id",
  authMiddleware,
  updateAccount
);

router.delete(
  "/:id",
  authMiddleware,
  deleteAccount
);

router.post(
  "/:id/logout",
  authMiddleware,
  logoutAccount
);

module.exports = router;