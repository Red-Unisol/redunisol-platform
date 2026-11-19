"""Load the reviewed, pure subset of the Kestra policy in isolation."""

from hashlib import sha256
from importlib import import_module
from importlib.machinery import ModuleSpec
from importlib.util import module_from_spec
from pathlib import Path
import sys

SOURCES = (
    "attribution.py", "catalogs.py", "commercial_prequalification.py",
    "input_parser.py", "normalization.py", "qualification.py",
)
ROOT = Path(__file__).resolve().parents[1]
PACKAGED = ROOT / "kestra_policy"
SOURCE_DIR = PACKAGED if PACKAGED.is_dir() else (
    ROOT.parent.parent / "kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor"
)

# The full Kestra package initializer loads CRM orchestration. This namespace
# exposes only its pure policy modules, with no changes to the process import path.
package_name = f"{__package__}._kestra_policy"
spec = ModuleSpec(package_name, loader=None, is_package=True)
spec.submodule_search_locations = [str(SOURCE_DIR)]
sys.modules[package_name] = module_from_spec(spec)


def fingerprint():
    digest = sha256()
    for name in SOURCES:
        digest.update(name.encode("utf-8") + b"\0")
        digest.update((SOURCE_DIR / name).read_text(encoding="utf-8").encode("utf-8") + b"\0")
    return digest.hexdigest()


POLICY_SHA256 = fingerprint()
catalogs = import_module(f"{package_name}.catalogs")
commercial = import_module(f"{package_name}.commercial_prequalification")
input_parser = import_module(f"{package_name}.input_parser")
rules = import_module(f"{package_name}.qualification")
