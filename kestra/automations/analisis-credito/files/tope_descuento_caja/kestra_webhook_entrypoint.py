#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from typing import Any, Dict

import requests
from Crypto.Cipher import AES

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    result: Dict[str, Any]
    try:
        payload = _load_trigger_body()
        cuil = _extract_cuil(payload)

        hash_sesion = login_cidi()
        cidi_cookie = f"CiDi={hash_sesion}"

        token_caja = obtener_token_caja(
            token_inicial=os.getenv("CAJA_SEED_TOKEN", ""),
            cidi_cookie=cidi_cookie,
            permisos_body=os.getenv("CAJA_PERMISSIONS_BODY", ""),
            permisos_payload=os.getenv("CAJA_PERMISSIONS_PLAINTEXT", ""),
        )

        datos_persona, cupo_disponible = _obtener_datos(
            cidi_cookie=cidi_cookie,
            token_caja=token_caja,
            cuil=cuil,
        )

        result = {
            "ok": True,
            "cuil": cuil,
            "nombre": datos_persona.get("nombre") or "",
            "apellido": datos_persona.get("apellido") or "",
            "disponible": _to_float(cupo_disponible.get("balance")),
            "tope_descuento": _to_float(cupo_disponible.get("discountLimit")),
            "error": "",
        }
    except Exception as exc:
        result = {
            "ok": False,
            "cuil": "",
            "nombre": "",
            "apellido": "",
            "disponible": 0.0,
            "tope_descuento": 0.0,
            "error": str(exc),
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True))
    return 0


