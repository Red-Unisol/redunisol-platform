"""Fictional, deterministic review dataset. No production exports or real contacts."""
from copy import deepcopy

WORK_DATE = "2026-10-30"
DATASET_VERSION = "synthetic-v1"
SOCIOS = [
    dict(Oid=1, NroSocio=900001, Nombre="Ana Demo", Apellido="Ejemplo", NroDocumento=90000001,
         CUIT=20900000014, Estado="Activo", DadoDeBaja=False, FechaIngreso="2025-01-15",
         Email="ana@example.invalid", Localidad="Ciudad Ficticia", Provincia="Provincia Demo",
         Domicilio="Calle de Demostración 100 (ficticia)"),
    dict(Oid=2, NroSocio=900002, Nombre="Bruno Demo", Apellido="Muestra", NroDocumento=90000002,
         CUIT=20900000022, Estado="Activo", DadoDeBaja=False, FechaIngreso="2025-02-01",
         Email="bruno@example.invalid", Localidad="Ciudad Ficticia", Provincia="Provincia Demo",
         Domicilio="Calle de Demostración 200 (ficticia)"),
]
SOLICITUDES = [
    dict(Oid=501, NroSolicitud=7001, NroSocio=900001, Fecha="2026-10-25T09:00:00", Monto=12000, Estado="Aprobada"),
    dict(Oid=502, NroSolicitud=7002, NroSocio=900002, Fecha="2026-10-28T10:00:00", Monto=8000, Estado="Pendiente"),
    dict(Oid=503, NroSolicitud=7003, NroSocio=900001, Fecha="2026-10-29T11:00:00", Monto=15000, Estado="Pendiente"),
    dict(Oid=504, NroSolicitud=7004, NroSocio=900002, Fecha="2026-10-30T08:00:00", Monto=6000, Estado="Rechazada"),
]
PRESTAMOS = [dict(Oid=601, NroCuenta=910001, NroSocio=900001, FechaAlta="2026-08-10",
                  Capital=12000, SaldoCapital=8000, Saldo=8800, Estado="En mora", Moneda="ARS",
                  Linea="Préstamo Demo", CantidadCuotas=3)]
CUOTAS = [
    dict(Oid=611, NroPrestamo=910001, Numero=1, Vencimiento="2026-09-10", Capital=4000, Interes=400, Pagado=4400, Saldo=0),
    dict(Oid=612, NroPrestamo=910001, Numero=2, Vencimiento="2026-10-10", Capital=4000, Interes=400, Pagado=0, Saldo=4400),
    dict(Oid=613, NroPrestamo=910001, Numero=3, Vencimiento="2026-11-10", Capital=4000, Interes=400, Pagado=0, Saldo=4400),
]
CUENTAS = [
    dict(Oid=701, NroCuenta=920001, NroSocio=900001, Saldo=12000, Moneda="ARS", Estado="Activa"),
    dict(Oid=702, NroCuenta=920002, NroSocio=900002, Saldo=1000, Moneda="ARS", Estado="Activa"),
]
MOVIMIENTOS = [
    dict(Oid=801, NroCuenta=920001, NroSocio=900001, Fecha="2026-09-01", TipoMovimiento="Credito", Monto=10000, Moneda="ARS", Pendiente=False),
    dict(Oid=802, NroCuenta=920001, NroSocio=900001, Fecha="2026-09-15", TipoMovimiento="Debito", Monto=1000, Moneda="ARS", Pendiente=False),
    dict(Oid=803, NroCuenta=920001, NroSocio=900001, Fecha="2026-10-01", TipoMovimiento="Credito", Monto=2500, Moneda="ARS", Pendiente=False),
    dict(Oid=804, NroCuenta=920001, NroSocio=900001, Fecha="2026-10-05", TipoMovimiento="Debito", Monto=500, Moneda="ARS", Pendiente=False),
    dict(Oid=805, NroCuenta=920001, NroSocio=900001, Fecha="2026-10-20", TipoMovimiento="Credito", Monto=1000, Moneda="ARS", Pendiente=False),
    dict(Oid=806, NroCuenta=920002, NroSocio=900002, Fecha="2026-10-02", TipoMovimiento="Credito", Monto=1000, Moneda="ARS", Pendiente=False),
]
AMT = [dict(Oid=901, NroCuenta=930001, NroSocio=900001, Capital=5000, Moneda="ARS",
            FechaAlta="2026-10-01", Vencimiento="2026-10-31", Plazo=30, TNA=12, Estado="Activo", Linea="AMT Demo")]
LINEAS = [dict(Oid=1001, Descripcion="Préstamo Demo", SistemaCalculo="Frances", TNA=12, MontoMinimo=1000, MontoMaximo=20000, CuotasMinimas=1, CuotasMaximas=3, Vigente=True)]
TASAS = [dict(Oid=1002, Descripcion="AMT Demo", Moneda="ARS", TNA=12, PlazoMinimo=30, PlazoMaximo=365, MontoMinimo=1000)]
TABLES = {"SocioMutual": SOCIOS, "Solicitud": SOLICITUDES, "Prestamo": PRESTAMOS,
          "CuotaPrestamo": CUOTAS, "CuentaAMV": CUENTAS, "MovimientoAMV": MOVIMIENTOS,
          "CuentaAMT": AMT, "LineaPrestamoPresolicitud": LINEAS, "TipoCuentaAMT": TASAS}

def rows(entity):
    if entity not in TABLES:
        raise ValueError("Entidad no disponible en el conjunto DEMO; usar get_entidades.")
    return deepcopy(TABLES[entity])

def fields(entity):
    return set(rows(entity)[0])
