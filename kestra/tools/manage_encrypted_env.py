import argparse
from pathlib import Path
import sys

from cryptography.fernet import Fernet, InvalidToken


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Encrypt and decrypt Kestra runtime env files using a local key file."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate_key_parser = subparsers.add_parser("generate-key", help="Generate a Fernet key file.")
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

    return parser.parse_args()


def add_common_file_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--key-file", required=True, help="Path to the Fernet key file.")
    parser.add_argument("--input", required=True, help="Path to the input file.")
    parser.add_argument("--output", required=True, help="Path to the output file.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite the output file if it already exists.",
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


def load_fernet(key_file: Path) -> Fernet:
    if not key_file.exists():
        raise FileNotFoundError(f"Key file not found: {key_file}")
    key = key_file.read_bytes().strip()
    if not key:
        raise ValueError(f"Key file is empty: {key_file}")
    return Fernet(key)


def generate_key(output: Path, force: bool) -> int:
    if output.exists() and not force:
        return fail(f"Output file already exists: {output}")
    ensure_parent_dir(output)
    output.write_bytes(Fernet.generate_key() + b"\n")
    print(f"Key written to {output}")
    return 0


def encrypt_file(key_file: Path, input_path: Path, output_path: Path, force: bool) -> int:
    try:
        fernet = load_fernet(key_file)
        if not input_path.exists():
            return fail(f"Input file not found: {input_path}")
        plaintext = input_path.read_bytes()
        ciphertext = fernet.encrypt(plaintext)
        write_output(output_path, ciphertext + b"\n", force)
    except (FileNotFoundError, ValueError, FileExistsError) as exc:
        return fail(str(exc))

    print(f"Encrypted {input_path} -> {output_path}")
    return 0


def decrypt_file(key_file: Path, input_path: Path, output_path: Path, force: bool) -> int:
    try:
        fernet = load_fernet(key_file)
        if not input_path.exists():
            return fail(f"Input file not found: {input_path}")
        ciphertext = input_path.read_bytes().strip()
        plaintext = fernet.decrypt(ciphertext)
        write_output(output_path, plaintext, force)
    except (FileNotFoundError, ValueError, FileExistsError) as exc:
        return fail(str(exc))
    except InvalidToken:
        return fail("Unable to decrypt file: invalid key or corrupted ciphertext.")

    print(f"Decrypted {input_path} -> {output_path}")
    return 0


def main() -> int:
    args = parse_args()

    if args.command == "generate-key":
        return generate_key(Path(args.output), args.force)

    key_file = Path(args.key_file)
    input_path = Path(args.input)
    output_path = Path(args.output)

    if args.command == "encrypt":
        return encrypt_file(key_file, input_path, output_path, args.force)
    if args.command == "decrypt":
        return decrypt_file(key_file, input_path, output_path, args.force)

    return fail(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())