import argparse
import base64
from dataclasses import dataclass
from pathlib import Path
import re
import sys

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.ciphers.aead import AESSIV


FORMAT_ASSOCIATED_DATA = b"encrypted-env:v1"
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_ENV_KEY_LENGTH = 64
SECRET_KEY_PREFIX = "SECRET_"
ADVISORY_BANNER = "# NO USAR BASE 64 PARA LOS SECRETOS EL TOOLING LO MANEJA POR SI MISMO"


@dataclass(frozen=True)
class EnvLine:
    kind: str
    raw: str
    key: str | None = None
    value: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Encrypt and decrypt runtime env files using a shared local key file."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate_key_parser = subparsers.add_parser("generate-key", help="Generate a shared key file.")
    generate_key_parser.add_argument("--output", required=True, help="Path to the key file to create.")
    generate_key_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite the output file if it already exists.",
    )

    encrypt_parser = subparsers.add_parser("encrypt", help="Encrypt a plaintext file.")
    add_common_file_args(encrypt_parser)

    decrypt_parser = subparsers.add_parser("decrypt", help="Decrypt an encrypted file.")
    add_common_file_args(decrypt_parser)

    encrypt_many_parser = subparsers.add_parser(
        "encrypt-many",
        help="Encrypt multiple plaintext files.",
    )
    add_common_many_args(encrypt_many_parser)

    decrypt_many_parser = subparsers.add_parser(
        "decrypt-many",
        help="Decrypt multiple encrypted files.",
    )
    add_common_many_args(decrypt_many_parser)

    return parser.parse_args()


def add_common_file_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--key-file", required=True, help="Path to the key file.")
    parser.add_argument("--input", required=True, help="Path to the input file.")
    parser.add_argument("--output", required=True, help="Path to the output file.")
    parser.add_argument(
        "--output-format",
        choices=["human", "runtime"],
        default="human",
        help="For decrypt operations, choose whether SECRET_* values are written in human-readable plaintext or runtime-ready format.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite the output file if it already exists.",
    )


def add_common_many_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--key-file", required=True, help="Path to the key file.")
    parser.add_argument(
        "--output-format",
        choices=["human", "runtime"],
        default="human",
        help="For decrypt operations, choose whether SECRET_* values are written in human-readable plaintext or runtime-ready format.",
    )
    parser.add_argument(
        "--pair",
        action="append",
        required=True,
        metavar="INPUT=OUTPUT",
        help="Mapping of input file to output file. Repeat for each file.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite output files if they already exist.",
    )


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def write_output(path: Path, content: bytes, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"Output file already exists: {path}")
    ensure_parent_dir(path)
    path.write_bytes(content)


def normalize_env_line_endings(content: bytes) -> bytes:
    # Keep encrypted env payloads portable across Windows and Linux runtimes.
    return content.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


