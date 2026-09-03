#!/usr/bin/env python3
"""Validate that a Compose runtime env declares every referenced variable."""

from __future__ import annotations

import argparse
import base64
import binascii
from pathlib import Path
import re


COMPOSE_VARIABLE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}")
ENV_KEY = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=")
APPROVED_SELLER_POOLS = {
    "ENV_BITRIX24_DEAL_ROUND_ROBIN_USER_IDS": {
        "29",
        "10451",
        "68579",
        "71159",
        "90231",
        "110059",
        "113455",
        "113457",
        "116561",
    },
    "ENV_BITRIX24_DEAL_CORDOBA_JUBILADOS_USER_IDS": {
        "29",
        "10451",
        "68579",
        "71159",
        "90231",
        "110059",
        "116561",
    },
    "ENV_BITRIX24_DEAL_CORDOBA_UNC_USER_IDS": {"53121"},
    "ENV_BITRIX24_DEAL_CORDOBA_GENERAL_USER_IDS": {
        "29",
        "10451",
        "68579",
        "71159",
        "90231",
        "110059",
        "116561",
    },
}


def referenced_variables(compose_path: Path) -> set[str]:
    return set(COMPOSE_VARIABLE.findall(compose_path.read_text(encoding="utf-8")))


def declared_variables(env_path: Path) -> set[str]:
    declared: set[str] = set()
    for line in env_path.read_text(encoding="utf-8").splitlines():
        match = ENV_KEY.match(line.strip())
        if match:
            declared.add(match.group(1))
    return declared


def env_values(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if ENV_KEY.match(f"{key}="):
            values[key] = value
    return values


def decoded_runtime_secret(value: str) -> str:
    try:
        return base64.b64decode(value.encode("ascii"), validate=True).decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError, binascii.Error) as exc:
        raise ValueError("runtime secret is not valid base64-encoded UTF-8") from exc


def runtime_value_errors(env_path: Path) -> list[str]:
    values = env_values(env_path)
    errors: list[str] = []

    required = {
        "KESTRA_ADMIN_EMAIL",
        "KESTRA_ADMIN_PASSWORD",
        "SECRET_REPORTS_KESTRA_USERNAME",
        "SECRET_REPORTS_KESTRA_PASSWORD",
        *APPROVED_SELLER_POOLS,
    }
    missing = sorted(required - values.keys())
    if missing:
        return [f"missing required runtime value: {key}" for key in missing]

    try:
        reports_username = decoded_runtime_secret(
            values["SECRET_REPORTS_KESTRA_USERNAME"]
        )
        reports_password = decoded_runtime_secret(
            values["SECRET_REPORTS_KESTRA_PASSWORD"]
        )
    except ValueError as exc:
        errors.append(str(exc))
    else:
        if reports_username != values["KESTRA_ADMIN_EMAIL"]:
            errors.append("report username must match KESTRA_ADMIN_EMAIL")
        if reports_password != values["KESTRA_ADMIN_PASSWORD"]:
            errors.append("report password must match KESTRA_ADMIN_PASSWORD")

    for env_key, approved_users in APPROVED_SELLER_POOLS.items():
        configured_user_list = [
            user_id.strip()
            for user_id in values[env_key].split(",")
            if user_id.strip()
        ]
        if (
            set(configured_user_list) != approved_users
            or len(configured_user_list) != len(approved_users)
        ):
            errors.append(f"{env_key} does not match the approved seller set")

    return errors


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
    parser.add_argument(
        "--validate-values",
        action="store_true",
        help="Validate business-critical values in a decrypted runtime-format env.",
    )
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

    if args.validate_values:
        value_errors = runtime_value_errors(args.env)
        if value_errors:
            print("Runtime env contains invalid business-critical values:")
            for error in value_errors:
                print(f"- {error}")
            return 1

    print("Runtime env declares every required Compose variable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
