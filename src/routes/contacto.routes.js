const { Router } = require("express");
const { updateContacto } = require("../controllers/contacto.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

router.put("/:id", authMiddleware, updateContacto);

module.exports = router;
