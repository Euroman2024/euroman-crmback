const router = require("express").Router();

const authMiddleware =
require("../middlewares/auth.middleware");
const roleMiddleware =
require("../middlewares/role.middleware");

const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} = require("../controllers/user.controller");

router.get(
  "/",
  authMiddleware,
  getUsers
);

router.get(
  "/:id",
  authMiddleware,
  getUserById
);

router.post(
  "/",
  authMiddleware,
  roleMiddleware("admin"),
  createUser
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  updateUser
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  deleteUser
);

module.exports = router;