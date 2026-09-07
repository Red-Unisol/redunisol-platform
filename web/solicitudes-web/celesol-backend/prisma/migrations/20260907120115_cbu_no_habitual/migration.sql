-- CBU de la cuenta a la que transferir cuando no es la habitual del socio.
-- El campo ya existia en el formulario de alta pero nunca se persistia: el
-- vendedor lo cargaba y se perdia al enviar la solicitud.
--
-- Nullable a proposito: la mayoria de las solicitudes transfiere a la cuenta
-- habitual y no lo completa.
ALTER TABLE "solicitud_titulares" ADD COLUMN "cbu_no_habitual" TEXT;
