from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from openpyxl import Workbook  # noqa: E402

from consulta_cuad_masivo import corrida, vimarx  # noqa: E402
from consulta_cuad_masivo.entrada import cuil_valido, leer_cuiles  # noqa: E402
from consulta_cuad_masivo.kestra_entrypoint import conteos, cuentas_configuradas  # noqa: E402
from consulta_cuad_masivo.sesion import ErrorLogin  # noqa: E402

CUIL_A = "20268089838"
CUIL_B = "20047073856"
CUIL_C = "20049678178"
SIN_PAUSAS = corrida.Ritmo(pausa=0, cada=50, pausa_larga=0)


class SesionFalsa:
    def __init__(self, alias, falla_login=False):
        self.alias = alias
        self.falla_login = falla_login
        self.logins = 0

    def login(self):
        self.logins += 1
        if self.falla_login:
            raise ErrorLogin(f"[{self.alias}] login rechazado")
        return {"intentos": 1, "captchas_descartados": 0}

    def logout(self):
        pass


def consulta_ok(sesion, cuil):
    return {"estado": "ok", "regimen": "Santa Fe - ACTIVOS", "totales": {"cupo": 1.0}}


def leer_ndjson(ruta):
    return [json.loads(l) for l in Path(ruta).read_text(encoding="utf-8").splitlines()]