def _load_trigger_body() -> Any:
    raw = os.getenv("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Falta TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _extract_cuil(payload: Any) -> str:
    if isinstance(payload, dict):
        if "cuil" not in payload:
            raise ValueError("cuil requerido")
        return str(payload["cuil"])
    if payload is None:
        raise ValueError("cuil requerido")
    if isinstance(payload, (list, tuple)):
        raise ValueError("Body invalido")
    return str(payload)


def login_cidi() -> str:
    usuario = os.getenv("CIDI_USER", "")
    clave = os.getenv("CIDI_PASS", "")
    client_id = os.getenv("CIDI_CLIENT_ID", "cidi")
    client_secret = os.getenv("CIDI_CLIENT_SECRET", "")
    base_url = _require_env("CIDI_BASE_URL")

    if not usuario or not clave:
        raise ValueError("Faltan CIDI_USER o CIDI_PASS")

    payload = {
        "grant_type": "password",
        "client_id": client_id,
        "client_secret": client_secret,
        "username": usuario,
        "password": clave,
        "scope": (
            "cidi.api.login cidi.api.actividad.cuenta cidi.api.buscador "
            "cidi.api.buscador.ciudadano cidi.api.ciudadano "
            "cidi.api.ciudadano.alta cidi.api.ciudadano.misdatos "
            "cidi.api.ciudadano.relaciones cidi.api.comunicaciones "
            "cidi.api.documentacion offline_access cidi.api.credenciales "
            "cidi.api.chatbot"
        ),
    }

    response = requests.post(
        _join_url(base_url, "/api/cidi/ciudadano/login/oauth/v1"),
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    if response.status_code >= 400:
        raise ValueError(f"Error de autenticacion en CIDI: {response.text}")

    data = response.json()
    token = data.get("access_token", "")
    datos_token = _decodificar_jwt(token) if token else {}
    hash_sesion = (
        data.get("resultado", {}).get("datos", {}).get("hashSesion")
        or datos_token.get("session_hash")
        or ""
    )
    if not hash_sesion:
        raise ValueError("No se pudo obtener hashSesion")
    return hash_sesion


def obtener_token_caja(
    token_inicial: str,
    cidi_cookie: str,
    permisos_body: str,
    permisos_payload: str,
) -> str:
    if not cidi_cookie:
        raise ValueError("No se pudo generar la cookie CiDi")

    token_semilla = token_inicial or obtener_token_semilla_caja(cidi_cookie)
    payload_dinamico = permisos_payload or construir_payload_permisos(token_semilla)
    body_cifrado = permisos_body or cifrar_permisos(
        payload_dinamico, os.getenv("CAJA_ENCRYPT_PASS", "")
    )

    if not body_cifrado:
        raise ValueError("Falta CAJA_PERMISSIONS_BODY o CAJA_PERMISSIONS_PLAINTEXT")

    token_caja = solicitar_permissions(token_semilla, cidi_cookie, body_cifrado)
    if not token_caja:
        raise ValueError("No se recibio token de caja en authorization")
    return token_caja


def solicitar_permissions(token_semilla: str, cidi_cookie: str, body_cifrado: str) -> str:
    base_url = _require_env("CAJA_BASE_URL")
    origin, referer = _origin_and_referer(base_url, "/")
    url = _join_url(base_url, "/api/security/permissions")
    headers = {
        "authorization": token_semilla,
        "Cookie": cidi_cookie,
        "Accept": "application/json, text/plain, */*",
        "Origin": origin,
        "Referer": referer,
        "Content-Type": "application/json",
    }
    body = {"body": body_cifrado}
    response = requests.post(url, headers=headers, json=body, timeout=30)
    if response.status_code >= 400:
        return ""
    return response.headers.get("authorization", "")


def obtener_token_semilla_caja(cidi_cookie: str) -> str:
    base_url = _require_env("CAJA_BASE_URL")
    origin, referer = _origin_and_referer(base_url, "/login")
    response = requests.get(
        _join_url(base_url, "/api/security/login"),
        headers={
            "Accept": "application/json, text/plain, */*",
            "Cookie": cidi_cookie,
            "Origin": origin,
            "Referer": referer,
        },
        timeout=30,
    )
    if response.status_code >= 400:
        raise ValueError(f"Error en login de caja: {response.text}")
    token_semilla = response.headers.get("authorization", "")
    if not token_semilla:
        raise ValueError("No se recibio seed token en authorization")
    return token_semilla


def _obtener_datos(cidi_cookie: str, token_caja: str, cuil: str):
    datos_persona = obtener_datos_persona(cidi_cookie, token_caja, cuil)
    cupo_disponible = obtener_cupo_disponible(cidi_cookie, token_caja, cuil)
    return datos_persona, cupo_disponible


def obtener_datos_persona(cidi_cookie: str, token_caja: str, cuil: str) -> Dict[str, Any]:
    base_url = _require_env("CAJA_BASE_URL")
    origin, referer = _origin_and_referer(base_url, "/")
    body = armar_body_cifrado({"cuil": cuil}, os.getenv("CAJA_ENCRYPT_PASS", ""))
    if not body:
        raise ValueError("No se pudo armar el body cifrado para datos persona")

    response = requests.post(
        _join_url(base_url, "/api/utilidades/obtener-datos-persona"),
        headers={
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Cookie": cidi_cookie,
            "authorization": token_caja,
            "Origin": origin,
            "Referer": referer,
        },
        json=body,
        timeout=30,
    )
    if response.status_code >= 400:
        raise ValueError(f"Error al obtener datos de persona: {response.text}")
    return response.json()


def obtener_cupo_disponible(
    cidi_cookie: str, token_caja: str, cuil: str
) -> Dict[str, Any]:
    base_url = _require_env("CAJA_BASE_URL")
    origin, referer = _origin_and_referer(base_url, "/")
    body = armar_body_cifrado({"cuil": cuil}, os.getenv("CAJA_ENCRYPT_PASS", ""))
    if not body:
        raise ValueError("No se pudo armar el body cifrado para cupo descuento")

    response = requests.post(
        _join_url(base_url, "/api/transaccion/obtener-haber-disponible"),
        headers={
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Cookie": cidi_cookie,
            "authorization": token_caja,
            "Origin": origin,
            "Referer": referer,
        },
        json=body,
        timeout=30,
    )
    if response.status_code >= 400:
        raise ValueError(f"Error al obtener cupo disponible: {response.text}")
    return response.json()


def cifrar_permisos(payload: Any, passphrase: str) -> str:
    if not payload or not passphrase:
        return ""
    salt = os.urandom(8)
    key, iv = derivar_clave_iv(passphrase.encode("utf-8"), salt, 32, 16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    data = _pkcs7_pad(raw.encode("utf-8"))
    ciphertext = cipher.encrypt(data)
    out = b"Salted__" + salt + ciphertext
    return base64.b64encode(out).decode("utf-8")


def armar_body_cifrado(payload: Any, passphrase: str) -> Dict[str, str] | None:
    cifrado = cifrar_permisos(payload, passphrase)
    if not cifrado:
        return None
    return {"body": cifrado}


def construir_payload_permisos(token_semilla: str) -> Dict[str, Any] | str:
    datos = _decodificar_jwt(token_semilla)
    usuario = datos.get("usuario") if isinstance(datos, dict) else None
    if not usuario or "id" not in usuario:
        return ""

    tipo_env = os.getenv("CAJA_ID_TIPO_USUARIO", "")
    tipo_preferido = int(tipo_env) if tipo_env.isdigit() else None
    id_tipo = usuario.get("idTipoUsuario")

    if tipo_preferido is not None:
        id_tipo = tipo_preferido
    elif id_tipo == 0:
        tipo4 = None
        for item in datos.get("tipoUsuario", []):
            if isinstance(item, dict) and item.get("id") == 4:
                tipo4 = item
                break
        if tipo4:
            id_tipo = 4

    if id_tipo is None:
        return ""
    return {"idUsuario": usuario["id"], "idTipoUsuario": id_tipo}


def derivar_clave_iv(passphrase: bytes, salt: bytes, key_len: int, iv_len: int):
    material = b""
    prev = b""
    while len(material) < key_len + iv_len:
        prev = hashlib.md5(prev + passphrase + salt).digest()
        material += prev
    return material[:key_len], material[key_len : key_len + iv_len]


def _pkcs7_pad(data: bytes, block_size: int = 16) -> bytes:
    pad_len = block_size - (len(data) % block_size)
    return data + bytes([pad_len] * pad_len)


def _decodificar_jwt(token: str) -> Dict[str, Any]:
    try:
        carga = token.split(".")[1]
        if not carga:
            return {}
        padded = carga + "=" * (-len(carga) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _emit_outputs_if_available(result: Dict[str, Any]) -> None:
    if Kestra is None:
        return
    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "cuil": str(result.get("cuil") or ""),
            "nombre": str(result.get("nombre") or ""),
            "apellido": str(result.get("apellido") or ""),
            "disponible": float(result.get("disponible") or 0.0),
            "tope_descuento": float(result.get("tope_descuento") or 0.0),
            "error": str(result.get("error") or ""),
        }
    )


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Falta la variable {name}")
    return value


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path}"


def _origin_and_referer(base_url: str, referer_path: str) -> tuple[str, str]:
    origin = base_url.rstrip("/")
    referer = _join_url(origin, referer_path)
    return origin, referer


if __name__ == "__main__":
    raise SystemExit(main())
