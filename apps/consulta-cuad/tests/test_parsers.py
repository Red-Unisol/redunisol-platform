"""Tests de caracterizacion de consulta_cuad.parsers.

No buscan bugs: fijan el comportamiento que el codigo YA tiene, para que el
resto del refactor no lo cambie sin que nos enteremos. Si alguno falla despues
de tocar algo, o rompimos una funcion o cambiamos algo a proposito y hay que
actualizar el test a mano, decidiendolo.

Los fixtures son sinteticos (ver fixtures.py): ninguna respuesta real de CUAD
se guarda en el repo, porque traen datos personales.
"""

import sys
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from consulta_cuad import parsers  # noqa: E402
from fixtures import (  # noqa: E402
    HTML_GRILLA,
    HTML_MOVIMIENTO,
    HTML_SESION_VENCIDA,
    HTML_SIN_RESULTADO,
    HTML_TABLA_REPETIDA,
)


class TestParsearRespuestaCuad(unittest.TestCase):
    def setUp(self):
        self.resultado = parsers.parsear_respuesta_cuad(HTML_MOVIMIENTO)

    def test_extrae_los_datos_del_empleado(self):
        empleado = self.resultado["tabla_empleado"]
        self.assertEqual(empleado["apellido_nombre"], "PEREZ JUAN")
        self.assertEqual(empleado["nro_cuil"], "20111111112")
        self.assertEqual(empleado["organizacion"], "MUNICIPALIDAD")
        self.assertEqual(empleado["es_socio"], "S")

    def test_agrega_al_empleado_los_campos_que_vienen_por_afuera(self):
        # emp_id, informacion_empleado y mensaje_precancelado no salen de
        # setEmpleado: se leen aparte y se pegan al mismo diccionario.
        empleado = self.resultado["tabla_empleado"]
        self.assertEqual(empleado["emp_id"], "12345")
        self.assertEqual(empleado["informacion_empleado"], "Sin observaciones")
        self.assertEqual(empleado["mensaje_precancelado"], "No registra precancelado")

    def test_extrae_los_totales(self):
        totales = self.resultado["tabla_totales"]
        self.assertEqual(totales["bruto"], "100000,00")
        self.assertEqual(totales["neto"], "80000,00")
        self.assertEqual(totales["disponible"], "25000,00")
        self.assertEqual(totales["deuda"], "15000,00")

    def test_mapea_los_21_nombres_de_totales(self):
        self.assertEqual(len(parsers.NOMBRES_SET_TOTALES), 21)
        self.assertEqual(
            set(self.resultado["tabla_totales"]),
            set(parsers.NOMBRES_SET_TOTALES),
        )

    def test_extrae_los_metadatos_de_la_grilla(self):
        grilla = self.resultado["grilla"]
        self.assertEqual(grilla["paginas"], "2")
        self.assertEqual(grilla["registros"], "7")
        self.assertEqual(grilla["identificador"], "MOVIMIENTOS")
        self.assertEqual(grilla["callback"], "grilla.asp")

    def test_paginas_es_lo_que_decide_cuantas_veces_se_pide_la_grilla(self):
        # Este valor lo consume el cliente HTTP para paginar movimientos, por
        # eso importa que salga como texto parseable a entero.
        self.assertEqual(int(self.resultado["grilla"]["paginas"]), 2)

    def test_no_confunde_estilo_con_estilofila(self):
        # Los patrones son prefijo unos de otros; si la regex fuera floja,
        # "Estilo" se comeria el valor de "EstiloFila".
        grilla = self.resultado["grilla"]
        self.assertEqual(grilla["estilo"], "e1")
        self.assertEqual(grilla["estilo_fila"], "f1")
        self.assertEqual(grilla["estilo_columna"], "c1")
        self.assertEqual(grilla["formato"], "fmt")
        self.assertEqual(grilla["formato_fila"], "fmtf")

    def test_deja_los_movimientos_en_none(self):
        # movimiento.asp no trae las filas de movimientos: se piden aparte a
        # grilla.asp. El parser deja el lugar reservado.
        self.assertIsNone(self.resultado["tabla_movimientos"])

    def test_marca_que_encontro_los_bloques(self):
        self.assertTrue(self.resultado["contiene_set_empleado"])
        self.assertTrue(self.resultado["contiene_set_totales"])

    def test_sin_resultado_no_trae_empleado_ni_totales(self):
        resultado = parsers.parsear_respuesta_cuad(HTML_SIN_RESULTADO)
        self.assertIsNone(resultado["tabla_empleado"])
        self.assertIsNone(resultado["tabla_totales"])
        self.assertFalse(resultado["contiene_set_empleado"])
        self.assertFalse(resultado["contiene_set_totales"])


