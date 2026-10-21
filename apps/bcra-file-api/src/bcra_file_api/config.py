from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path


@dataclass(frozen=True)
class Config:
    data_dir: Path
    token: str = field(repr=False)
    terms_accepted: bool = False
    catalog_url: str = "https://www5.bcra.gob.ar/ChequesyDeudores/Deudores"
    timeout: int = 90
    min_rows: int = 100_000
    min_row_ratio: float = 0.8
    max_download_bytes: int = 12 * 1024**3
    max_check_age_hours: int = 72
    seven_zip: str = "7z"

    @classmethod
    def from_env(cls) -> Config:
        token = os.environ.get("BCRA_FILE_API_TOKEN", "")
        if len(token) < 24:
            raise ValueError("BCRA_FILE_API_TOKEN must contain at least 24 characters")
        return cls(
            data_dir=Path(os.environ.get("BCRA_FILE_DATA_DIR", "/data")),
            token=token,
            terms_accepted=os.environ.get("BCRA_FILE_TERMS_ACCEPTED", "false").lower() == "true",
            catalog_url=os.environ.get("BCRA_FILE_CATALOG_URL", cls.catalog_url),
            min_rows=int(os.environ.get("BCRA_FILE_MIN_ROWS", "100000")),
            seven_zip=os.environ.get("BCRA_FILE_7Z", "7z"),
        )
