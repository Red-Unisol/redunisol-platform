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
KNOWN_DOMAINS = (
    "marketing-crm",
    "analisis-credito",
    "ahorros-amt",
    "cobranzas",
    "contabilidad",
)
NAMESPACE_PREFIX = "redunisol"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy flows and namespace files to Kestra.")
    parser.add_argument("--environment", required=True, choices=["dev", "prod"])
    parser.add_argument("--domain", choices=KNOWN_DOMAINS)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def get_target_domains(selected_domain: str | None) -> list[str]:
    if selected_domain:
        return [selected_domain]
    return [domain for domain in KNOWN_DOMAINS if (DOMAIN_ROOT / domain).exists()]


def get_target_namespace(domain: str, environment: str) -> str:
    return f"{NAMESPACE_PREFIX}.{environment}.{domain}"


def iter_files(base_dir: Path, pattern: str) -> Iterable[Path]:
    if not base_dir.exists():
        return []
    return sorted(path for path in base_dir.rglob(pattern) if path.is_file())


def normalize_flow_source(flow_path: Path, target_namespace: str, environment: str) -> str:
    payload = yaml.safe_load(flow_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Invalid flow definition in {flow_path}")

    payload["namespace"] = target_namespace

    labels = payload.get("labels") or {}
    if not isinstance(labels, dict):
        raise ValueError(f"Invalid labels block in {flow_path}")
    labels["env"] = environment
    payload["labels"] = labels

    return yaml.safe_dump(payload, sort_keys=False, allow_unicode=False)


def build_session(kestra_url: str, username: str, password: str) -> requests.Session:
    session = requests.Session()
    session.auth = HTTPBasicAuth(username, password)
    session.headers.update({"Accept": "application/json"})
    session.base_url = kestra_url.rstrip("/")
    return session


def ensure_success(response: requests.Response, action: str) -> None:
    if response.status_code >= 400:
        raise RuntimeError(f"{action} failed with {response.status_code}: {response.text[:500]}")


def deploy_flow(session: requests.Session, tenant: str, flow_path: Path, target_namespace: str, environment: str, dry_run: bool) -> None:
    source = normalize_flow_source(flow_path, target_namespace, environment)
    print(f"  flow -> {flow_path.relative_to(ROOT)} => {target_namespace}")
    if dry_run:
        return

    response = session.post(
        f"{session.base_url}/api/v1/{tenant}/flows",
        data=source.encode("utf-8"),
        headers={"Content-Type": "application/x-yaml"},
        timeout=30,
    )
    ensure_success(response, f"Deploy flow {flow_path.name}")


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


def deploy_domain(session: requests.Session, tenant: str, domain: str, environment: str, dry_run: bool) -> None:
    domain_root = DOMAIN_ROOT / domain
    flows_root = domain_root / "flows"
    files_root = domain_root / "files"
    target_namespace = get_target_namespace(domain, environment)

    print(f"Deploying domain '{domain}' to namespace '{target_namespace}'")

    flow_files = list(iter_files(flows_root, "*.yaml")) + list(iter_files(flows_root, "*.yml"))
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
        deploy_namespace_file(session, tenant, target_namespace, files_root, file_path, dry_run)


def main() -> int:
    args = parse_args()

    kestra_url = os.getenv("KESTRA_URL")
    kestra_username = os.getenv("KESTRA_USERNAME")
    kestra_password = os.getenv("KESTRA_PASSWORD")
    tenant = os.getenv("KESTRA_TENANT", DEFAULT_TENANT)

    if not args.dry_run and not all([kestra_url, kestra_username, kestra_password]):
        print("Missing KESTRA_URL, KESTRA_USERNAME or KESTRA_PASSWORD.")
        return 1

    target_domains = get_target_domains(args.domain)
    session = None if args.dry_run else build_session(kestra_url, kestra_username, kestra_password)

    print(f"Preparing deploy to {args.environment}: {', '.join(target_domains)}")
    if args.dry_run:
        print("Dry-run enabled: no changes will be sent to Kestra.")

    for domain in target_domains:
        deploy_domain(session, tenant, domain, args.environment, args.dry_run)

    print("Deploy completed.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