class TestTablaOrganismos(unittest.TestCase):
    def test_renombra_los_porcentajes_duplicados_del_caso_conocido(self):
        # El encabezado real de CUAD trae dos columnas llamadas "%". Sin
        # renombrarlas, una pisaria a la otra en el diccionario.
        tabla = parsers.parsear_respuesta_cuad(HTML_MOVIMIENTO)["tabla_organismos"]
        self.assertEqual(
            tabla["columnas"],
            [
                "Organismo",
                "Sector",
                "Entidad",
                "Cupo",
                "Afectado",
                "Afectado_%",
                "PreCancelado",
                "PreCancelado_%",
                "Deuda",
            ],
        )

    def test_lee_las_filas(self):
        tabla = parsers.parsear_respuesta_cuad(HTML_MOVIMIENTO)["tabla_organismos"]
        self.assertEqual(tabla["cantidad_filas"], 2)
        self.assertEqual(tabla["filas"][0]["Organismo"], "MUNI")
        self.assertEqual(tabla["filas"][0]["Deuda"], "15.000,00")

    def test_convierte_el_nbsp_en_espacio_comun(self):
        tabla = parsers.parsear_respuesta_cuad(HTML_MOVIMIENTO)["tabla_organismos"]
        self.assertEqual(tabla["filas"][0]["Entidad"], "ENT 1")

    def test_desduplica_encabezados_repetidos_fuera_del_caso_conocido(self):
        tabla = parsers.parsear_grilla_cuad_html(HTML_TABLA_REPETIDA)
        self.assertEqual(tabla["columnas"], ["Cod", "Monto", "Monto_2", "Monto_3"])

    def test_devuelve_none_si_no_hay_tablas(self):
        self.assertIsNone(parsers.parsear_grilla_cuad_html(HTML_GRILLA))


class TestGrillaMovimientos(unittest.TestCase):
    def setUp(self):
        self.grilla = parsers.parsear_grilla_cuad_script(HTML_GRILLA)

    def test_separa_titulos_y_filas(self):
        self.assertEqual(self.grilla["columnas_visibles"], ["Fecha", "Concepto", "Importe", "%"])
        self.assertEqual(self.grilla["cantidad_registros"], 2)

    def test_numera_las_columnas_de_porcentaje(self):
        self.assertEqual(
            self.grilla["columnas_normalizadas"],
            ["Fecha", "Concepto", "Importe", "%_1"],
        )

    def test_separa_el_id_oculto_cuando_sobra_un_valor(self):
        # Las filas traen un valor mas que los titulos: el primero es un id
        # interno que no se muestra en pantalla.
        self.assertEqual(
            self.grilla["registros"][0],
            {
                "id_oculto": "1",
                "Fecha": "01/07/2026",
                "Concepto": "CUOTA 1",
                "Importe": "1500,00",
                "%_1": "10,00",
            },
        )

    def test_devuelve_none_si_la_respuesta_no_es_una_grilla(self):
        self.assertIsNone(parsers.parsear_grilla_cuad_script(HTML_MOVIMIENTO))


