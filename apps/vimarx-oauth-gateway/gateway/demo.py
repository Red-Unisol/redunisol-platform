"""Opt-in synthetic reviewer account behind the same OAuth resource.

Routing depends only on an authenticated opaque token, never tool arguments.
Demo failures have no production fallback, including after disable/key rotation.
"""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import secrets
import time

from cryptography.fernet import Fernet, InvalidToken
from werkzeug.security import check_password_hash

from .demo_fixture import (AMT, CUENTAS, CUOTAS, DATASET_VERSION, LINEAS, MOVIMIENTOS,
                           PRESTAMOS, SOCIOS, TABLES, TASAS, WORK_DATE, fields, rows)
from .demo_query import query
from .upstream import UpstreamAuthenticationError, UpstreamError, UpstreamSessionExpired

DEMO_USERNAME = "__demo_celesol__"
TOKEN_PREFIX = "vimarx-demo-v1."
NOTICE = "DEMO: datos completamente ficticios, simulados localmente. No son registros de Vimarx ni de socios reales."
CATALOG = json.loads(Path(__file__).with_name("demo_tools.json").read_text(encoding="utf-8"))
SCHEMAS = {tool["name"]: tool["inputSchema"] for tool in CATALOG}


class RoutedVimarx:
    def __init__(self, production, config):
        self.production = production
        self.demo = SyntheticVimarx(config) if config.get("DEMO_ENABLED") else None

    @staticmethod
    def is_demo_token(token):
        return isinstance(token, str) and token.casefold().startswith(TOKEN_PREFIX)

    def login(self, username, password):
        if username.casefold() == DEMO_USERNAME:
            if self.demo is None:
                raise UpstreamAuthenticationError("El acceso DEMO no está habilitado.")
            return self.demo.login(username, password)
        return self.production.login(username, password)

    def rpc(self, token, message, protocol):
        if self.is_demo_token(token):
            if self.demo is None:
                raise UpstreamAuthenticationError("El acceso DEMO está deshabilitado; reconectá la cuenta.")
            return self.demo.rpc(token, message, protocol)
        return self.production.rpc(token, message, protocol)


def integer(arguments, key, default, maximum=200):
    value = arguments.get(key)
    value = default if value is None else value
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError("El parámetro " + key + " debe estar entre 1 y " + str(maximum) + ".")
    return value


def validate_arguments(name, arguments):
    if name not in SCHEMAS: raise ValueError("Herramienta no disponible en DEMO.")
    schema = SCHEMAS[name]
    if set(arguments) - set(schema["properties"]):
        raise ValueError("Argumentos no soportados por la herramienta DEMO.")
    if any(key not in arguments for key in schema["required"]):
        raise ValueError("Falta un argumento requerido por la herramienta DEMO.")
    for key, value in arguments.items():
        types = schema["properties"][key]["type"]
        types = types if isinstance(types, list) else [types]
        actual = {str: "string", int: "integer", float: "number", bool: "boolean", type(None): "null"}.get(type(value))
        if actual == "integer" and "number" in types: actual = "number"
        if actual not in types or isinstance(value, str) and (len(value) > 4096 or "\0" in value):
            raise ValueError("Tipo o longitud de argumento inválido para DEMO: " + key)


