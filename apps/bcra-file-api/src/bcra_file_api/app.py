from __future__ import annotations

from contextlib import asynccontextmanager
import hmac
import json
import os
import re
import uuid

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn

from .config import Config
from .refresh import RefreshManager
from .store import lookup
from .bundle import active_bundle, inside
from .compat import compatible_response, INVALID_ID
from .source import SourceError


def normalize_identification(body: object) -> str:
    if not isinstance(body, dict):
        raise ValueError("Expected a JSON object")
    value = body.get("identificacion", body.get("cuil", body.get("cuit", "")))
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError("Expected an 11-digit CUIT/CUIL/CDI")
    text = str(value).strip()
    if not re.fullmatch(r"[0-9 -]+", text):
        raise ValueError("Expected an 11-digit CUIT/CUIL/CDI")
    text = text.replace("-", "").replace(" ", "")
    if len(text) != 11:
        raise ValueError("Expected an 11-digit CUIT/CUIL/CDI")
    return text


def response(status: int, payload: dict) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})


async def read_json(request: Request) -> object:
    try:
        length = int(request.headers.get("content-length", "0"))
        if not 0 < length <= 4096 or request.headers.get("transfer-encoding"):
            raise ValueError
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 4096:
                raise ValueError
        if len(body) != length:
            raise ValueError
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON request body") from None


def lookup_response(manager: RefreshManager, identification: str) -> JSONResponse:
    with manager.snapshot_lock:
        state = manager.status()
        if not state["ready"]:
            return response(503, {
                "status": 503, "errorMessages": ["No validated and recently checked BCRA dataset"],
                "meta": {"check_stale": state["check_stale"], "dataset": state["dataset"]},
            })
        bundle = active_bundle(manager.config.data_dir)
        database = inside(manager.config.data_dir, bundle['components']['current']['path']) if bundle else manager.database
        result = lookup(database, identification)
        result["meta"]["last_successful_check_at"] = state['last_successful_check_at']
        if result["status"] == 404:
            result["errorMessages"] = ["Identification absent from the loaded monthly publication"]
        return response(result["status"], result)


def compatibility_response(manager: RefreshManager, identification: str, historical=False) -> JSONResponse:
    if not re.fullmatch(r'[0-9]{11}', identification):
        return response(400, INVALID_ID)
    with manager.snapshot_lock:
        state = manager.status()
        if not state['ready']:
            return response(503, {'status': 503, 'errorMessages': ['No hay una publicación BCRA validada y vigente.']})
        bundle = active_bundle(manager.config.data_dir)
        database = inside(manager.config.data_dir, bundle['components']['current']['path']) if bundle else manager.database
        body = compatible_response(manager.config.data_dir, database, bundle, identification, historical)
        result = response(body['status'], body)
        result.headers['X-BCRA-Source'] = 'monthly-files'
        result.headers['X-BCRA-Period'] = state['dataset']['period']
        result.headers['X-BCRA-Version'] = state['dataset']['version']
        result.headers['X-BCRA-Checked-At'] = state['last_successful_check_at']
        if bundle:
            result.headers['X-BCRA-Normal-Date-Precision'] = 'month'
        return result


def create_app(config: Config | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Exactly one manager per server process; startup never triggers an import.
        app.state.manager = RefreshManager(config or Config.from_env())
        yield

    app = FastAPI(
        title="BCRA File API", lifespan=lifespan,
        docs_url=None, redoc_url=None, openapi_url=None,
    )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        return response(exc.status_code, {
            "status": exc.status_code, "errorMessages": [str(exc.detail)],
        })

    @app.exception_handler(SourceError)
    async def source_error(request: Request, exc: SourceError):
        return response(503, {'status': 503, 'errorMessages': ['La publicación BCRA no está disponible.']})

    async def authorize(request: Request) -> None:
        expected = "Bearer " + request.app.state.manager.config.token
        provided = request.headers.get("authorization", "")
        if not hmac.compare_digest(provided.encode(), expected.encode()):
            raise HTTPException(401, "Unauthorized")

    @app.get("/health")
    async def health():
        return response(200, {"status": "up"})

    @app.get("/status", dependencies=[Depends(authorize)])
    def status(request: Request):
        return response(200, request.app.state.manager.status())

    @app.get("/jobs/{job_id}", dependencies=[Depends(authorize)])
    def job(job_id: str, request: Request):
        result = request.app.state.manager.job(job_id)
        if result is None:
            return response(404, {"status": 404, "errorMessages": ["Unknown refresh job"]})
        return response(500 if result["status"] == "failed" else 200, result)

    @app.post("/refresh", dependencies=[Depends(authorize)])
    async def refresh(request: Request):
        await read_json(request)
        request_id = request.headers.get("idempotency-key", uuid.uuid4().hex)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,150}", request_id):
            raise HTTPException(400, "Invalid idempotency key")
        result = await run_in_threadpool(request.app.state.manager.start, request_id)
        return response(202, result)

    @app.post("/lookup", dependencies=[Depends(authorize)])
    async def query(request: Request):
        body = await read_json(request)
        try:
            identification = normalize_identification(body)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        # sqlite3 is synchronous: queries run in the bounded thread pool rather
        # than blocking the ASGI event loop. No request or debt payload is logged.
        return await run_in_threadpool(
            lookup_response, request.app.state.manager, identification,
        )

    @app.get('/centraldedeudores/v1.0/Deudas/Historicas/{identificacion}', dependencies=[Depends(authorize)])
    @app.get('/CentralDeDeudores/v1.0/Deudas/Historicas/{identificacion}', dependencies=[Depends(authorize)])
    def historical(identificacion: str, request: Request):
        return compatibility_response(request.app.state.manager, identificacion, historical=True)

    @app.get('/centraldedeudores/v1.0/Deudas/{identificacion}', dependencies=[Depends(authorize)])
    @app.get('/CentralDeDeudores/v1.0/Deudas/{identificacion}', dependencies=[Depends(authorize)])
    def current(identificacion: str, request: Request):
        return compatibility_response(request.app.state.manager, identificacion)

    return app


def main():
    # RefreshManager coordinates its one background job in memory. Multiple
    # Uvicorn workers/replicas require shared coordination before being enabled.
    uvicorn.run(
        create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
        workers=1, access_log=False, server_header=False, proxy_headers=False,
        timeout_keep_alive=5, timeout_graceful_shutdown=15,
    )


if __name__ == "__main__":
    main()
