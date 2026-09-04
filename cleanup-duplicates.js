// Fusiona automáticamente contactos @lid con su contacto real (@s.whatsapp.net)
// usando ÚNICAMENTE el mapeo oficial y nativo de Baileys/WhatsApp
// (sock.signalRepository.lidMapping), nunca por coincidencia de nombre:
// dos clientes distintos pueden llamarse igual y eso causaría fusiones
// incorrectas mezclando las conversaciones de personas distintas.
//
// Se ejecuta al arrancar el server y periódicamente (ver server.js) para que
// los chats duplicados de un mismo cliente se autocorrijan sin intervención
// manual, sin importar si el server se reinicia, se recarga la página o se
// apaga/prende la PC.
const fs = require('fs');
const path = require('path');
const prisma = require('./src/config/prisma');
const whatsappService = require('./src/services/whatsapp.service');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
const mapPath = path.join(uploadsDir, 'lidMap.json');

// Quita el sufijo de dispositivo (":0", ":12", etc.) que Baileys a veces
// incluye en los JID internos, igual que en inbound.service.js.
const normalizeJid = (jid) => {
  if (!jid || typeof jid !== 'string') return jid;
  const [idPart, domainPart] = jid.split('@');
  return `${idPart.split(':')[0]}@${domainPart}`;
};

function saveLidMapping(lidTelefono, realTelefono) {
  try {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const lidMap = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};
    lidMap[lidTelefono] = realTelefono;
    fs.writeFileSync(mapPath, JSON.stringify(lidMap, null, 2));
  } catch (e) {
    console.error('[Cleanup Duplicates] Error guardando lidMap:', e.message);
  }
}

// Intenta resolver un JID @lid al número real preguntándole a Baileys
// directamente (la fuente de verdad que da WhatsApp), probando con las
// cuentas de WhatsApp donde ese contacto tiene conversación.
async function resolveLidNatively(lidTelefono, accountIds) {
  for (const accountId of accountIds) {
    const sock = whatsappService.getSession(accountId);
    if (!sock?.signalRepository?.lidMapping) continue;
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(lidTelefono);
      if (pn) return normalizeJid(pn);
    } catch (e) {
      // Ignorar y probar con la siguiente cuenta
    }
  }
  return null;
}

async function mergeDuplicates() {
  try {
    const lidContactos = await prisma.contacto.findMany({
      where: { telefono: { endsWith: '@lid' } },
      include: { conversaciones: { select: { whatsappAccountId: true } } }
    });

    let fusionados = 0;
    for (const c of lidContactos) {
      const accountIds = [...new Set(c.conversaciones.map(cv => cv.whatsappAccountId))];

      // 1) Usar la caché ya confirmada (lidMap.json) si existe
      let realTelefono = null;
      try {
        if (fs.existsSync(mapPath)) {
          const lidMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
          if (lidMap[c.telefono]) realTelefono = normalizeJid(lidMap[c.telefono]);
        }
      } catch (e) {}

      // 2) Si no hay caché, preguntarle a Baileys directamente
      if (!realTelefono) {
        realTelefono = await resolveLidNatively(c.telefono, accountIds);
      }

      // Sin mapeo real confirmado por WhatsApp: no se fusiona (evita adivinar por nombre)
      if (!realTelefono) continue;

      await whatsappService.mergeLidContact(c.telefono, realTelefono);
      saveLidMapping(c.telefono, realTelefono);
      fusionados++;
    }

    if (fusionados > 0) {
      console.log(`[Cleanup Duplicates] ${fusionados} contacto(s) @lid fusionados con su contacto real (mapeo nativo de WhatsApp).`);
    }
    return fusionados;
  } catch (e) {
    console.error('[Cleanup Duplicates] Error:', e.message);
    return 0;
  }
}

module.exports = { mergeDuplicates };
