const fs = require('fs');
const path = require('path');

let telefono = '200335024992306@lid';
const isLid = true;

if (isLid) {
  try {
    const mapPath = path.join(__dirname, 'public', 'uploads', 'lidMap.json');
    if (fs.existsSync(mapPath)) {
      const lidMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      if (lidMap[telefono]) {
        console.log("MAPPED TO:", lidMap[telefono]);
        telefono = lidMap[telefono];
      } else {
        console.log("NOT FOUND IN MAP");
      }
    } else {
      console.log("MAP FILE NOT FOUND", mapPath);
    }
  } catch (e) {
    console.error("Error resolving lid mapping", e);
  }
}
console.log("FINAL TELEFONO:", telefono);
