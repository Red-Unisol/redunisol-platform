import importlib.util
import shutil
import zipfile
from pathlib import Path

import pytest


def builder():
    source = Path(__file__).resolve().parents[1] / "deploy/build_plugin.py"
    spec = importlib.util.spec_from_file_location("vimarx_plugin_builder_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_portable_zip_is_self_contained_and_reproducible(tmp_path):
    module = builder()
    first = module.build(tmp_path / "one.zip")
    second = module.build(tmp_path / "two.zip")
    assert first["sha256"] == second["sha256"]
    assert first["files"] == 6
    with zipfile.ZipFile(tmp_path / "one.zip") as archive:
        assert all(path.startswith("vimarx-celesol/") for path in archive.namelist())
        assert all("credentials" not in path and ".env" not in path for path in archive.namelist())
        assert b'https://mcp.redunisol.com.ar/mcp' in archive.read("vimarx-celesol/mcp.json")
        assert all(b'asdk_app_' not in archive.read(path) for path in archive.namelist())


def test_packaging_rejects_secret_or_unrelated_files(tmp_path):
    module = builder()
    copied = tmp_path / "vimarx-celesol"
    shutil.copytree(module.PACKAGE, copied)
    (copied / ".env").write_text("not-a-real-secret")
    with pytest.raises(ValueError):
        module.build(tmp_path / "bad.zip", copied)


def test_packaging_refuses_archive_inside_source():
    module = builder()
    with pytest.raises(ValueError):
        module.build(module.PACKAGE / "nested.zip")
