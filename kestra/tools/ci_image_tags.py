"""Select publication tags without letting dev overwrite operational images."""

import argparse
import os
from pathlib import Path
import re


SUPPORTED_IMAGES = (
    "ghcr.io/red-unisol/analisis-credito-arca-padron-a13",
    "ghcr.io/red-unisol/analisis-credito-consulta-cuad",
    "ghcr.io/red-unisol/analisis-credito-precalentar-cache-credixsa-v2",
)


def publication_tags(image_name: str, git_ref: str, git_sha: str) -> list[str]:
    if image_name not in SUPPORTED_IMAGES:
        raise ValueError("Unsupported runtime image.")
    if not re.fullmatch(r"[0-9a-f]{40}", git_sha):
        raise ValueError("GITHUB_SHA must be a full commit SHA.")
    if git_ref == "refs/heads/main":
        suffixes = (f"sha-{git_sha}", "latest")
    elif git_ref == "refs/heads/dev":
        suffixes = (f"dev-{git_sha}", "dev-latest")
    else:
        raise ValueError("Runtime images may only be published from main or dev.")
    return [f"{image_name}:{suffix}" for suffix in suffixes]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-name", required=True)
    args = parser.parse_args()
    try:
        tags = publication_tags(
            args.image_name,
            os.environ.get("GITHUB_REF", ""),
            os.environ.get("GITHUB_SHA", ""),
        )
        output = os.environ.get("GITHUB_OUTPUT")
        if not output:
            raise ValueError("GITHUB_OUTPUT is required.")
    except ValueError as error:
        parser.error(str(error))

    with Path(output).open("a", encoding="utf-8", newline="\n") as handle:
        handle.write("tags<<IMAGE_TAGS\n")
        handle.write("\n".join(tags) + "\n")
        handle.write("IMAGE_TAGS\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