class SyntheticVimarx:
    def __init__(self, config):
        password_hash, key = config.get("DEMO_PASSWORD_HASH"), config.get("DEMO_TOKEN_KEY")
        if not password_hash or not key:
            raise ValueError("DEMO requiere DEMO_PASSWORD_HASH y DEMO_TOKEN_KEY; no hay credenciales por omisión.")
        if not password_hash.startswith(("scrypt:", "pbkdf2:sha256:")):
            raise ValueError("DEMO_PASSWORD_HASH debe ser un hash seguro de Werkzeug.")
        if key == config.get("TOKEN_ENCRYPTION_KEY"):
            raise ValueError("El demo requiere una clave propia, diferente a la del almacén de sesiones.")
        self.cipher = Fernet(key)
        self.password_hash, self.audience = password_hash, config["ISSUER"].rstrip("/")
        self.generation = hashlib.sha256(password_hash.encode()).hexdigest()

    def login(self, username, password):
        if username.casefold() != DEMO_USERNAME or not check_password_hash(self.password_hash, password):
            raise UpstreamAuthenticationError("Usuario o contraseña DEMO incorrectos.")
        expiry = int(time.time()) + 3600
        claims = dict(mode="synthetic-demo", sub=DEMO_USERNAME, exp=expiry, aud=self.audience,
                      generation=self.generation, nonce=secrets.token_urlsafe(24))
        return TOKEN_PREFIX + self.cipher.encrypt(json.dumps(claims).encode()).decode(), expiry

    def authorize(self, token):
        try:
            if not token.startswith(TOKEN_PREFIX): raise ValueError()
            claims = json.loads(self.cipher.decrypt(token[len(TOKEN_PREFIX):].encode(), ttl=3600))
            if (claims.get("mode") != "synthetic-demo" or claims.get("sub") != DEMO_USERNAME
                    or claims.get("aud") != self.audience or claims.get("generation") != self.generation
                    or type(claims.get("exp")) is not int):
                raise ValueError()
            if claims["exp"] <= time.time(): raise UpstreamSessionExpired("La sesión DEMO venció.")
        except InvalidToken:
            raise UpstreamAuthenticationError("Token DEMO inválido o vencido; reconectá la cuenta.") from None
        except (ValueError, TypeError, AttributeError, KeyError):
            raise UpstreamAuthenticationError("Token DEMO inválido; reconectá la cuenta.") from None

    def rpc(self, token, message, protocol):
        self.authorize(token)
        method, params = message["method"], message.get("params", {})
        if method == "initialize":
            result = dict(protocolVersion=protocol, capabilities={"tools": {}},
                          serverInfo={"name": "celesol-demo-sintetico", "version": DATASET_VERSION}, instructions=NOTICE)
        elif method == "tools/list":
            tools = deepcopy(CATALOG)
            for tool in tools:
                tool["description"] = NOTICE + " " + tool["description"]
            result = {"tools": tools}
        elif method == "tools/call":
            try:
                name, arguments = params["name"], params.get("arguments", {})
                validate_arguments(name, arguments)
                payload = {"ambiente": "DEMO", "datosFicticios": True, "aviso": NOTICE,
                           "dataset": DATASET_VERSION, "resultado": self.call(name, arguments)}
                result = dict(content=[{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
                              structuredContent=payload, isError=False)
            except (ValueError, TypeError, KeyError, OverflowError):
                # Do not echo arbitrary criteria, tokens, field names or payloads.
                result = dict(content=[{"type": "text", "text": NOTICE + " Consulta no soportada o argumentos inválidos en DEMO. Usá los metadatos y el subconjunto documentado; no se consultó producción."}], isError=True)
        else:
            raise UpstreamError("Método no disponible en DEMO.")
        return dict(jsonrpc="2.0", id=message["id"], result=result)

    def call(self, name, a):
        if name == "contexto_cliente":
            return dict(empresa="Mutual Celesol — DEMO FICTICIO", ambiente="DEMO", fechaTrabajo=WORK_DATE,
                        motivoAmbiente="Datos sintéticos locales; no existe conexión a una base de Vimarx en esta sesión.")
        if name == "get_version": return {"version": "Simulador DEMO " + DATASET_VERSION, "empresa": "Celesol DEMO"}
        if name == "get_fecha_trabajo": return {"fechaTrabajo": WORK_DATE}
        if name == "get_estado_instalacion":
            return {"ambiente": "DEMO", "empresa": "Celesol DEMO", "fechaTrabajo": WORK_DATE,
                    "version": DATASET_VERSION, "origen": "fixture-local", "esquema": "sintético; no inspecciona Vimarx"}
        if name == "get_entidades":
            return [{"Nombre": entity, "EsAbstracta": False} for entity in TABLES if a.get("filtro", "").casefold() in entity.casefold()]
        if name == "get_propiedades":
            row = rows(a["nombreEntidad"])[0]
            return [{"Nombre": field, "Tipo": "System.DateTime" if field.startswith(("Fecha", "Vencimiento")) else {str: "System.String", int: "System.Int32", bool: "System.Boolean"}[type(value)], "EsNullable": False}
                    for field, value in row.items() if a.get("filtro", "").casefold() in field.casefold()]
        if name == "get_herencia_entidad":
            entity = a["nombreEntidad"]; fields(entity)
            return {"Entidad": entity, "Herencia": ["ObjetoDemo", entity], "Descendientes": [],
                    "Miembros": sorted(fields(entity)) if a.get("incluirMiembros", True) else [], "Nota": "Herencia simulada; no es un mapeo SQL real."}
        if name == "get_vistas_modelo":
            limit = integer(a, "limit", 100, 200)
            return [{"Id": entity + "_ListView", "Entidad": entity, "Tipo": "ListView", "Columnas": sorted(fields(entity)) if a.get("incluirColumnas", True) else []}
                    for entity in TABLES if a.get("nombreEntidad", "").casefold() in entity.casefold()
                    and a.get("idVista", "").casefold() in (entity + "_ListView").casefold()
                    and a.get("tipoVista", "") in ("", "ListView")][:limit]
        if name == "query_entidad":
            return query(rows(a["nombreEntidad"]), fields(a["nombreEntidad"]), dict(a, limit=integer(a, "limit", 50)))
        if name in {"get_socio_por_numero", "get_socio_por_dni", "get_socio_por_cuit"}:
            arg, field = {"get_socio_por_numero": ("nroSocio", "NroSocio"), "get_socio_por_dni": ("dni", "NroDocumento"), "get_socio_por_cuit": ("cuit", "CUIT")}[name]
            found = [s for s in SOCIOS if s[field] == a[arg]]
            return deepcopy(found[0]) if found else None
        if name in {"buscar_socios", "buscar_socios_por_localidad", "query_socios"}:
            result = deepcopy(SOCIOS)
            for arg, field in (("nombre", "Nombre"), ("apellido", "Apellido"), ("localidad", "Localidad"), ("provincia", "Provincia")):
                if a.get(arg):
                    result = [s for s in result if a[arg].casefold() in (s["Nombre"] + " " + s["Apellido"] if name == "buscar_socios" and arg == "nombre" else str(s[field])).casefold()]
            for arg, field in (("cuit", "CUIT"), ("nroDocumento", "NroDocumento"), ("dadoDeBaja", "DadoDeBaja"), ("estado", "Estado")):
                if a.get(arg) is not None and arg in a: result = [s for s in result if s[field] == a[arg]]
            for arg, lower in (("fechaIngresoDesde", True), ("fechaIngresoHasta", False)):
                if a.get(arg):
                    date.fromisoformat(a[arg])
                    result = [s for s in result if (s["FechaIngreso"] >= a[arg] if lower else s["FechaIngreso"] <= a[arg])]
            if name == "buscar_socios_por_localidad" and not a.get("incluirBajas"):
                result = [s for s in result if not s["DadoDeBaja"]]
            return result[:integer(a, "limit", 50)]
        if name == "get_prestamos": return deepcopy([r for r in PRESTAMOS if r["NroSocio"] == a["nroSocio"]])
        if name == "get_cuentas_amv": return deepcopy([r for r in CUENTAS if r["NroSocio"] == a["nroSocio"]])
        if name == "get_amt_socio":
            return deepcopy([r for r in AMT if r["NroSocio"] == a["nroSocio"] and (a.get("incluirCancelados") or r["Estado"] == "Activo")][:integer(a, "limite", 50)])
        if name == "get_domicilio":
            return [{k: r[k] for k in ("NroSocio", "Domicilio", "Localidad", "Provincia")} for r in SOCIOS if r["NroSocio"] == a["nroSocio"]]
        if name == "get_estadisticas":
            number = a["nroSocio"]
            return {"NroSocio": number, "CantidadCuentasAMV": sum(r["NroSocio"] == number for r in CUENTAS),
                    "CantidadPrestamos": sum(r["NroSocio"] == number for r in PRESTAMOS),
                    "SaldoAMV": sum(r["Saldo"] for r in CUENTAS if r["NroSocio"] == number),
                    "DeudaPrestamos": sum(r["Saldo"] for r in PRESTAMOS if r["NroSocio"] == number)}
        if name == "get_movimientos":
            result = [r for r in MOVIMIENTOS if r["NroSocio"] == a["nroSocio"]]
            for arg, lower in (("fechaDesde", True), ("fechaHasta", False)):
                if a.get(arg):
                    date.fromisoformat(a[arg])
                    result = [r for r in result if (r["Fecha"] >= a[arg] if lower else r["Fecha"] <= a[arg])]
            for arg, field in (("nroCuenta", "NroCuenta"), ("tipoMovimiento", "TipoMovimiento"), ("soloPendientes", "Pendiente")):
                if a.get(arg) is not None and arg in a: result = [r for r in result if r[field] == a[arg]]
            # All sample movements are current, not historical archive entries.
            result = sorted(result, key=lambda r: (r["Fecha"], r["Oid"]), reverse=True)
            return deepcopy(result[:integer(a, "limit", 50)])
        if name == "get_cuotas_prestamo":
            if a.get("nroPrestamo") is None and a.get("prestamoId") is None: raise ValueError("Falta préstamo.")
            loans = [r for r in PRESTAMOS if (a.get("nroPrestamo") is None or r["NroCuenta"] == a["nroPrestamo"])
                     and (a.get("prestamoId") is None or r["Oid"] == a["prestamoId"])]
            when = a.get("fecha") or WORK_DATE; date.fromisoformat(when)
            result = deepcopy([r for r in CUOTAS if any(p["NroCuenta"] == r["NroPrestamo"] for p in loans)])
            for row in result:
                row["Estado"] = "Paga" if row["Saldo"] == 0 else "Vencida impaga" if row["Vencimiento"] < when else "Impaga"
                row["Punitorios"] = 0
            return {"Fecha": when, "Cuotas": result, "DeudaTotal": sum(r["Saldo"] for r in result),
                    "Vencido": sum(r["Saldo"] for r in result if r["Vencimiento"] < when),
                    "NotaCalculo": "Simulación ilustrativa sin punitorios; no reproduce el motor financiero de Vimarx."}
        if name == "get_lineas_prestamo":
            return deepcopy([r for r in LINEAS if (not a.get("soloVigentes", True) or r["Vigente"])
                             and (not a.get("tipoCalculo") or r["SistemaCalculo"].casefold() == a["tipoCalculo"].casefold())])
        if name == "get_tasas_amt":
            found = [r for r in TASAS if not a.get("tipoCuentaAmt") or a["tipoCuentaAmt"].casefold() in r["Descripcion"].casefold() or str(r["Oid"]) == a["tipoCuentaAmt"]]
            if a.get("monto") is not None and a["monto"] < 0 or a.get("plazo") is not None and a["plazo"] < 0: raise ValueError("Rango inválido.")
            return deepcopy(found)
        if name in {"es_fecha_habil", "get_dias_habiles"}:
            def business(day): return day.weekday() < 5 and day.isoformat() != "2026-10-12"
            if name == "es_fecha_habil": return {"Fecha": a["fecha"], "EsHabil": business(date.fromisoformat(a["fecha"])), "Calendario": "DEMO: fines de semana y 2026-10-12 no hábiles"}
            start, end = date.fromisoformat(a["desde"]), date.fromisoformat(a["hasta"])
            span = (end-start).days
            if not 0 <= span <= 3660: raise ValueError("Rango DEMO inválido.")
            days = [start + timedelta(days=n) for n in range(span+1)]
            return {"DiasHabiles": sum(1 if business(d) else 0.5 if d.weekday() == 5 and a.get("sabadoXLaMitad") else 0 for d in days), "IncluyeExtremos": True, "Calendario": "DEMO: fines de semana y 2026-10-12 no hábiles"}
        raise ValueError("Herramienta no implementada en DEMO.")
