import argparse
import os
from pathlib import Path
from typing import Iterable

import requests
import yaml
from requests.auth import HTTPBasicAuth

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TENANT = "main"
DOMAIN_ROOT = ROOT / "automations"
SYSTEM_ROOT = ROOT / "platform" / "system"
SYSTEM_TARGET = "system"
KNOWN_DOMAINS = (
    "marketing-crm",
    "analisis-credito",
    "ahorros-amt",
    "cobranzas",
    "contabilidad",
)
KNOWN_DEPLOY_TARGETS = KNOWN_DOMAINS + (SYSTEM_TARGET,)
NAMESPACE_PREFIX = "redunisol"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deploy flows and namespace files to Kestra."
    )
    parser.add_argument("--environment", required=True, choices=["dev", "prod"])

    target_group = parser.add_mutually_exclusive_group()
    target_group.add_argument("--target", choices=KNOWN_DEPLOY_TARGETS)
    target_group.add_argument(
        "--domain", dest="legacy_domain", choices=KNOWN_DOMAINS, help=argparse.SUPPRESS
    )

    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def get_deploy_targets(selected_target: str | None) -> list[str]:
    if selected_target:
        return [selected_target]

    targets = [domain for domain in KNOWN_DOMAINS if (DOMAIN_ROOT / domain).exists()]
    if SYSTEM_ROOT.exists():
        targets.append(SYSTEM_TARGET)
    return targets


def get_target_namespace(target: str, environment: str) -> str:
    return f"{NAMESPACE_PREFIX}.{environment}.{target}"


def get_target_roots(target: str) -> tuple[Path, Path]:
    if target == SYSTEM_TARGET:
        target_root = SYSTEM_ROOT
    else:
        target_root = DOMAIN_ROOT / target

    return target_root / "flows", target_root / "files"


def iter_files(base_dir: Path, pattern: str) -> Iterable[Path]:
    if not base_dir.exists():
        return []
    return sorted(path for path in base_dir.rglob(pattern) if path.is_file())


def normalize_flow_source(
    flow_path: Path, target_namespace: str, environment: str
) -> str:
    payload = yaml.safe_load(flow_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Invalid flow definition in {flow_path}")

    payload["namespace"] = target_namespace

    labels = payload.get("labels") or {}
    if not isinstance(labels, dict):
        raise ValueError(f"Invalid labels block in {flow_path}")
    labels["env"] = environment
    payload["labels"] = labels
    _normalize_triggers(payload, labels, environment)

    return yaml.safe_dump(payload, sort_keys=False, allow_unicode=False)


def _normalize_triggers(payload: dict, labels: dict, environment: str) -> None:
    schedule_scope = str(labels.get("schedule_scope") or "").strip().lower()
    if environment != "prod" and schedule_scope == "prod_only":
        payload.pop("triggers", None)


def build_session(kestra_url: str, username: str, password: str) -> requests.Session:
    session = requests.Session()
    session.auth = HTTPBasicAuth(username, password)
    session.headers.update({"Accept": "application/json"})
    session.base_url = kestra_url.rstrip("/")
    return session


def ensure_success(response: requests.Response, action: str) -> None:
    if response.status_code >= 400:
        raise RuntimeError(
            f"{action} failed with {response.status_code}: {response.text[:500]}"
        )


def get_flow_url(
    session: requests.Session, tenant: str, namespace: str, flow_id: str
) -> str:
    return f"{session.base_url}/api/v1/{tenant}/flows/{namespace}/{flow_id}"


def flow_exists(
    session: requests.Session, tenant: str, namespace: str, flow_id: str
) -> bool:
    response = session.get(
        get_flow_url(session, tenant, namespace, flow_id),
        timeout=30,
    )
    if response.status_code == 404:
        return False

    ensure_success(response, f"Check flow {namespace}/{flow_id}")
    return True


def deploy_flow(
    session: requests.Session,
    tenant: str,
    flow_path: Path,
    target_namespace: str,
    environment: str,
    dry_run: bool,
) -> None:
    source = normalize_flow_source(flow_path, target_namespace, environment)
    flow_id = yaml.safe_load(source)["id"]
    print(f"  flow -> {flow_path.relative_to(ROOT)} => {target_namespace}")
    if dry_run:
        return

    headers = {"Content-Type": "application/x-yaml"}
    if flow_exists(session, tenant, target_namespace, flow_id):
        response = session.put(
            get_flow_url(session, tenant, target_namespace, flow_id),
            data=source.encode("utf-8"),
            headers=headers,
            timeout=30,
        )
        ensure_success(response, f"Update flow {flow_path.name}")
    else:
        response = session.post(
            f"{session.base_url}/api/v1/{tenant}/flows",
            data=source.encode("utf-8"),
            headers=headers,
            timeout=30,
        )
        ensure_success(response, f"Create flow {flow_path.name}")


def deploy_namespace_file(
    session: requests.Session,
    tenant: str,
    namespace: str,
    files_root: Path,
    file_path: Path,
    dry_run: bool,
) -> None:
    relative_path = file_path.relative_to(files_root).as_posix()
    target_path = f"/{relative_path}"
    print(f"  file -> {file_path.relative_to(ROOT)} => {namespace}:{target_path}")
    if dry_run:
        return

    with file_path.open("rb") as handle:
        response = session.post(
            f"{session.base_url}/api/v1/{tenant}/namespaces/{namespace}/files",
            params={"path": target_path},
            files={"fileContent": (file_path.name, handle)},
            timeout=30,
        )
    ensure_success(response, f"Upload file {relative_path}")


def deploy_target(
    session: requests.Session, tenant: str, target: str, environment: str, dry_run: bool
) -> None:
    flows_root, files_root = get_target_roots(target)
    target_namespace = get_target_namespace(target, environment)

    print(f"Deploying target '{target}' to namespace '{target_namespace}'")

    flow_files = list(iter_files(flows_root, "*.yaml")) + list(
        iter_files(flows_root, "*.yml")
    )
    namespace_files = [
        path
        for path in iter_files(files_root, "*")
        if ".gitkeep" not in path.parts and "__pycache__" not in path.parts
    ]

    if not flow_files and not namespace_files:
        print("  nothing to deploy")
        return

    for flow_path in flow_files:
        deploy_flow(session, tenant, flow_path, target_namespace, environment, dry_run)

    for file_path in namespace_files:
        deploy_namespace_file(
            session, tenant, target_namespace, files_root, file_path, dry_run
        )


def main() -> int:
    args = parse_args()

    kestra_url = os.getenv("KESTRA_URL")
    kestra_username = os.getenv("KESTRA_USERNAME")
    kestra_password = os.getenv("KESTRA_PASSWORD")
    tenant = os.getenv("KESTRA_TENANT", DEFAULT_TENANT)

    if not args.dry_run and not all([kestra_url, kestra_username, kestra_password]):
        print("Missing KESTRA_URL, KESTRA_USERNAME or KESTRA_PASSWORD.")
        return 1

    selected_target = args.target or args.legacy_domain
    deploy_targets = get_deploy_targets(selected_target)
    session = (
        None
        if args.dry_run
        else build_session(kestra_url, kestra_username, kestra_password)
    )

    print(f"Preparing deploy to {args.environment}: {', '.join(deploy_targets)}")
    if args.dry_run:
        print("Dry-run enabled: no changes will be sent to Kestra.")

    for target in deploy_targets:
        deploy_target(session, tenant, target, args.environment, args.dry_run)

    print("Deploy completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