class EntradaTest(unittest.TestCase):
    def test_valida_digito_verificador(self):
        self.assertTrue(cuil_valido(CUIL_A))
        self.assertFalse(cuil_valido("20268089839"))
        self.assertFalse(cuil_valido("123"))

    def test_json_descarta_invalidos_y_repetidos(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "entrada.json"
            ruta.write_text(json.dumps([CUIL_A, "20-26808983-8", "99999999999", CUIL_B]), encoding="utf-8")
            validos, invalidos, duplicados = leer_cuiles(ruta)
        self.assertEqual(validos, [CUIL_A, CUIL_B])
        self.assertEqual(invalidos, [(3, "99999999999")])
        self.assertEqual(duplicados, 1)

    def test_excel_con_titulo_arriba_y_columna_cuit(self):
        libro = Workbook()
        hoja = libro.active
        hoja.append(["Listado de socios"])
        hoja.append([])
        hoja.append(["Nombre", "CUIT"])
        hoja.append(["Uno", int(CUIL_A)])
        hoja.append(["Dos", None])
        hoja.append(["Tres", CUIL_C])
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "lista.xlsx"
            libro.save(ruta)
            validos, invalidos, duplicados = leer_cuiles(ruta)
        self.assertEqual(validos, [CUIL_A, CUIL_C])
        self.assertEqual((invalidos, duplicados), ([], 0))

    def test_excel_sin_columna_cuil_falla(self):
        libro = Workbook()
        libro.active.append(["DNI"])
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "lista.xlsx"
            libro.save(ruta)
            with self.assertRaises(ValueError):
                leer_cuiles(ruta)


class EntrypointTest(unittest.TestCase):
    """Fallos antes de consultar: quedan en metadata.json con el motivo y no tocan CUAD."""

    def correr_main(self, carpeta, *args):
        from consulta_cuad_masivo import kestra_entrypoint
        entorno = {"CUAD_USUARIO_A": "ua", "CUAD_PASSWORD_A": "pa"}
        with mock.patch.dict("os.environ", entorno), self.assertRaises(SystemExit):
            kestra_entrypoint.main(["--carpeta", str(carpeta), "--corrida-id", "c1", *args])
        return json.loads((carpeta / "metadata.json").read_text(encoding="utf-8"))

    def test_archivo_que_no_es_excel(self):
        with tempfile.TemporaryDirectory() as tmp:
            archivo = Path(tmp) / "entrada"
            archivo.write_bytes(b"\xd0\xcf\x11\xe0 viejo .xls")
            m = self.correr_main(Path(tmp) / "corrida", "--entrada", str(archivo))
        self.assertEqual(m["estado"], "fallo")
        self.assertIn("Excel .xlsx", m["motivo"])

    def test_archivo_sin_cuiles_validos(self):
        with tempfile.TemporaryDirectory() as tmp:
            archivo = Path(tmp) / "entrada"
            archivo.write_text(json.dumps(["123"]), encoding="utf-8")
            m = self.correr_main(Path(tmp) / "corrida", "--entrada", str(archivo))
        self.assertEqual((m["estado"], m["total"]), ("fallo", 0))

    def test_linea_inexistente_en_vimarx(self):
        r = mock.Mock(status_code=200)
        r.json.return_value = []
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict("os.environ", {"VIMARX_EVAL_BASE_URL": "https://vimarx.test"}), \
                mock.patch.object(vimarx.requests, "post", return_value=r):
            m = self.correr_main(Path(tmp) / "corrida", "--lineas", "999999")
        self.assertEqual(m["estado"], "fallo")
        self.assertIn("999999", m["motivo"])


class CuentasTest(unittest.TestCase):
    def test_toma_cuentas_completas_ordenadas(self):
        entorno = {"CUAD_USUARIO_B": "ub", "CUAD_PASSWORD_B": "pb",
                   "CUAD_USUARIO_A": "ua", "CUAD_PASSWORD_A": "pa", "CUAD_USUARIO_C": ""}
        self.assertEqual(cuentas_configuradas(entorno), {"A": ("ua", "pa"), "B": ("ub", "pb")})

    def test_cuenta_sin_clave_corta(self):
        with self.assertRaises(SystemExit):
            cuentas_configuradas({"CUAD_USUARIO_A": "ua"})


class ConteosTest(unittest.TestCase):
    def test_usa_la_ultima_linea_de_cada_cuil(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "resultado.ndjson"
            lineas = [{"cuil": CUIL_A, "estado": "error"}, {"cuil": CUIL_A, "estado": "ok"},
                      {"cuil": CUIL_B, "estado": "sin_resultado"}]
            ruta.write_text("".join(json.dumps(l) + "\n" for l in lineas) + '{"cortada', encoding="utf-8")
            c = conteos([CUIL_A, CUIL_B, CUIL_C], ruta)
        self.assertEqual(c, {"ok": 1, "sin_resultado": 1, "error": 0, "pendientes": 1})


class CorridaTest(unittest.TestCase):
    def test_reparte_entre_cuentas_y_saltea_resueltos(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(corrida, "consultar", consulta_ok):
            salida = Path(tmp) / "resultado.ndjson"
            salida.write_text(json.dumps({"cuil": CUIL_A, "estado": "ok"}) + "\n", encoding="utf-8")
            estados = []
            restantes = corrida.correr([CUIL_A, CUIL_B, CUIL_C], [SesionFalsa("A"), SesionFalsa("B")], salida,
                                       SIN_PAUSAS, informar=lambda alias, estado, **_: estados.append((alias, estado)))
            registros = leer_ndjson(salida)
        self.assertEqual(restantes, 0)
        self.assertEqual(sorted(r["cuil"] for r in registros[1:]), sorted([CUIL_B, CUIL_C]))
        self.assertIn(("A", "terminada"), estados)
        self.assertIn(("B", "terminada"), estados)

    def test_cuenta_caida_vuelve_con_reintento(self):
        pedidos = []

        def pedidos_reintento(caidas):
            pedidos.append(set(caidas))
            return sorted(caidas)

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(corrida, "consultar", consulta_ok):
            salida = Path(tmp) / "resultado.ndjson"
            restantes = corrida.correr(
                [CUIL_A, CUIL_B, CUIL_C], [SesionFalsa("A", falla_login=True)], salida, SIN_PAUSAS,
                pedidos_reintento=pedidos_reintento, nueva_sesion=lambda alias: SesionFalsa(alias))
            registros = leer_ndjson(salida)
        self.assertEqual(restantes, 0)
        self.assertEqual(pedidos[0], {"A"})
        self.assertEqual(len(registros), 3)

    def test_sin_reintento_la_corrida_cierra_con_pendientes(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(corrida, "consultar", consulta_ok):
            salida = Path(tmp) / "resultado.ndjson"
            restantes = corrida.correr([CUIL_A, CUIL_B], [SesionFalsa("A", falla_login=True)], salida, SIN_PAUSAS)
        self.assertEqual(restantes, 2)


class VimarxTest(unittest.TestCase):
    def respuesta(self, filas):
        r = mock.Mock(status_code=200)
        r.json.return_value = json.dumps(filas)  # la API a veces devuelve el JSON como string
        return r

    def test_cuiles_con_advertencias(self):
        filas = [[CUIL_A], [None], [int(CUIL_B)]]
        with mock.patch.dict("os.environ", {"VIMARX_EVAL_BASE_URL": "https://vimarx.test"}), \
                mock.patch.object(vimarx.requests, "post", return_value=self.respuesta(filas)) as post:
            cuiles, advertencias = vimarx.cuiles_de_lineas([2703], maximo=3)
        self.assertEqual(cuiles, [CUIL_A, CUIL_B])
        self.assertEqual(len(advertencias), 2)  # llego al tope y un socio sin CUIT
        cuerpo = post.call_args.kwargs["json"]
        self.assertEqual(cuerpo["tipo"], "F.Module.SocioMutual")
        self.assertIn("[LineaPrestamo.Superior.ID] In (2703)", cuerpo["cmd"])
        self.assertEqual(post.call_args.kwargs["headers"], {})  # sin token no manda Authorization

    def test_error_http(self):
        r = mock.Mock(status_code=500, text="boom")
        with mock.patch.dict("os.environ", {"VIMARX_EVAL_BASE_URL": "https://vimarx.test"}), \
                mock.patch.object(vimarx.requests, "post", return_value=r):
            with self.assertRaises(vimarx.ErrorVimarx):
                vimarx.nombres_de_lineas([2703])


if __name__ == "__main__":
    unittest.main()
