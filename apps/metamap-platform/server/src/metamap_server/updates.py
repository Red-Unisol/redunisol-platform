"""Public, read-only distribution of signed desktop releases; no app environments."""
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse


def update_router(root: Path = Path("/updates/transferencias")) -> APIRouter:
    router = APIRouter(prefix="/updates/transferencias", tags=["desktop-updates"])

    def serve(relative: str, cache: str) -> FileResponse:
        path = (root / relative).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(path, headers={"Cache-Control": cache,
                                          "X-Content-Type-Options": "nosniff"})

    @router.get("/latest.json")
    def latest() -> FileResponse:
        return serve("latest.json", "no-store")

    @router.get("/{version}/{filename}")
    def artifact(version: str, filename: str) -> FileResponse:
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) or filename not in {
            "transferencias-celesol.exe", "manifest.json", "manifest.sig"
        }:
            raise HTTPException(status_code=404)
        return serve(f"{version}/{filename}", "public, max-age=31536000, immutable")

    return router
