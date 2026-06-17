const router = require("express").Router();

const {
  sendTestEvent,
} = require("../controllers/socket.controller");

router.get("/test", sendTestEvent);

module.exports = router;