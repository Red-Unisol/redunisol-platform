from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from html.parser import HTMLParser
import http.cookiejar
import json
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

from .config import Config


class SourceError(RuntimeError):
    """Messages must not include download URLs, cookies or form credentials."""


def check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.monotonic() >= deadline:
        raise SourceError("BCRA refresh exceeded its time budget or nightly window")


def request_timeout(config: Config, deadline: float | None) -> float:
    check_deadline(deadline)
    return min(config.timeout, max(0.1, deadline - time.monotonic())) if deadline is not None else config.timeout


@dataclass(frozen=True)
class Asset:
    name: str
    kind: str
    period: str
    url: str = field(repr=False)
    form: dict[str, str] = field(default_factory=dict, repr=False)


class CatalogParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_form = False
        self.form: dict[str, str] = {}
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "form":
            self.in_form = values.get("id") == "form-id"
        if tag == "input" and self.in_form and values.get("name"):
            self.form[str(values["name"])] = values.get("value") or ""
        if tag == "a" and values.get("onclick"):
            match = re.fullmatch(
                r"\s*Confirmacion\((.+),\s*'([^']+)'\)\s*;?\s*", values["onclick"] or ""
            )
            if match:
                # The official page concatenates quoted literals. Never execute its JS.
                expression, name = match.groups()
                if re.sub(r"'[^']*'|\+|\s", "", expression):
                    raise SourceError("Unsupported BCRA download link format")
                url = "".join(re.findall(r"'([^']*)'", expression))
                self.links.append((name.upper(), url))

    def handle_endtag(self, tag: str) -> None:
        if tag == "form":
            self.in_form = False


def parse_catalog(html: str) -> list[Asset]:
    parser = CatalogParser()
    parser.feed(html)
    found: dict[tuple[str, str], Asset] = {}
    for name, url in parser.links:
        match = re.fullmatch(r"(\d{6})(DEUDORES|INFRET|INFRETPA)\.7Z", name)
        if not match:
            continue
        period, kind = match.groups()
        if not 1 <= int(period[4:]) <= 12:
            raise SourceError("Invalid BCRA publication period")
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.hostname != "mft.bcra.gob.ar":
            raise SourceError("Unexpected BCRA download host")
        key = period, kind
        if key in found:
            raise SourceError("Duplicate BCRA archive in catalog")
        found[key] = Asset(name, kind, period, url, dict(parser.form))
    periods = [period for period, kind in found if kind == "DEUDORES"]
    if not periods:
        raise SourceError("No monthly DEUDORES archive in BCRA catalog (authentication may be required)")
    latest = max(periods)
    try:
        return [found[latest, kind] for kind in ("DEUDORES", "INFRET", "INFRETPA")]
    except KeyError:
        raise SourceError("Incomplete BCRA publication: missing rectification archives") from None


class SourceClient:
    def __init__(self, config: Config, *, deadline: float | None = None) -> None:
        self.config = config
        self.deadline = deadline
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def catalog(self) -> list[Asset]:
        try:
            request = Request(self.config.catalog_url, headers={"User-Agent": "Mozilla/5.0"})
            with self.opener.open(request, timeout=request_timeout(self.config, self.deadline)) as response:
                body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise SourceError("BCRA catalog exceeds size limit")
            return parse_catalog(body.decode("utf-8-sig"))
        except SourceError:
            raise
        except Exception:
            raise SourceError("Unable to read BCRA catalog") from None

    def acknowledge_terms(self, asset: Asset) -> str:
        request = Request(
            self.config.catalog_url.rstrip("/") + "/Log_Archivo",
            data=urlencode({"Name": asset.name}).encode(),
            headers={"User-Agent": "Mozilla/5.0",
                     "Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=request_timeout(self.config, self.deadline)) as response:
                result = json.loads(response.read(65536))
            if not isinstance(result, dict) or "result" not in result:
                raise SourceError("Unexpected BCRA download-log response")
            if result["result"] is True:
                return "accepted"
            if result["result"] is None:
                # Observed 2026-10-21: the public catalog's logging endpoint
                # returns null, while its own session authorizes the 7z download.
                # Operator consent is still mandatory. Explicit denial is fatal;
                # null is recorded, and MFT must independently return a real archive.
                return "null_response"
            raise SourceError("BCRA did not acknowledge the accepted download terms")
        except SourceError:
            raise
        except Exception:
            raise SourceError("Unable to acknowledge BCRA download terms; verify catalog session") from None

    def download(self, asset: Asset, target: Path) -> dict:
        if not self.config.terms_accepted:
            raise SourceError("BCRA terms must be accepted by the operator before downloading")
        terms_log_result = self.acknowledge_terms(asset)
        # Use the official form's POST, including its hidden fields. A GET can return
        # an HTML login page with HTTP 200 instead of the archive.
        for attempt in range(3):
            try:
                request = Request(
                    asset.url,
                    data=urlencode(asset.form).encode("utf-8"),
                    headers={
                        "User-Agent": "Mozilla/5.0",
                        "Referer": self.config.catalog_url,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    method="POST",
                )
                digest = hashlib.sha256()
                total = 0
                with self.opener.open(request, timeout=request_timeout(self.config, self.deadline)) as response, target.open("wb") as output:
                    signature = response.read(6)
                    if signature != b"7z\xbc\xaf\x27\x1c":
                        raise SourceError("BCRA returned no 7z archive; verify MFT access and accepted terms")
                    output.write(signature)
                    digest.update(signature)
                    total = len(signature)
                    while chunk := response.read(1024 * 1024):
                        check_deadline(self.deadline)
                        total += len(chunk)
                        if total > self.config.max_download_bytes:
                            raise SourceError("BCRA archive exceeds download size limit")
                        output.write(chunk)
                        digest.update(chunk)
                    length = response.headers.get("Content-Length")
                    if length and int(length) != total:
                        raise SourceError("Truncated BCRA archive")
                return {"name": asset.name, "kind": asset.kind, "sha256": digest.hexdigest(),
                        "bytes": total, "terms_log_result": terms_log_result}
            except Exception as exc:
                target.unlink(missing_ok=True)
                if isinstance(exc, SourceError):
                    raise
                if attempt == 2:
                    raise SourceError("BCRA archive download failed after three attempts") from None
                time.sleep(2 ** attempt)
        raise AssertionError("unreachable")


def content_version(assets: list[dict]) -> str:
    content = [(item["kind"], item["sha256"]) for item in assets]
    return hashlib.sha256(json.dumps(["monthly-v1", content]).encode()).hexdigest()
