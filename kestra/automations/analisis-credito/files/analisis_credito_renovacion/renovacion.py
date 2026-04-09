import calendar
import datetime as dt
import math
import re
import unicodedata
from typing import Any, Dict, List, Optional

from .vimarx_client import evaluate_list

LINEAS_PRESTAMO = [
    "CRUZ DEL EJE -Cance-especia-",
    "CRUZ DEL EJE -Cancel-Prem",
    "CRUZ DEL EJE especial",
    "CRUZ DEL EJE -premium-",
    "CRUZ DEL EJE Ren Especial",
    "CRUZ DEL EJE Ren Premium",
]
LINEAS_BONUS_RENOVACION = [
    "CRUZ DEL EJE -Cance-especia-",
    "CRUZ DEL EJE -Cancel-Prem",
]

ESTADO_CUENTA_ACTIVA = 0
MAX_CUOTAS = 35000
MESES_CORTE_DEUDA = 2


def normalize_line(texto: str) -> str:
    texto = (texto or "").strip().lower()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    texto = texto.replace("\u2013", "-").replace("\u2014", "-")
    texto = " ".join(texto.split())
    return texto


def _like_any(ruta_campo: str, token: str) -> str:
    return (
        f"([{ruta_campo}] Like '%{token.upper()}%' "
        f"Or [{ruta_campo}] Like '%{token.capitalize()}%' "
        f"Or [{ruta_campo}] Like '%{token.lower()}%')"
    )


def build_broad_cruz_eje_cmd(
    ruta_campo: str, ruta_campo_alt: Optional[str] = None
) -> str:
    cruz = _like_any(ruta_campo, "CRUZ")
    eje = _like_any(ruta_campo, "EJE")
    if ruta_campo_alt:
        cruz = f"({cruz} Or {_like_any(ruta_campo_alt, 'CRUZ')})"
        eje = f"({eje} Or {_like_any(ruta_campo_alt, 'EJE')})"
    return f"({cruz} And {eje})"


def normalize_cuil(cuil: str) -> str:
    return re.sub(r"\D", "", cuil or "")


def format_cuil(digitos: str) -> str:
    if len(digitos) != 11:
        return digitos
    return f"{digitos[:2]}-{digitos[2:10]}-{digitos[10:]}"


def validar_dv_cuil(cuil_digitos: str) -> bool:
    if len(cuil_digitos) != 11:
        return False
    coef = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    suma = sum(int(cuil_digitos[i]) * coef[i] for i in range(10))
    resto = suma % 11
    verif = 11 - resto
    if verif == 11:
        verif = 0
    elif verif == 10:
        verif = 9
    return verif == int(cuil_digitos[10])


def build_cuil_cmd(cuil: str) -> str:
    raw = (cuil or "").strip()
    dig = normalize_cuil(raw)
    form = format_cuil(dig) if dig else ""
    parts = []
    if raw:
        parts.append(f"[Prestamo.SocioTitular.Socio.CUIT] Like '%{raw}%'")
    if form:
        parts.append(f"[Prestamo.SocioTitular.Socio.CUIT] Like '%{form}%'")
    if dig:
        parts.append(f"[Prestamo.SocioTitular.Socio.CUIT] Like '%{dig}%'")
    return "(" + " Or ".join(parts) + ")"


def parse_date(valor: Any) -> Optional[dt.date]:
    if valor is None:
        return None
    if isinstance(valor, dt.date) and not isinstance(valor, dt.datetime):
        return valor
    if isinstance(valor, dt.datetime):
        return valor.date()
    if isinstance(valor, str):
        try:
            return dt.datetime.fromisoformat(valor.replace("Z", "+00:00")).date()
        except ValueError:
            try:
                return dt.datetime.strptime(valor[:10], "%Y-%m-%d").date()
            except ValueError:
                return None
    return None


def next_month_start(hoy: dt.date) -> dt.date:
    year = hoy.year
    month = hoy.month + 1
    if month == 13:
        month = 1
        year += 1
    return dt.date(year, month, 1)


def month_end_months_ago(hoy: dt.date, meses_atras: int) -> dt.date:
    year = hoy.year
    month = hoy.month - meses_atras
    while month <= 0:
        month += 12
        year -= 1
    last_day = calendar.monthrange(year, month)[1]
    return dt.date(year, month, last_day)


def fetch_cuotas_por_cuil(cuil: str) -> List[Dict[str, Any]]:
    campos = [
        "Prestamo.ID",
        "Prestamo.Cuenta.Estado",
        "Prestamo.SocioTitular.Socio.ID",
        "Prestamo.SocioTitular.Socio.CUIT",
        "Prestamo.SocioTitular.Socio.NroDoc",
        "Prestamo.SocioTitular.Socio.NombreCompleto",
        "Prestamo.SocioTitular.Socio.Celular",
        "Prestamo.SocioTitular.Socio.Email",
        "Prestamo.FechaEmision",
        "Prestamo.PrimerVencimiento",
        "Prestamo.FechaPrimerVto",
        "Prestamo.Cuotas",
        "Prestamo.LineaPrestamo.Descripcion",
        "Prestamo.LineaPrestamo.Superior.Descripcion",
        "NroCuota",
        "Fecha",
        "FechaCobro",
        "SaldoCuota",
        "Capital",
    ]

    criterio_lineas = build_broad_cruz_eje_cmd(
        "Prestamo.LineaPrestamo.Descripcion",
        "Prestamo.LineaPrestamo.Superior.Descripcion",
    )
    criterio_cuil = build_cuil_cmd(cuil)
    criterio = f"({criterio_lineas}) And ({criterio_cuil}) And [NroCuota] > 0"

    filas = evaluate_list(
        cmd=criterio,
        tipo="F.Module.Cuentas.Prestamos.CuotaPrestamo",
        campos=campos,
        max_filas=MAX_CUOTAS,
    )
    return [dict(zip(campos, fila)) for fila in filas]


