const p=require('./src/config/prisma');
async function f(){
  const lidC = await p.contacto.findUnique({where:{telefono:'200335024992306@lid'},include:{conversaciones:true}});
  if(lidC){
    const realC = await p.contacto.findUnique({where:{telefono:'593978954385@s.whatsapp.net'},include:{conversaciones:true}});
    if(realC && lidC.conversaciones.length>0 && realC.conversaciones.length>0){
      await p.mensaje.updateMany({where:{conversacionId:lidC.conversaciones[0].id},data:{conversacionId:realC.conversaciones[0].id}});
      await p.conversacion.delete({where:{id:lidC.conversaciones[0].id}});
      await p.contacto.delete({where:{id:lidC.id}});
      console.log('Merged!');
    }
  }
}
f().catch(console.error).finally(()=>p.$disconnect());
