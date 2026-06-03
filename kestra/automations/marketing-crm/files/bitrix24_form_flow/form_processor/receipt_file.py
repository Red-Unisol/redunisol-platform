from __future__ import annotations

import base64
from pathlib import PurePosixPath
import re
from typing import Any
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


MAX_RECEIPT_BYTES = 10 * 1024 * 1024

_EXTENSIONS_BY_CONTENT_TYPE = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def build_bitrix_file_data(
    file_url: str,
    *,
    timeout_seconds: int,
    max_bytes: int = MAX_RECEIPT_BYTES,
) -> dict[str, Any]:
    parsed_url = urlparse(file_url)
    if parsed_url.scheme != "https":
        raise RuntimeError("El recibo debe estar disponible por una URL HTTPS.")

    request = Request(file_url, headers={"User-Agent": "redunisol-kestra/1.0"})
    with urlopen(request, timeout=timeout_seconds) as response:
        content_length = _optional_int(response.headers.get("content-length"))
        if content_length is not None and content_length > max_bytes:
            raise RuntimeError("El recibo supera el tamano maximo permitido.")

        content = response.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise RuntimeError("El recibo supera el tamano maximo permitido.")

        content_type = _normalize_content_type(response.headers.get("content-type"))

    filename = _filename_from_url(parsed_url.path, content_type)
    encoded_content = base64.b64encode(content).decode("ascii")
    return {"fileData": [filename, encoded_content]}


def _filename_from_url(path: str, content_type: str | None) -> str:
    raw_name = PurePosixPath(unquote(path)).name
    filename = _sanitize_filename(raw_name)

    if "." not in filename:
        extension = _EXTENSIONS_BY_CONTENT_TYPE.get(content_type or "", ".bin")
        filename = f"{filename}{extension}" if filename else f"recibo{extension}"

    return filename or "recibo.bin"


def _sanitize_filename(filename: str) -> str:
    filename = filename.strip()
    filename = re.sub(r"\s+", "_", filename)
    filename = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    filename = filename.strip("._-")
    return filename[:120]


def _normalize_content_type(value: str | None) -> str | None:
    if not value:
        return None
    return value.split(";", 1)[0].strip().lower() or None


def _optional_int(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None
