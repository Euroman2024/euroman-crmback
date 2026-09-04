-- Marca si un mensaje fue eliminado (para todos), sin borrar la fila para poder mostrar el aviso "Se eliminó este mensaje"
ALTER TABLE "Mensaje" ADD COLUMN "eliminado" BOOLEAN NOT NULL DEFAULT false;
