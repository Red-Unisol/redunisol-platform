from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass

from .workflow import ClientRole


PBKDF2_ITERATIONS = 310_000
HASH_SCHEME = "pbkdf2_sha256"


class AuthenticationError(Exception):
    """Raised when authentication fails."""


@dataclass(frozen=True)
class AuthenticatedClient:
    client_id: str
    role: ClientRole
    display_name: str | None = None


def hash_client_secret(secret: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        secret.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return (
        f"{HASH_SCHEME}${PBKDF2_ITERATIONS}$"
        f"{salt.hex()}${digest.hex()}"
    )


def verify_client_secret(secret: str, stored_hash: str) -> bool:
    try:
        scheme, raw_iterations, salt_hex, digest_hex = stored_hash.split("$", 3)
    except ValueError:
        return False
    if scheme != HASH_SCHEME:
        return False
    try:
        iterations = int(raw_iterations)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    computed = hashlib.pbkdf2_hmac(
        "sha256",
        secret.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(computed, expected)


def verify_metamap_signature(
    *,
    secret: str | None,
    signature: str | None,
    payload_body: bytes,
) -> bool:
    if secret is None:
        return True
    if not signature:
        return False
    expected = hmac.new(
        secret.encode("utf-8"),
        payload_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature.strip())
