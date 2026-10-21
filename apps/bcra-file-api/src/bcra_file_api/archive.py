from __future__ import annotations

from contextlib import contextmanager
import io
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import time

from .source import SourceError


class Archive:
    def __init__(self, path: Path, executable: str = "7z", *, deadline: float | None = None) -> None:
        self.path = path
        self.executable = executable
        self.deadline = deadline
        try:
            result = subprocess.run(
                [executable, "l", "-slt", "--", str(path)],
                capture_output=True, timeout=120, check=True,
            )
        except (OSError, subprocess.SubprocessError):
            raise SourceError("Unable to list BCRA 7z archive") from None
        listing = result.stdout.decode("utf-8", errors="replace").replace("\r\n", "\n")
        if len(listing) > 2_000_000:
            raise SourceError("Archive has too many members")
        self.members: dict[str, str] = {}
        for block in listing.split("\n\n"):
            values = dict(
                line.split(" = ", 1) for line in block.splitlines() if " = " in line
            )
            if "Size" not in values or values.get("Folder") == "+":
                continue
            name = values.get("Path", "")
            basename = PurePosixPath(name.replace("\\", "/")).name.lower()
            if int(values["Size"]) > 64 * 1024**3:
                raise SourceError("Archive member exceeds uncompressed size limit")
            if basename in self.members:
                raise SourceError("Archive has duplicate member names")
            self.members[basename] = name

    @contextmanager
    def lines(self, basename: str):
        member = self.members.get(basename)
        if member is None:
            raise SourceError("Required BCRA archive member is missing: " + basename)
        # Stream selected members to stdout, never extract archive paths onto disk.
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(
                [self.executable, "x", "-so", "--", str(self.path), member],
                stdout=subprocess.PIPE, stderr=errors,
            )
            assert process.stdout is not None
            # The public 202608 name master contains undefined Windows-1252 bytes.
            # Preserve visible U+FFFD markers instead of guessing another encoding.
            # Numeric/layout validation remains strict; metadata counts name markers.
            reader = io.TextIOWrapper(process.stdout, encoding="cp1252", errors="replace")
            def records():
                for number, line in enumerate(iter(lambda: reader.readline(4097), ''), 1):
                    if self.deadline is not None and time.monotonic() > self.deadline:
                        raise SourceError('BCRA refresh exceeded its time budget')
                    if len(line) > 4096:
                        raise SourceError("BCRA record exceeds length limit")
                    if line.strip() and line.strip() != "\x1a":
                        yield number, line
            try:
                yield records()
                if process.wait(timeout=60) != 0:
                    raise SourceError("BCRA archive failed decompression/integrity validation")
            finally:
                reader.close()
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=30)
