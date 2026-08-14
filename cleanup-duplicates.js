const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function mergeDuplicates() {
  console.log('Starting duplicate merge process...');
  
  // Encontrar contactos con @lid
  const lidContacts = await prisma.contacto.findMany({
    where: { telefono: { endsWith: '@lid' } },
    include: { conversaciones: { include: { mensajes: true } } }
  });

  console.log(`Encontrados ${lidContacts.length} contactos @lid para revisar.`);

  for (const lidContact of lidContacts) {
    if (!lidContact.nombre || lidContact.nombre.trim() === '') continue;

    const mainContact = await prisma.contacto.findFirst({
      where: {
        nombre: lidContact.nombre,
        telefono: { not: { endsWith: '@lid' } }
      },
      include: { conversaciones: true }
    });

    if (mainContact) {
      console.log(`[MERGE] Fusionando '${lidContact.nombre}' (${lidContact.telefono}) -> (${mainContact.telefono})`);
      
      for (const lidConv of lidContact.conversaciones) {
        let targetConv = mainContact.conversaciones.find(c => c.whatsappAccountId === lidConv.whatsappAccountId);
        
        if (!targetConv) {
          await prisma.conversacion.update({
            where: { id: lidConv.id },
            data: { contactoId: mainContact.id }
          });
        } else {
          await prisma.mensaje.updateMany({
            where: { conversacionId: lidConv.id },
            data: { conversacionId: targetConv.id }
          });
          await prisma.conversacion.delete({ where: { id: lidConv.id } });
        }
      }
      
      await prisma.contacto.delete({ where: { id: lidContact.id } });
      console.log(`[MERGE OK] Contacto @lid eliminado.`);
    }
  }

  const allContacts = await prisma.contacto.findMany();
  for (const contact of allContacts) {
    if (contact.nombre && contact.nombre.endsWith(' 2')) {
      const originalName = contact.nombre.slice(0, -2).trim();
      const original = allContacts.find(c => c.nombre === originalName);
      if (original) {
         console.log(`[MERGE] Fusionando '${contact.nombre}' con '${original.nombre}'...`);
         const contactConvs = await prisma.conversacion.findMany({ where: { contactoId: contact.id } });
         for (const conv of contactConvs) {
           await prisma.conversacion.update({
             where: { id: conv.id },
             data: { contactoId: original.id }
           });
         }
         await prisma.contacto.delete({ where: { id: contact.id } });
      }
    }
  }

  console.log('Duplicate merge complete.');
}

mergeDuplicates().catch(console.error).finally(() => prisma.$disconnect());