<<<<<<< HEAD
def load_fernet(key_file: Path) -> Fernet:
=======
def load_key_bytes(key_file: Path) -> bytes:
>>>>>>> 818b193399ff42e849711e9392de102cdfe5832d
    if not key_file.exists():
        raise FileNotFoundError(f"Key file not found: {key_file}")

    encoded_key = key_file.read_text(encoding="utf-8").strip()
    if not encoded_key:
        raise ValueError(f"Key file is empty: {key_file}")

    try:
        decoded_key = base64.urlsafe_b64decode(encoded_key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ValueError(f"Key file is not a valid URL-safe base64 key: {key_file}") from exc

    if len(decoded_key) != 32:
        raise ValueError(
            f"Key file must decode to 32 bytes for AES-SIV compatibility: {key_file}"
        )

    return encoded_key.encode("ascii")


def load_fernet(key_file: Path) -> Fernet:
    return Fernet(load_key_bytes(key_file))


def load_aessiv(key_file: Path) -> AESSIV:
    encoded_key = load_key_bytes(key_file)
    raw_key = base64.urlsafe_b64decode(encoded_key)
    return AESSIV(raw_key)


def parse_pairs(pair_args: list[str]) -> list[tuple[Path, Path]]:
    pairs: list[tuple[Path, Path]] = []
    for raw_pair in pair_args:
        input_value, separator, output_value = raw_pair.partition("=")
        if separator != "=" or not input_value or not output_value:
            raise ValueError(
                f"Invalid --pair value: {raw_pair}. Expected INPUT=OUTPUT."
            )
        pairs.append((Path(input_value), Path(output_value)))
    return pairs


def parse_env_lines(content: bytes) -> list[EnvLine]:
    try:
        text = normalize_env_line_endings(content).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Env file must be valid UTF-8.") from exc

    lines: list[EnvLine] = []
    raw_lines = text[:-1].split("\n") if text.endswith("\n") else text.split("\n")
    for line_number, raw_line in enumerate(raw_lines, start=1):
        if raw_line == "":
            lines.append(EnvLine(kind="blank", raw=""))
            continue

        stripped = raw_line.lstrip()
        if stripped.startswith("#"):
            lines.append(EnvLine(kind="comment", raw=raw_line))
            continue

        key, separator, value = raw_line.partition("=")
        if separator != "=" or not key:
            raise ValueError(
                f"Invalid env line {line_number}: expected KEY=VALUE, comment, or blank."
            )

        lines.append(EnvLine(kind="pair", raw=raw_line, key=key, value=value))

    return lines


def is_line_encrypted_env(content: bytes) -> bool:
    try:
        lines = parse_env_lines(content)
    except ValueError:
        return False

    pair_lines = [line for line in lines if line.kind == "pair"]
    if not pair_lines:
        return False

    return all(
        line.key is not None
        and len(line.key) <= MAX_ENV_KEY_LENGTH
        and ENV_KEY_PATTERN.fullmatch(line.key)
        for line in pair_lines
    )


def serialize_env_lines(lines: list[EnvLine]) -> bytes:
    rendered: list[str] = []
    for line in lines:
        if line.kind == "pair":
            rendered.append(f"{line.key}={line.value}")
        else:
            rendered.append(line.raw)
    return "\n".join(rendered).encode("utf-8")


def strip_advisory_banner(lines: list[EnvLine]) -> list[EnvLine]:
    if not lines:
        return lines

    index = 0
    while index < len(lines) and lines[index].kind == "blank":
        index += 1

    if index < len(lines) and lines[index].kind == "comment" and lines[index].raw == ADVISORY_BANNER:
        trimmed = lines[:index] + lines[index + 1 :]
        if index < len(trimmed) and trimmed[index].kind == "blank":
            trimmed = trimmed[:index] + trimmed[index + 1 :]
        return trimmed

    return lines


def add_advisory_banner(lines: list[EnvLine]) -> list[EnvLine]:
    stripped_lines = strip_advisory_banner(lines)
    return [EnvLine(kind="comment", raw=ADVISORY_BANNER), EnvLine(kind="blank", raw=""), *stripped_lines]


def is_secret_key(key: str | None) -> bool:
    return bool(key) and key.startswith(SECRET_KEY_PREFIX)


def encode_secret_value(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def decode_secret_value(value: str) -> str:
    try:
        decoded = base64.b64decode(value.encode("ascii"), validate=True)
        return decoded.decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return value


def prepare_plaintext_for_runtime(plaintext: bytes) -> bytes:
    runtime_lines: list[EnvLine] = []
    for line in strip_advisory_banner(parse_env_lines(plaintext)):
        if line.kind != "pair" or not is_secret_key(line.key):
            runtime_lines.append(line)
            continue

        runtime_lines.append(
            EnvLine(
                kind="pair",
                raw="",
                key=line.key,
                value=encode_secret_value(line.value or ""),
            )
        )

    return serialize_env_lines(runtime_lines) + b"\n"


def prepare_runtime_for_plaintext(runtime_content: bytes) -> bytes:
    plaintext_lines: list[EnvLine] = []
    for line in parse_env_lines(runtime_content):
        if line.kind != "pair" or not is_secret_key(line.key):
            plaintext_lines.append(line)
            continue

        plaintext_lines.append(
            EnvLine(
                kind="pair",
                raw="",
                key=line.key,
                value=decode_secret_value(line.value or ""),
            )
        )

    return serialize_env_lines(add_advisory_banner(plaintext_lines)) + b"\n"


def encrypt_env_lines(aessiv: AESSIV, plaintext: bytes) -> bytes:
    runtime_plaintext = prepare_plaintext_for_runtime(plaintext)
    encrypted_lines: list[EnvLine] = []
    for line in parse_env_lines(runtime_plaintext):
        if line.kind != "pair":
            encrypted_lines.append(line)
            continue

        ciphertext = aessiv.encrypt(
            line.value.encode("utf-8"),
            [FORMAT_ASSOCIATED_DATA, line.key.encode("utf-8")],
        )
        encoded_ciphertext = base64.urlsafe_b64encode(ciphertext).decode("ascii")
        encrypted_lines.append(
            EnvLine(kind="pair", raw="", key=line.key, value=encoded_ciphertext)
        )

    return serialize_env_lines(encrypted_lines) + b"\n"


def decrypt_env_lines(aessiv: AESSIV, ciphertext: bytes) -> bytes:
    decrypted_lines: list[EnvLine] = []
    for line in parse_env_lines(ciphertext):
        if line.kind != "pair":
            decrypted_lines.append(line)
            continue

        try:
            decoded_ciphertext = base64.urlsafe_b64decode(line.value.encode("ascii"))
        except (ValueError, UnicodeEncodeError) as exc:
            raise InvalidToken from exc

        plaintext = aessiv.decrypt(
            decoded_ciphertext,
            [FORMAT_ASSOCIATED_DATA, line.key.encode("utf-8")],
        )
        decrypted_lines.append(
            EnvLine(kind="pair", raw="", key=line.key, value=plaintext.decode("utf-8"))
        )

    runtime_plaintext = serialize_env_lines(decrypted_lines) + b"\n"
    return prepare_runtime_for_plaintext(runtime_plaintext)


def decrypt_legacy_blob(fernet: Fernet, ciphertext: bytes) -> bytes:
    runtime_plaintext = fernet.decrypt(ciphertext.strip())
    return prepare_runtime_for_plaintext(runtime_plaintext)


def generate_key(output: Path, force: bool) -> int:
    if output.exists() and not force:
        return fail(f"Output file already exists: {output}")

    ensure_parent_dir(output)
    encoded_key = base64.urlsafe_b64encode(AESSIV.generate_key(bit_length=256))
    output.write_bytes(encoded_key + b"\n")
    print(f"Key written to {output}")
    return 0


def encrypt_file(key_file: Path, input_path: Path, output_path: Path, force: bool) -> int:
    try:
        aessiv = load_aessiv(key_file)
        if not input_path.exists():
            return fail(f"Input file not found: {input_path}")
<<<<<<< HEAD
        plaintext = normalize_env_line_endings(input_path.read_bytes())
        ciphertext = fernet.encrypt(plaintext)
        write_output(output_path, ciphertext + b"\n", force)
=======

        plaintext = normalize_env_line_endings(input_path.read_bytes())
        ciphertext = encrypt_env_lines(aessiv, plaintext)
        write_output(output_path, ciphertext, force)
>>>>>>> 818b193399ff42e849711e9392de102cdfe5832d
    except (FileNotFoundError, ValueError, FileExistsError) as exc:
        return fail(str(exc))

    print(f"Encrypted {input_path} -> {output_path}")
    return 0


def decrypt_file(key_file: Path, input_path: Path, output_path: Path, force: bool) -> int:
    return decrypt_file_with_format(key_file, input_path, output_path, force, output_format="human")


def decrypt_file_with_format(
    key_file: Path,
    input_path: Path,
    output_path: Path,
    force: bool,
    *,
    output_format: str,
) -> int:
    try:
        aessiv = load_aessiv(key_file)
        fernet = load_fernet(key_file)
        if not input_path.exists():
            return fail(f"Input file not found: {input_path}")

        ciphertext = input_path.read_bytes()
        if is_line_encrypted_env(ciphertext):
            plaintext = decrypt_env_lines(aessiv, ciphertext)
        else:
            plaintext = decrypt_legacy_blob(fernet, ciphertext)

        if output_format == "runtime":
            plaintext = prepare_plaintext_for_runtime(plaintext)

        write_output(output_path, plaintext, force)
    except (FileNotFoundError, ValueError, FileExistsError) as exc:
        return fail(str(exc))
    except InvalidToken:
        return fail("Unable to decrypt file: invalid key or corrupted ciphertext.")

    print(f"Decrypted {input_path} -> {output_path}")
    return 0


def process_many(
    key_file: Path,
    pairs: list[tuple[Path, Path]],
    force: bool,
    operation: str,
    output_format: str = "human",
) -> int:
    try:
        aessiv = load_aessiv(key_file)
        fernet = load_fernet(key_file)
        for input_path, output_path in pairs:
            if not input_path.exists():
                return fail(f"Input file not found: {input_path}")

            input_bytes = input_path.read_bytes()
            if operation == "encrypt":
                input_bytes = normalize_env_line_endings(input_bytes)
<<<<<<< HEAD
                output_bytes = fernet.encrypt(input_bytes) + b"\n"
=======
                output_bytes = encrypt_env_lines(aessiv, input_bytes)
>>>>>>> 818b193399ff42e849711e9392de102cdfe5832d
            elif operation == "decrypt":
                if is_line_encrypted_env(input_bytes):
                    output_bytes = decrypt_env_lines(aessiv, input_bytes)
                else:
                    output_bytes = decrypt_legacy_blob(fernet, input_bytes)

                if output_format == "runtime":
                    output_bytes = prepare_plaintext_for_runtime(output_bytes)
            else:
                return fail(f"Unknown operation: {operation}")

            write_output(output_path, output_bytes, force)
            verb = "Encrypted" if operation == "encrypt" else "Decrypted"
            print(f"{verb} {input_path} -> {output_path}")
    except (FileNotFoundError, ValueError, FileExistsError) as exc:
        return fail(str(exc))
    except InvalidToken:
        return fail("Unable to decrypt file: invalid key or corrupted ciphertext.")

    return 0


def main() -> int:
    args = parse_args()

    if args.command == "generate-key":
        return generate_key(Path(args.output), args.force)

    if args.command in {"encrypt-many", "decrypt-many"}:
        try:
            pairs = parse_pairs(args.pair)
        except ValueError as exc:
            return fail(str(exc))

        operation = "encrypt" if args.command == "encrypt-many" else "decrypt"
        return process_many(
            Path(args.key_file),
            pairs,
            args.force,
            operation,
            output_format=args.output_format,
        )

    key_file = Path(args.key_file)
    input_path = Path(args.input)
    output_path = Path(args.output)

    if args.command == "encrypt":
        return encrypt_file(key_file, input_path, output_path, args.force)
    if args.command == "decrypt":
        return decrypt_file_with_format(
            key_file,
            input_path,
            output_path,
            args.force,
            output_format=args.output_format,
        )

    return fail(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
