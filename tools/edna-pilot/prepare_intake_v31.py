"""Prepare one Git-managed stage of the v3.1 release. Never calls a provider."""
import argparse
import base64
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "kestra/tools"))
from manage_encrypted_env import FORMAT_ASSOCIATED_DATA, load_aessiv

RECEIVER = ROOT / "kestra/platform/infra/kestra-runtime.env.enc"
SENDER = ROOT / "web/redunisol-web/deploy/redunisol-web.prod.env.enc"
V3 = "950118281197789"
LEGACY = {"3298964390491520", "995212369590508", V3}
NON_INTAKE = {"1850162769693486", "1993586314642842"}


def field(content, cipher, name, value=None):
    # Each runtime setting has its own authenticated ciphertext. Preserve every
    # other line byte-for-byte, including comments, secrets and line endings.
    pattern = rb"^" + name.encode() + rb"=([^\r\n]+)"
    matches = list(re.finditer(pattern, content, re.MULTILINE))
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one configured {name}")
    match = matches[0]
    aad = [FORMAT_ASSOCIATED_DATA, name.encode()]
    current = cipher.decrypt(base64.urlsafe_b64decode(match[1]), aad).decode()
    if value is None:
        return current
    replacement = base64.urlsafe_b64encode(cipher.encrypt(value.encode(), aad))
    return content[:match.start(1)] + replacement + content[match.end(1):]


def prepare(stage, flow, cipher, receiver, sender):
    if not re.fullmatch(r"[1-9][0-9]{0,17}", flow) or flow in LEGACY | NON_INTAKE:
        raise ValueError("Provide the new published Meta intake Flow ID")
    accepted_field = "ENV_EDNA_INTAKE_ACCEPTED_FLOW_IDS"
    primary_field = "ENV_EDNA_INTAKE_FLOW_ID"
    accepted = [v.strip() for v in field(receiver, cipher, accepted_field).split(",")]
    primary = field(receiver, cipher, primary_field)
    if not LEGACY.issubset(accepted) or primary not in {V3, flow}:
        raise ValueError("Unexpected receiver baseline: verify the published intake versions")
    if stage == "receiver":
        if flow not in accepted:
            accepted.append(flow)
        updated = field(receiver, cipher, accepted_field, ",".join(accepted))
        return field(updated, cipher, primary_field, flow)
    if primary != flow or flow not in accepted:
        raise ValueError("Prepare and verify the receiver before preparing the sender")
    current = field(sender, cipher, "EDNA_INTAKE_FLOW_ID")
    batch = field(sender, cipher, "EDNA_INTAKE_PILOT_ID")
    if (current, batch) not in {(V3, "website-intake-v3"), (flow, "website-intake-v3-1")}:
        raise ValueError("Unexpected sender Flow or pilot; inspect its current admissions")
    if field(sender, cipher, "EDNA_INTAKE_PILOT_LIMIT") != "unlimited":
        raise ValueError("Unexpected pilot capacity")
    updated = field(sender, cipher, "EDNA_INTAKE_FLOW_ID", flow)
    return field(updated, cipher, "EDNA_INTAKE_PILOT_ID", "website-intake-v3-1")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("receiver", "sender"))
    parser.add_argument("--published-id", required=True)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--write", action="store_true", help="Write the encrypted Git file; default is a dry run")
    args = parser.parse_args()
    cipher = load_aessiv(args.key_file)
    receiver, sender = RECEIVER.read_bytes(), SENDER.read_bytes()
    updated = prepare(args.stage, args.published_id, cipher, receiver, sender)
    target, previous = (RECEIVER, receiver) if args.stage == "receiver" else (SENDER, sender)
    if previous == updated:
        print(f"{args.stage}: already prepared")
    elif args.write:
        target.write_bytes(updated)
        print(f"{args.stage}: updated {target.relative_to(ROOT)}")
    else:
        print(f"{args.stage}: changes available for {target.relative_to(ROOT)} (dry run)")
