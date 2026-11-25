"""Reconcile the production Marketing CRM namespace with an immutable Git checkout."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

import yaml

import deploy_kestra as deploy


TARGET = "marketing-crm"
ENVIRONMENT = "prod"
NAMESPACE = deploy.get_target_namespace(TARGET, ENVIRONMENT)
RECEIPT_FILE = "_redunisol_marketing_crm_deployment.json"
INPUT_PATHS = (
    "kestra/automations/marketing-crm/files",
    "kestra/automations/marketing-crm/flows",
    "kestra/tools/deploy_kestra.py",
    "kestra/tools/requirements.txt",
    "kestra/tools/reconcile_marketing_crm.py",
)


def desired_revision(repo: Path) -> tuple[str, str]:
    # Directory object IDs cover file names, modes and contents recursively.
    revisions = subprocess.check_output(
        ["git", "rev-parse", "HEAD", *(f"HEAD:{path}" for path in INPUT_PATHS)],
        cwd=repo, text=True,
    ).splitlines()
    if len(revisions) != len(INPUT_PATHS) + 1 or any(
        not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", oid) for oid in revisions
    ):
        raise RuntimeError("Cannot identify all deployment inputs in Git")
    inputs = dict(zip(INPUT_PATHS, revisions[1:], strict=True))
    fingerprint = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    return revisions[0], fingerprint


def read_receipt(session, tenant: str) -> dict | None:
    response = session.get(
        f"{session.base_url}/api/v1/{tenant}/namespaces/{NAMESPACE}/files",
        params={"path": f"/{RECEIPT_FILE}"},
        headers={"Accept": "application/octet-stream"}, timeout=30,
    )
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise RuntimeError(f"Cannot read deployment receipt (HTTP {response.status_code})")
    try:
        receipt = json.loads(response.content)
    except (ValueError, UnicodeDecodeError):
        raise RuntimeError("Invalid deployment receipt JSON") from None
    if not (
        isinstance(receipt, dict)
        and type(receipt.get("schema")) is int and receipt["schema"] == 1
        and receipt.get("tenant") == tenant and receipt.get("namespace") == NAMESPACE
        and receipt.get("state") in ("pending", "applied")
        and isinstance(receipt.get("commit_sha"), str)
        and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", receipt["commit_sha"])
        and isinstance(receipt.get("fingerprint"), str)
        and re.fullmatch(r"[0-9a-f]{64}", receipt["fingerprint"])
    ):
        raise RuntimeError("Invalid deployment receipt schema, identity or state")
    return receipt


def record_state(session, tenant: str, commit_sha: str, fingerprint: str, state: str) -> None:
    receipt = {
        "schema": 1, "tenant": tenant, "namespace": NAMESPACE, "state": state,
        "commit_sha": commit_sha, "fingerprint": fingerprint,
    }
    # Use the same upload + exact readback contract as the namespace files.
    with tempfile.TemporaryDirectory(dir=deploy.ROOT) as dirname:
        root = Path(dirname)
        path = root / RECEIPT_FILE
        path.write_text(json.dumps(receipt, sort_keys=True) + "\n", encoding="utf-8")
        deploy.deploy_namespace_file(session, tenant, NAMESPACE, root, path, False)


def verify_flows(session, tenant: str) -> None:
    flows_root, _ = deploy.get_target_roots(TARGET)
    for path in sorted([*deploy.iter_files(flows_root, "*.yaml"), *deploy.iter_files(flows_root, "*.yml")]):
        expected = deploy.normalize_flow_source(path, NAMESPACE, ENVIRONMENT)
        flow_id = yaml.safe_load(expected)["id"]
        url = deploy.get_flow_url(session, tenant, NAMESPACE, flow_id)
        response = session.get(url, params={"source": "true"}, timeout=30)
        if response.status_code != 200:
            raise RuntimeError(f"Cannot verify flow {flow_id} (HTTP {response.status_code})")
        try:
            data = response.json()
            actual = data.get("source") if isinstance(data, dict) else None
        except ValueError:
            raise RuntimeError(f"Invalid source for flow {flow_id}") from None
        if actual != expected:
            raise RuntimeError(f"Flow {flow_id} source differs from Git")


def reconcile(session, tenant: str, commit_sha: str, fingerprint: str, command: str, force: bool) -> None:
    receipt = read_receipt(session, tenant)
    needed = not receipt or receipt["state"] != "applied" or receipt["fingerprint"] != fingerprint
    if command == "check":
        output = f"needed={str(needed).lower()}"
        print(output)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
                print(output, file=handle)
        return
    if not needed and not force:
        print(f"{NAMESPACE} already has the requested inputs (applied at {receipt['commit_sha']})")
        return
    _, files_root = deploy.get_target_roots(TARGET)
    if (files_root / RECEIPT_FILE).exists():
        raise RuntimeError(f"The namespace path /{RECEIPT_FILE} is reserved for deployment receipts")
    # Invalidate the old receipt before touching the first resource. On a failure
    # or revert a subsequent run must repair even if the old fingerprint matches.
    record_state(session, tenant, commit_sha, fingerprint, "pending")
    deploy.deploy_target(session, tenant, TARGET, ENVIRONMENT, False)
    verify_flows(session, tenant)
    record_state(session, tenant, commit_sha, fingerprint, "applied")
    print(f"Verified deployment of {NAMESPACE} at {commit_sha} (fingerprint {fingerprint})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "apply"])
    parser.add_argument("--force", action="store_true", help="Reapply even when the receipt matches")
    args = parser.parse_args()
    if args.force and args.command != "apply":
        parser.error("--force requires apply")
    commit_sha, fingerprint = desired_revision(deploy.ROOT.parent)
    session = deploy.build_session(
        os.environ["KESTRA_URL"], os.environ["KESTRA_USERNAME"], os.environ["KESTRA_PASSWORD"]
    )
    with session:
        reconcile(session, os.environ.get("KESTRA_TENANT") or deploy.DEFAULT_TENANT,
                  commit_sha, fingerprint, args.command, args.force)


if __name__ == "__main__":
    main()
