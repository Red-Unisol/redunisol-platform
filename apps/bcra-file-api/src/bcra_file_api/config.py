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
    refresh_start_hour: int | None = None
    refresh_end_hour: int = 7
    refresh_timezone: str = "America/Argentina/Buenos_Aires"

    def __post_init__(self) -> None:
        if self.refresh_start_hour is not None and (
            not 0 <= self.refresh_start_hour < 24
            or not 0 <= self.refresh_end_hour < 24
            or self.refresh_start_hour == self.refresh_end_hour
        ):
            raise ValueError("Invalid BCRA refresh window")


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
            refresh_start_hour=(
                int(os.environ["BCRA_FILE_REFRESH_START_HOUR"])
                if os.environ.get("BCRA_FILE_REFRESH_START_HOUR") else None
            ),
            refresh_end_hour=int(os.environ.get("BCRA_FILE_REFRESH_END_HOUR", "7")),
            refresh_timezone=os.environ.get("BCRA_FILE_REFRESH_TIMEZONE", "America/Argentina/Buenos_Aires"),
        )
