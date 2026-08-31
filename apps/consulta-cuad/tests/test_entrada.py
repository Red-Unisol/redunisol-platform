"""Tests de la carga de CUILes desde Excel o JSON.

Los Excel se fabrican de verdad con openpyxl en un directorio temporal: leer
planillas tiene suficientes rarezas (celdas numericas, hojas vacias, columnas
repetidas) como para que valga la pena ejercitarlas contra archivos reales y
no contra dobles.
"""

import json
import logging
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from consulta_cuad import entrada  # noqa: E402


def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


CUIL_A = "20111111112"
CUIL_B = "27222222223"
CUIL_C = "23333333334"


class TestNormalizarCuil(unittest.TestCase):
    def test_saca_guiones_y_espacios(self):
        self.assertEqual(entrada.normalizar_cuil(" 20-11111111-2 "), CUIL_A)

    def test_saca_el_punto_cero_que_deja_excel(self):
        # openpyxl devuelve los CUILes numericos como float.
        self.assertEqual(entrada.normalizar_cuil(20111111112.0), CUIL_A)
        self.assertEqual(entrada.normalizar_cuil("20111111112.0"), CUIL_A)

    def test_acepta_un_entero(self):
        self.assertEqual(entrada.normalizar_cuil(20111111112), CUIL_A)

    def test_vacios_dan_cadena_vacia(self):
        for valor in (None, "", "   ", "sin datos"):
            with self.subTest(valor=valor):
                self.assertEqual(entrada.normalizar_cuil(valor), "")


class TestIndiceDeColumna(unittest.TestCase):
    def test_numero_es_uno_based(self):
        self.assertEqual(entrada.indice_columna_excel("1"), 0)
        self.assertEqual(entrada.indice_columna_excel("3"), 2)

    def test_letras_como_en_excel(self):
        self.assertEqual(entrada.indice_columna_excel("A"), 0)
        self.assertEqual(entrada.indice_columna_excel("c"), 2)
        self.assertEqual(entrada.indice_columna_excel("AA"), 26)

    def test_lo_que_no_es_ni_letra_ni_numero_da_none(self):
        for valor in (None, "", "  ", "A1", "cuil/cuit", "nro cuil"):
            with self.subTest(valor=valor):
                self.assertIsNone(entrada.indice_columna_excel(valor))

    def test_una_palabra_de_puras_letras_se_lee_como_columna(self):
        # "CUIL" son todas letras, asi que aca vale como referencia de columna
        # (C-U-I-L = 67169). No es un problema: resolver_columna_cuil busca
        # primero por encabezado, y solo cae aca si ninguno coincidio.
        self.assertEqual(entrada.indice_columna_excel("CUIL"), 67169)

    def test_la_columna_cero_no_existe(self):
        with self.assertRaises(ValueError):
            entrada.indice_columna_excel("0")


class TestResolverColumna(unittest.TestCase):
    def test_encuentra_cuil_sola(self):
        self.assertEqual(entrada.resolver_columna_cuil(["Nombre", "CUIL", "Monto"]), 1)

    def test_reconoce_las_variantes_de_encabezado(self):
        for encabezado in ("CUIL", "cuit", "CUIL/CUIT", "Nro CUIT", " cuil "):
            with self.subTest(encabezado=encabezado):
                self.assertEqual(entrada.resolver_columna_cuil(["x", encabezado]), 1)

    def test_falla_claro_si_no_hay_ninguna(self):
        with self.assertRaises(ValueError) as capturado:
            entrada.resolver_columna_cuil(["Nombre", "Monto"])
        self.assertIn("--columna-cuiles", str(capturado.exception))

    def test_la_columna_pedida_por_nombre(self):
        self.assertEqual(
            entrada.resolver_columna_cuil(["Nombre", "Documento"], "documento"), 1
        )

    def test_la_columna_pedida_por_letra(self):
        self.assertEqual(entrada.resolver_columna_cuil(["a", "b", "c"], "C"), 2)

    def test_el_encabezado_le_gana_a_la_letra(self):
        # En una planilla con una columna llamada "C", pedir "C" tiene que
        # traer esa y no la tercera.
        self.assertEqual(entrada.resolver_columna_cuil(["x", "C", "z"], "C"), 1)

    def test_falla_si_la_letra_se_pasa_del_ancho(self):
        with self.assertRaises(ValueError):
            entrada.resolver_columna_cuil(["a", "b"], "Z")

    def test_falla_si_el_nombre_no_existe(self):
        with self.assertRaises(ValueError):
            entrada.resolver_columna_cuil(["a", "b"], "no_existe")


