from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent
REQUIRED_DIRS = [
    ROOT / 'platform' / 'infra',
    ROOT / 'platform' / 'system' / 'flows',
    ROOT / 'automations',
    REPO_ROOT / '.github' / 'workflows',
]
LEGACY_JSON_FILTER = re.compile(r"\|\s*json\b")


def legacy_json_filter_files() -> list[Path]:
    flow_files = ROOT.glob('automations/*/flows/*.yaml')
    return [
        path
        for path in flow_files
        if LEGACY_JSON_FILTER.search(path.read_text(encoding='utf-8'))
    ]


def main() -> int:
    missing = [str(path.relative_to(ROOT)) for path in REQUIRED_DIRS if not path.exists()]
    if missing:
        print('Missing required directories:')
        for item in missing:
            print(f'- {item}')
        return 1

    incompatible_flows = legacy_json_filter_files()
    if incompatible_flows:
        print('Kestra 2 incompatible Pebble filter "| json" found; use "| toJson":')
        for path in incompatible_flows:
            print(f'- {path.relative_to(REPO_ROOT)}')
        return 1

    print('Repository structure is valid.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
