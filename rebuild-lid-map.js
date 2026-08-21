const fs = require('fs');
const path = require('path');

async function rebuildLidMap() {
  const sessionsDir = path.join(__dirname, 'src', 'sessions'); // Or just 'sessions' depending on where it is. Wait, in fixLidContacts it says: path.join(__dirname, 'sessions');
  const actualSessionsDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(actualSessionsDir)) {
    console.log("No sessions dir");
    return;
  }

  const mapPath = path.join(__dirname, 'public', 'uploads', 'lidMap.json');
  let lidMap = {};
  if (fs.existsSync(mapPath)) {
    lidMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  }

  const sessionFolders = fs.readdirSync(actualSessionsDir);
  for (const folder of sessionFolders) {
    const folderPath = path.join(actualSessionsDir, folder);
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
          lidMap[lidTelefono] = realTelefono;
        } catch(e) {}
      }
    }
  }

  fs.writeFileSync(mapPath, JSON.stringify(lidMap, null, 2));
  console.log(`Rebuilt lidMap.json with ${Object.keys(lidMap).length} entries.`);
}

rebuildLidMap();
