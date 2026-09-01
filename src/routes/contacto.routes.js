const { Router } = require("express");
const { updateContacto, mergeContactos, searchContactos } = require("../controllers/contacto.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

router.get("/search", authMiddleware, searchContactos);
router.post("/merge", authMiddleware, mergeContactos);
router.put("/:id", authMiddleware, updateContacto);

module.exports = router;
