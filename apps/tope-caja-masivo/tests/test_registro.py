"""Pruebas del CSV de trabajo: lo que hace reanudable una corrida."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tope_caja_masivo import registro


class RegistroTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.ruta = Path(self.dir.name) / "resultados.csv"

    def tearDown(self) -> None:
        self.dir.cleanup()

    def test_crea_el_archivo_con_encabezado(self) -> None:
        registro.Registro(self.ruta)
        self.assertTrue(self.ruta.exists())
        self.assertEqual(
            self.ruta.read_text(encoding="utf-8").splitlines()[0].split(","),
            registro.COLUMNAS,
        )

    def test_no_pisa_un_archivo_existente(self) -> None:
        reg = registro.Registro(self.ruta)
        reg.agregar(registro.Fila(cuil="20111111112", estado=registro.ESTADO_OK))

        otro = registro.Registro(self.ruta)
        self.assertEqual(len(list(otro.leer())), 1)

    def test_las_respuestas_definitivas_no_se_reconsultan(self) -> None:
        reg = registro.Registro(self.ruta)
        reg.agregar(registro.Fila(cuil="20111111112", estado=registro.ESTADO_OK))
        reg.agregar(registro.Fila(cuil="20222222223", estado=registro.ESTADO_NO_ENCONTRADO))
        reg.agregar(registro.Fila(cuil="20333333334", estado=registro.ESTADO_CUIL_INVALIDO))

        self.assertEqual(
            reg.resueltos(), {"20111111112", "20222222223", "20333333334"}
        )

    def test_un_error_tecnico_se_reintenta(self) -> None:
        """Una falla tecnica no es una respuesta: la proxima corrida la retoma."""
        reg = registro.Registro(self.ruta)
        reg.agregar(registro.Fila(cuil="20111111112", estado=registro.ESTADO_ERROR))

        self.assertEqual(reg.resueltos(), set())

    def test_vale_el_ultimo_estado_de_cada_cuil(self) -> None:
        """El CSV es append-only: un reintento exitoso pisa al fallo anterior."""
        reg = registro.Registro(self.ruta)
        reg.agregar(registro.Fila(cuil="20111111112", estado=registro.ESTADO_ERROR))
        reg.agregar(
            registro.Fila(cuil="20111111112", estado=registro.ESTADO_OK, nombre="ANA")
        )

        self.assertEqual(reg.estados_por_cuil()["20111111112"], registro.ESTADO_OK)
        self.assertEqual(reg.resueltos(), {"20111111112"})
        self.assertEqual(reg.ultimas_filas()["20111111112"]["nombre"], "ANA")

    def test_cada_fila_queda_en_disco_al_escribirla(self) -> None:
        """Un corte no debe perder lo ya consultado."""
        reg = registro.Registro(self.ruta)
        reg.agregar(registro.Fila(cuil="20111111112", estado=registro.ESTADO_OK))

        # Se lee desde otra instancia, sin cerrar nada antes.
        self.assertEqual(len(list(registro.Registro(self.ruta).leer())), 1)

    def test_resumen_cuenta_por_estado(self) -> None:
        reg = registro.Registro(self.ruta)
        reg.agregar(registro.Fila(cuil="1" * 11, estado=registro.ESTADO_OK))
        reg.agregar(registro.Fila(cuil="2" * 11, estado=registro.ESTADO_OK))
        reg.agregar(registro.Fila(cuil="3" * 11, estado=registro.ESTADO_NO_ENCONTRADO))

        self.assertEqual(
            reg.resumen(), {registro.ESTADO_OK: 2, registro.ESTADO_NO_ENCONTRADO: 1}
        )

    def test_importes_van_y_vuelven(self) -> None:
        self.assertEqual(registro.leer_importe(registro.formatear_importe(-201503.26)), -201503.26)
        self.assertEqual(registro.leer_importe(registro.formatear_importe(0.0)), 0.0)
        self.assertIsNone(registro.leer_importe(""))
        self.assertIsNone(registro.leer_importe("no es un numero"))


if __name__ == "__main__":
    unittest.main()
