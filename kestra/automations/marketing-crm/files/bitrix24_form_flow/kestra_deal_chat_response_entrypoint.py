"""Compatibility entrypoint: even old revisions must acquire the shared lease."""


def main():
    from .kestra_chat_response_worker_entrypoint import main as bounded_main
    return bounded_main()


if __name__ == "__main__":
    raise SystemExit(main())
