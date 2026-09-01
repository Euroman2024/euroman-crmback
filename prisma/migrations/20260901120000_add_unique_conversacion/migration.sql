-- Evita que se puedan crear dos conversaciones para el mismo contacto en la misma cuenta de WhatsApp
CREATE UNIQUE INDEX "Conversacion_contactoId_whatsappAccountId_key" ON "Conversacion"("contactoId", "whatsappAccountId");
