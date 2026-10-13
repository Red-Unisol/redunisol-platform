import assert from "node:assert/strict";
import { it } from "node:test";
import { filtrarHistorialSolicitudes } from "./filtrar-historial-solicitudes";
import type { SolicitudDelTitular } from "../services/solicitudes-core-api";
const rows = [
 {nroSolicitud:"1",fecha:"2024-02-01T00:00:00",estado:"Revisión",nombreCompleto:"José Pérez"},
 {nroSolicitud:"2",fecha:null,estado:"Revisión",nombreCompleto:"María"},
 {nroSolicitud:"3",fecha:"2026-10-11T12:00:00",estado:"Pagada",nombreCompleto:"José Pérez"},
 {nroSolicitud:"4",fecha:"2026-10-11T17:00:00",estado:"Revisión",nombreCompleto:"José Pérez"},
 {nroSolicitud:"5",fecha:"inválida",estado:null,nombreCompleto:null},
] as SolicitudDelTitular[];
it("ordena por fecha y hora descendente sin mutar; fechas ausentes o inválidas al final",()=>{
 assert.deepEqual(filtrarHistorialSolicitudes(rows,"","").map(r=>r.nroSolicitud),["4","3","1","2","5"]);
 assert.equal(rows[0].nroSolicitud,"1");
});
it("combina búsqueda sin acentos y estado, conserva el orden y permite limpiar",()=>{
 assert.deepEqual(filtrarHistorialSolicitudes(rows,"PEREZ jose","Revisión").map(r=>r.nroSolicitud),["4","1"]);
 assert.equal(filtrarHistorialSolicitudes(rows,"inexistente","").length,0);
 assert.equal(filtrarHistorialSolicitudes(rows,"","").length,5);
});
