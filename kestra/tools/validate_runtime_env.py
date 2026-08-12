#!/usr/bin/env python3
"""Validate that a Compose runtime env declares every referenced variable."""

from __future__ import annotations

import argparse
from pathlib import Path
import re


COMPOSE_VARIABLE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}")
ENV_KEY = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=")


def referenced_variables(compose_path: Path) -> set[str]:
    return set(COMPOSE_VARIABLE.findall(compose_path.read_text(encoding="utf-8")))


def declared_variables(env_path: Path) -> set[str]:
    declared: set[str] = set()
    for line in env_path.read_text(encoding="utf-8").splitlines():
        match = ENV_KEY.match(line.strip())
        if match:
            declared.add(match.group(1))
    return declared


def missing_variables(
    compose_path: Path,
    env_path: Path,
    allowed_missing: set[str] | None = None,
) -> list[str]:
    allowed = allowed_missing or set()
    return sorted(
        referenced_variables(compose_path) - declared_variables(env_path) - allowed
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check that an env file declares all Compose variables."
    )
    parser.add_argument("--compose", required=True, type=Path)
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--allow-missing", action="append", default=[])
    args = parser.parse_args()

    missing = missing_variables(
        args.compose,
        args.env,
        set(args.allow_missing),
    )
    if missing:
        print("Runtime env is missing variables referenced by Compose:")
        for key in missing:
            print(f"- {key}")
        return 1

    print("Runtime env declares every required Compose variable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