def filter_lines_exact(cuotas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    lineas_validas = {normalize_line(x) for x in LINEAS_PRESTAMO}
    filtradas = []
    for cuota in cuotas:
        descripcion = cuota.get("Prestamo.LineaPrestamo.Descripcion") or ""
        descripcion_sup = cuota.get("Prestamo.LineaPrestamo.Superior.Descripcion") or ""
        if (
            normalize_line(descripcion) in lineas_validas
            or normalize_line(descripcion_sup) in lineas_validas
        ):
            filtradas.append(cuota)
    return filtradas


def has_bonus_line(cuotas: List[Dict[str, Any]]) -> bool:
    lineas_bonus = {normalize_line(x) for x in LINEAS_BONUS_RENOVACION}
    for cuota in cuotas:
        descripcion = cuota.get("Prestamo.LineaPrestamo.Descripcion") or ""
        descripcion_sup = cuota.get("Prestamo.LineaPrestamo.Superior.Descripcion") or ""
        if (
            normalize_line(descripcion) in lineas_bonus
            or normalize_line(descripcion_sup) in lineas_bonus
        ):
            return True
    return False


def group_by_prestamo(cuotas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    por_prestamo: Dict[Any, Dict[str, Any]] = {}
    for cuota in cuotas:
        id_prestamo = cuota.get("Prestamo.ID")
        if id_prestamo is None:
            continue
        if id_prestamo not in por_prestamo:
            por_prestamo[id_prestamo] = {
                "ID": id_prestamo,
                "SocioTitular.Socio.ID": cuota.get("Prestamo.SocioTitular.Socio.ID"),
                "SocioTitular.Socio.CUIT": cuota.get(
                    "Prestamo.SocioTitular.Socio.CUIT"
                ),
                "Prestamo.Cuotas": cuota.get("Prestamo.Cuotas"),
                "_cuotas": [],
            }
        por_prestamo[id_prestamo]["_cuotas"].append(
            {
                "NroCuota": cuota.get("NroCuota"),
                "Fecha": cuota.get("Fecha"),
                "FechaCobro": cuota.get("FechaCobro"),
                "SaldoCuota": cuota.get("SaldoCuota"),
                "Capital": cuota.get("Capital"),
                "CuentaEstado": cuota.get("Prestamo.Cuenta.Estado"),
            }
        )
    return list(por_prestamo.values())


def compute_metrics(
    cuotas: List[Dict[str, Any]], hoy: dt.date, corte_deuda: dt.date
) -> Dict[str, Any]:
    tiene_deuda_vencida = False
    inicio_mes_siguiente = next_month_start(hoy)
    saldo_renovacion = 0.0
    max_nro_cuota = 0
    max_nro_cuota_pagada = 0

    for cuota in cuotas:
        nro_cuota = int(cuota.get("NroCuota") or 0)
        if nro_cuota > max_nro_cuota:
            max_nro_cuota = nro_cuota

        fecha = parse_date(cuota.get("Fecha"))
        fecha_cobro = parse_date(cuota.get("FechaCobro"))
        saldo_cuota = float(cuota.get("SaldoCuota") or 0)
        capital = float(cuota.get("Capital") or 0)

        if saldo_cuota > 0 and fecha and fecha <= corte_deuda:
            tiene_deuda_vencida = True

        if fecha_cobro is not None and nro_cuota > max_nro_cuota_pagada:
            max_nro_cuota_pagada = nro_cuota

        if (
            fecha
            and fecha >= inicio_mes_siguiente
            and cuota.get("CuentaEstado") == ESTADO_CUENTA_ACTIVA
        ):
            saldo_renovacion += capital

    return {
        "tiene_impagas": tiene_deuda_vencida,
        "saldo_renovacion": round(saldo_renovacion, 2),
        "max_nro_cuota": max_nro_cuota,
        "max_nro_cuota_pagada": max_nro_cuota_pagada,
    }


def evaluar_socio(cuil: str) -> Dict[str, Any]:
    cuotas = fetch_cuotas_por_cuil(cuil)
    cuotas = filter_lines_exact(cuotas)
    aplica_bonus = has_bonus_line(cuotas)

    if not cuotas:
        return {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "no_tiene_prestamo_cruz_del_eje",
        }

    prestamos = group_by_prestamo(cuotas)

    if len(prestamos) > 1:
        return {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "tiene_mas_de_un_prestamo",
        }

    hoy = dt.date.today()
    corte_deuda = month_end_months_ago(hoy, MESES_CORTE_DEUDA)

    prestamo = prestamos[0]
    metricas = compute_metrics(prestamo["_cuotas"], hoy, corte_deuda)

    if metricas["tiene_impagas"]:
        return {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "tiene_deuda",
        }

    cuotas_totales = prestamo.get("Prestamo.Cuotas") or metricas["max_nro_cuota"]
    try:
        cuotas_totales = int(cuotas_totales)
    except Exception:
        cuotas_totales = metricas["max_nro_cuota"]

    if cuotas_totales <= 0:
        return {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "cuotas_invalidas",
        }

    cuota_minima = math.ceil(cuotas_totales / 2)
    if metricas["max_nro_cuota_pagada"] < cuota_minima:
        return {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "menos_del_50_por_ciento",
        }

    saldo_renovacion = metricas["saldo_renovacion"]
    if aplica_bonus:
        saldo_renovacion = round(saldo_renovacion * 1.025, 2)

    return {
        "puede_renovar": True,
        "saldo_renovacion": saldo_renovacion,
        "motivo": None,
    }
