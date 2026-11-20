from cartera_api.config import Settings, participacion_para
from cartera_api.db import connect
from cartera_api.sync import (
    CAMPOS_CUOTA, CAMPOS_MOVIMIENTO, CAMPOS_PRESTAMO, agrupar_cobros, estado_cuota, sincronizar,
    transformar_cuota, transformar_prestamo,
)
from cartera_api.vimarx import filtro_proveedores

REGLAS = {"SANCOR 20 PLAN DESEN": 0.5705, "SANCOR%": 0.5}

# Montos del préstamo 426321 de Vimarx prod (20/11/2026); datos del socio ficticios.
PRESTAMO = [426321, 1005605, 12345, 30111222, 27301112223, "MEDICA ROSARIO", "9902", "MEDICA ESPECIAL B",
            "2025-10-06", 101234.37, 81139.39, 381665.97, 1.2349, 0.1015, 2.1902, 36, 243842.18, 0, 1, "Activa", "AprobadoInactivo"]
CUOTA = [426321, 1, "2025-10-31", 326.54, 10275.29, 0.0, 10601.83, -326.54, -10275.29, -10601.83,
         "2025-10-31", 0.0]


def test_participacion():
    assert participacion_para("SANCOR 20 PLAN DESEN", REGLAS) == 0.5705
    assert participacion_para("SANCOR UNO", REGLAS) == 0.5
    assert participacion_para("MEDICA ROSARIO", REGLAS) is None


def test_filtro_proveedores():
    f = filtro_proveedores(["SANCOR%", "MEDICA ROSARIO"])
    assert f == "([Proveedor.Nombre] Like 'SANCOR%' OR [Proveedor.Nombre] = 'MEDICA ROSARIO')"


def test_transformar_prestamo():
    p = transformar_prestamo(dict(zip(CAMPOS_PRESTAMO, PRESTAMO)), REGLAS)
    assert p["socio"] == {"nro_socio": 12345, "dni": "30111222", "cuit": "27301112223"}
    assert p["capital_otorgado"] == 101234.37
    assert p["monto_desembolsado"] == 81139.39
    assert p["total_a_devolver"] == 381665.97
    assert p["tna"] == 1.2349
    assert p["participacion_mutual"] is None
    assert (p["estado_texto"], p["estado_prestamo_texto"]) == ("Activa", "AprobadoInactivo")


def test_transformar_cuota_pagos_en_positivo():
    c = transformar_cuota(dict(zip(CAMPOS_CUOTA, CUOTA)))
    assert c["pagado_capital"] == 326.54
    assert c["pagado_total"] == 10601.83
    assert c["estado"] == "pagada"


def test_estado_cuota():
    assert estado_cuota(0.0, 100.0) == "pagada"
    assert estado_cuota(100.0, 0.0) == "impaga"
    assert estado_cuota(50.0, 50.0) == "pago_parcial"


def test_agrupar_cobros():
    movs = [dict(zip(CAMPOS_MOVIMIENTO, m)) for m in [
        [19028925, 426321, 13, "2026-10-31", -9560.11, "Interes"],
        [19028925, 426321, 13, "2026-10-31", -1041.71, "Capital"],
        [19028925, 426321, 13, "2026-10-31", -0.01, "Capital"],
    ]]
    (c,) = agrupar_cobros(movs)
    assert (c["capital"], c["interes"], c["otros"], c["total"]) == (1041.72, 9560.11, 0.0, 10601.83)


class FakeCliente:
    def __init__(self, prestamos, cuotas, movimientos):
        self.datos = {"Prestamo": prestamos, "CuotaPrestamo": cuotas, "MovimientoPrestamo": movimientos}

    def evaluate_list(self, tipo, cmd, campos, max_filas):
        filas = self.datos[tipo.rsplit(".", 1)[1]]
        return [dict(zip(campos, f)) for f in filas]


def test_sincronizar_solo_marca_lo_que_cambia(tmp_path):
    settings = Settings(vimarx_base_url="x", db_path=str(tmp_path / "c.sqlite"), participacion=REGLAS)
    mov = [19028925, 426321, 13, "2026-10-31", -10601.83, "Capital"]
    r1 = sincronizar(settings, FakeCliente([PRESTAMO], [CUOTA], [mov]))
    assert r1["cambios"] == 3
    r2 = sincronizar(settings, FakeCliente([PRESTAMO], [CUOTA], [mov]))
    assert r2["cambios"] == 0
    # el cobro deja de existir en Vimarx: baja lógica
    r3 = sincronizar(settings, FakeCliente([PRESTAMO], [CUOTA], []))
    assert r3["cambios"] == 1
    conn = connect(settings.db_path)
    assert conn.execute("SELECT eliminado FROM cobros").fetchone()[0] == 1


def test_no_aplica_si_vimarx_devuelve_vacio(tmp_path):
    settings = Settings(vimarx_base_url="x", db_path=str(tmp_path / "c.sqlite"))
    sincronizar(settings, FakeCliente([PRESTAMO], [CUOTA], []))
    try:
        sincronizar(settings, FakeCliente([], [], []))
        raise AssertionError("debía fallar")
    except RuntimeError:
        pass
    conn = connect(settings.db_path)
    assert conn.execute("SELECT COUNT(*) FROM prestamos WHERE eliminado = 0").fetchone()[0] == 1
    assert conn.execute("SELECT estado FROM sincronizaciones ORDER BY id DESC").fetchone()[0] == "error"


def test_vimarx_reintenta_timeouts():
    from cartera_api.vimarx import VimarxClient

    cliente = VimarxClient("x", esperas=(0, 0))
    respuestas = [TimeoutError("timed out"), TimeoutError("timed out"), [[1, "a"]]]

    def post(_body):
        r = respuestas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    cliente._post = post
    assert cliente.evaluate_list("T", "True", ["ID", "N"], 10) == [{"ID": 1, "N": "a"}]


def test_vimarx_se_rinde_tras_los_reintentos():
    from cartera_api.vimarx import VimarxClient, VimarxError

    cliente = VimarxClient("x", esperas=(0,))
    llamadas = []

    def post(_body):
        llamadas.append(1)
        raise TimeoutError("timed out")

    cliente._post = post
    try:
        cliente.evaluate_list("T", "True", ["ID"], 10)
        raise AssertionError("debía fallar")
    except VimarxError:
        pass
    assert len(llamadas) == 2
