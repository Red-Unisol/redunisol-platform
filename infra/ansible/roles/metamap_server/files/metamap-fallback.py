"""Localhost fallback proxy using only dependencies already in the pinned image."""
import ssl
import urllib.error
import urllib.request
from fastapi import FastAPI, Request
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response, StreamingResponse

ORIGIN = "https://metamap-origin.redunisol.com.ar/metamap-platform"
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"}
MAX_BODY = 2 * 1024 * 1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None

def open_upstream(request):
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        return opener.open(request, timeout=300)
    except urllib.error.HTTPError as response:
        return response

def create_app(opener=open_upstream):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.api_route("/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    async def proxy(request: Request, path: str):
        raw_path = request.scope.get("raw_path", b"/").decode("ascii")
        query = request.scope.get("query_string", b"").decode("ascii")
        url = ORIGIN + raw_path + ("?" + query if query else "")
        headers = {name: value for name, value in request.headers.items() if name.lower() not in HOP}
        headers["user-agent"] = "RedUnisol-MetaMap-Fallback/1.0"
        data = None
        if request.method not in {"GET", "HEAD"}:
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > MAX_BODY:
                    return Response("Request too large", status_code=413)
            data = bytes(data)
        try:
            upstream = urllib.request.Request(url, data=data, method=request.method, headers=headers)
            response = await run_in_threadpool(opener, upstream)
        except (urllib.error.URLError, OSError):
            return Response("MetaMap temporarily unavailable", status_code=502, headers={"Retry-After": "15"})
        outgoing = {name: value for name, value in response.headers.items() if name.lower() not in HOP}
        outgoing["X-Metamap-Fallback"] = "dedicated"
        def chunks():
            try:
                while True:
                    block = response.read(65536)
                    if not block:
                        break
                    yield block
            finally:
                response.close()
        return StreamingResponse(chunks(), status_code=response.status, headers=outgoing, background=BackgroundTask(response.close))
    return app

app = create_app()