class TestDeteccionDeEstado(unittest.TestCase):
    def test_reconoce_la_respuesta_sin_resultado(self):
        self.assertTrue(parsers.es_respuesta_sin_resultado(HTML_SIN_RESULTADO))

    def test_una_respuesta_con_datos_no_es_sin_resultado(self):
        self.assertFalse(parsers.es_respuesta_sin_resultado(HTML_MOVIMIENTO))

    def test_reconoce_la_sesion_vencida_por_el_redirect_al_login(self):
        self.assertTrue(parsers.es_sesion_invalida(HTML_SESION_VENCIDA))

    def test_reconoce_el_modo_m_del_login(self):
        self.assertTrue(
            parsers.es_sesion_invalida("<script>top.location='login.asp?Modo=M';</script>")
        )

    def test_reconoce_el_titulo_sin_tilde(self):
        self.assertTrue(parsers.es_sesion_invalida("<title>Identificacion - CUAD</title>"))

    def test_una_respuesta_valida_no_es_sesion_vencida(self):
        self.assertFalse(parsers.es_sesion_invalida(HTML_MOVIMIENTO))

    def test_diagnostico_no_incluye_el_cuerpo_de_la_respuesta(self):
        diagnostico = parsers.diagnosticar_respuesta(
            "<html><title>Error de CUAD</title><body>dato sensible</body></html>"
        )

        self.assertEqual(diagnostico["titulo"], "Error de CUAD")
        self.assertTrue(diagnostico["bytes"] > 0)
        self.assertNotIn("dato sensible", str(diagnostico))

    def test_reconoce_la_variante_deformada_del_titulo(self):
        """CARACTERIZA UN BUG CONOCIDO, no el comportamiento deseado.

        es_sesion_invalida busca la aguja "identificaciÃ³n - cuad" dentro de un
        texto que ya paso por .lower(). Esa "Ã" mayuscula nunca puede aparecer
        en un texto en minusculas (queda como "ã"), asi que esa condicion no da
        verdadera jamas: es codigo muerto.

        Hoy no rompe nada, porque la sesion vencida igual se detecta por
        "login.asp?modo=e" y "login.asp?modo=m". Este test deja constancia del
        estado actual. Cuando se arregle, va a fallar, y ahi hay que dar vuelta
        el assert a assertTrue.
        """
        html = "<html><head><title>IdentificaciÃ³n - CUAD</title></head></html>"
        self.assertTrue(parsers.es_sesion_invalida(html))


class TestHelpers(unittest.TestCase):
    def test_mapear_argumentos_rellena_con_none_lo_que_falta(self):
        self.assertEqual(
            parsers.mapear_argumentos(["a", "b", "c"], ["1", "2"]),
            {"a": "1", "b": "2", "c": None},
        )

    def test_mapear_argumentos_ignora_los_valores_de_sobra(self):
        self.assertEqual(
            parsers.mapear_argumentos(["a"], ["1", "2", "3"]),
            {"a": "1"},
        )

    def test_extraer_argumentos_script_devuelve_none_si_no_esta_la_funcion(self):
        self.assertIsNone(
            parsers.extraer_argumentos_script(HTML_MOVIMIENTO, "setNoExiste")
        )

    def test_extraer_argumentos_script_devuelve_la_lista_completa(self):
        argumentos = parsers.extraer_argumentos_script(HTML_MOVIMIENTO, "setEmpleado")
        self.assertEqual(len(argumentos), len(parsers.NOMBRES_SET_EMPLEADO))
        self.assertEqual(argumentos[0], "PEREZ JUAN")

    def test_extraer_valor_script_devuelve_none_si_no_hay_match(self):
        self.assertIsNone(parsers.extraer_valor_script(HTML_MOVIMIENTO, r"NoExiste = '([^']*)'"))

    def test_normalizar_columnas_numera_cada_porcentaje_por_orden(self):
        self.assertEqual(
            parsers.normalizar_columnas_movimientos(["Fecha", "%", "Importe", "%"]),
            ["Fecha", "%_1", "Importe", "%_2"],
        )

    def test_normalizar_columnas_deja_intactas_las_que_no_son_porcentaje(self):
        self.assertEqual(
            parsers.normalizar_columnas_movimientos(["Fecha", "Importe"]),
            ["Fecha", "Importe"],
        )


if __name__ == "__main__":
    unittest.main()
