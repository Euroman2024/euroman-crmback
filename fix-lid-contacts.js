const fs = require('fs');
const path = require('path');
const prisma = require('./src/config/prisma');
async function fixLidContacts() {
  console.log('[Init] Starting LID contacts cleanup...');
  const sessionsDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(sessionsDir)) return;

  const sessionFolders = fs.readdirSync(sessionsDir);
  let updatedCount = 0;

  for (const folder of sessionFolders) {
    const folderPath = path.join(sessionsDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      if (file.startsWith('lid-mapping-') && file.endsWith('.json')) {
        const realPhonePart = file.replace('lid-mapping-', '').replace('.json', '');
        const realTelefono = `${realPhonePart}@s.whatsapp.net`;
        
        try {
          const content = fs.readFileSync(path.join(folderPath, file), 'utf8');
          const lidValue = JSON.parse(content);
          const lidTelefono = `${lidValue}@lid`;

          // Find real contact
          const realContact = await prisma.contacto.findUnique({ where: { telefono: realTelefono } });
          if (realContact && realContact.nombre) {
            // Check if lid contact exists
            const lidContact = await prisma.contacto.findUnique({ where: { telefono: lidTelefono } });
            if (lidContact && lidContact.nombre !== realContact.nombre) {
              await prisma.contacto.update({
                where: { telefono: lidTelefono },
                data: { nombre: realContact.nombre }
              });
              console.log(`Updated LID ${lidTelefono} with name ${realContact.nombre}`);
              updatedCount++;
            }
          }
        } catch (err) {
          console.error(`Error processing ${file}:`, err);
        }
      }
    }
  }
  
  console.log(`[Init] Done! Updated ${updatedCount} LID contacts.`);
}

module.exports = { fixLidContacts };
