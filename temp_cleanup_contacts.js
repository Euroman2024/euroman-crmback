const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const result = await prisma.contacto.updateMany({
      where: { nombre: { in: ['Desconocido', 'desconocido', 'Unknown', 'unknown'] } },
      data: { nombre: null }
    });
    console.log('Resultado:', result);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
