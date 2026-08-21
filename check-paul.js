const p = require('./src/config/prisma');

async function check() {
  const c1 = await p.contacto.findUnique({ where: { telefono: '200335024992306@lid' }, include: { conversaciones: { include: { mensajes: { orderBy: { createdAt: 'desc' }, take: 2 } } } } });
  const c2 = await p.contacto.findUnique({ where: { telefono: '593978954385@s.whatsapp.net' }, include: { conversaciones: { include: { mensajes: { orderBy: { createdAt: 'desc' }, take: 2 } } } } });

  console.log("LID contact:", JSON.stringify(c1, null, 2));
  console.log("Real contact:", JSON.stringify(c2, null, 2));
}

check().catch(console.error).finally(()=>p.$disconnect());