class _ConDirectorio(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def excel(self, filas, nombre="socios.xlsx", hojas=None):
        libro = Workbook()
        hoja = libro.active
        hoja.title = (hojas or ["Hoja1"])[0]
        for fila in filas:
            hoja.append(fila)
        for extra in (hojas or ["Hoja1"])[1:]:
            libro.create_sheet(extra)
        ruta = self.base / nombre
        libro.save(ruta)
        return ruta


class TestCargarExcel(_ConDirectorio):
    def test_lee_la_columna_cuil(self):
        ruta = self.excel([["Nombre", "CUIL"], ["Ana", CUIL_A], ["Beto", CUIL_B]])
        resultado = entrada.cargar_desde_excel(ruta)

        self.assertEqual(resultado["cuiles"], [CUIL_A, CUIL_B])
        self.assertEqual(resultado["columna"], "CUIL")
        self.assertEqual(resultado["hoja"], "Hoja1")

    def test_conserva_el_orden_del_archivo(self):
        ruta = self.excel([["CUIL"], [CUIL_C], [CUIL_A], [CUIL_B]])
        self.assertEqual(
            entrada.cargar_desde_excel(ruta)["cuiles"], [CUIL_C, CUIL_A, CUIL_B]
        )

    def test_deduplica(self):
        ruta = self.excel([["CUIL"], [CUIL_A], [CUIL_B], [CUIL_A]])
        resultado = entrada.cargar_desde_excel(ruta)

        self.assertEqual(resultado["cuiles"], [CUIL_A, CUIL_B])
        self.assertEqual(resultado["cantidad_filas_leidas"], 3)
        self.assertEqual(resultado["cantidad_cuiles_unicos"], 2)

    def test_lee_cuiles_guardados_como_numero(self):
        ruta = self.excel([["CUIL"], [int(CUIL_A)], [float(CUIL_B)]])
        self.assertEqual(entrada.cargar_desde_excel(ruta)["cuiles"], [CUIL_A, CUIL_B])

    def test_acepta_cuiles_con_guiones(self):
        ruta = self.excel([["CUIL"], ["20-11111111-2"]])
        self.assertEqual(entrada.cargar_desde_excel(ruta)["cuiles"], [CUIL_A])

    def test_las_filas_vacias_se_saltean_sin_ruido(self):
        ruta = self.excel([["CUIL"], [CUIL_A], [None], [""], [CUIL_B]])
        resultado = entrada.cargar_desde_excel(ruta)

        self.assertEqual(resultado["cuiles"], [CUIL_A, CUIL_B])
        self.assertEqual(resultado["cantidad_invalidos"], 0)

    def test_los_cuiles_con_largo_erroneo_se_reportan_con_su_fila(self):
        # Enterarse de esto ANTES de arrancar una corrida de horas.
        ruta = self.excel([["CUIL"], [CUIL_A], ["12345"], [CUIL_B], ["999"]])
        resultado = entrada.cargar_desde_excel(ruta)

        self.assertEqual(resultado["cuiles"], [CUIL_A, CUIL_B])
        self.assertEqual(resultado["cantidad_invalidos"], 2)
        self.assertEqual(
            [invalido["fila"] for invalido in resultado["invalidos"]], [3, 5]
        )
        self.assertEqual(resultado["invalidos"][0]["valor"], "12345")

    def test_solo_se_guarda_una_muestra_de_invalidos(self):
        filas = [["CUIL"]] + [["123"] for _ in range(50)]
        resultado = entrada.cargar_desde_excel(self.excel(filas))

        self.assertEqual(resultado["cantidad_invalidos"], 50)
        self.assertEqual(len(resultado["invalidos"]), 20)

    def test_usa_la_hoja_pedida(self):
        ruta = self.excel([["CUIL"], [CUIL_A]], hojas=["Primera", "Otra"])
        self.assertEqual(entrada.cargar_desde_excel(ruta)["hoja"], "Primera")

    def test_falla_si_la_hoja_no_existe(self):
        ruta = self.excel([["CUIL"], [CUIL_A]])
        with self.assertRaises(ValueError) as capturado:
            entrada.cargar_desde_excel(ruta, hoja_cuiles="NoExiste")
        self.assertIn("NoExiste", str(capturado.exception))

    def test_falla_si_la_hoja_esta_vacia(self):
        ruta = self.excel([])
        with self.assertRaises(ValueError):
            entrada.cargar_desde_excel(ruta)

    def test_toma_la_columna_indicada_por_letra(self):
        ruta = self.excel([["a", "b", "c"], ["x", "y", CUIL_A]])
        resultado = entrada.cargar_desde_excel(ruta, columna_cuiles="C")
        self.assertEqual(resultado["cuiles"], [CUIL_A])

    def test_no_se_cae_si_una_fila_tiene_menos_celdas(self):
        ruta = self.excel([["Nombre", "CUIL"], ["Ana", CUIL_A], ["Beto"]])
        self.assertEqual(entrada.cargar_desde_excel(ruta)["cuiles"], [CUIL_A])


class TestCargarJson(_ConDirectorio):
    def json(self, datos, nombre="cuiles.json"):
        ruta = self.base / nombre
        ruta.write_text(json.dumps(datos), encoding="utf-8")
        return ruta

    def test_lee_una_lista(self):
        resultado = entrada.cargar_desde_json(self.json([CUIL_A, CUIL_B]))
        self.assertEqual(resultado["cuiles"], [CUIL_A, CUIL_B])

    def test_deduplica_y_valida_igual_que_el_excel(self):
        resultado = entrada.cargar_desde_json(self.json([CUIL_A, CUIL_A, "123"]))
        self.assertEqual(resultado["cuiles"], [CUIL_A])
        self.assertEqual(resultado["cantidad_invalidos"], 1)

    def test_falla_si_no_es_una_lista(self):
        with self.assertRaises(ValueError) as capturado:
            entrada.cargar_desde_json(self.json({"cuiles": [CUIL_A]}))
        self.assertIn("lista", str(capturado.exception))


class TestCargar(_ConDirectorio):
    def test_elige_el_lector_por_extension(self):
        excel = self.excel([["CUIL"], [CUIL_A]])
        self.assertEqual(entrada.cargar(excel)["cuiles"], [CUIL_A])

        ruta_json = self.base / "c.json"
        ruta_json.write_text(json.dumps([CUIL_B]), encoding="utf-8")
        self.assertEqual(entrada.cargar(ruta_json)["cuiles"], [CUIL_B])

    def test_falla_si_el_archivo_no_existe(self):
        with self.assertRaises(ValueError) as capturado:
            entrada.cargar(self.base / "fantasma.xlsx")
        self.assertIn("No existe", str(capturado.exception))

    def test_falla_con_un_formato_no_soportado(self):
        ruta = self.base / "datos.csv"
        ruta.write_text("CUIL\n" + CUIL_A, encoding="utf-8")

        with self.assertRaises(ValueError) as capturado:
            entrada.cargar(ruta)
        self.assertIn("csv", str(capturado.exception))

    def test_falla_si_no_quedo_ningun_cuil_valido(self):
        # Mejor cortar aca que arrancar una corrida vacia.
        ruta = self.excel([["CUIL"], ["123"], ["abc"]])
        with self.assertRaises(ValueError) as capturado:
            entrada.cargar(ruta)
        self.assertIn("ningun CUIL valido", str(capturado.exception))


if __name__ == "__main__":
    unittest.main()
