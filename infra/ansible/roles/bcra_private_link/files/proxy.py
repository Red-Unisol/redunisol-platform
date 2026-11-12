"""Bounded transparent TCP relay. No HTTP parsing, retries, imports or logs."""
import argparse
import select
import socket
import threading
import time


class Proxy:
    def __init__(self, upstream, listen=("0.0.0.0", 8080), limit=32,
                 connect_timeout=5, idle_timeout=35, lifetime=120):
        self.upstream = upstream
        self.connect_timeout = connect_timeout
        self.idle_timeout = idle_timeout
        self.lifetime = lifetime
        self.capacity = threading.BoundedSemaphore(limit)
        self.stop = threading.Event()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(listen)
        self.listener.listen(limit)
        self.listener.settimeout(0.25)
        self.address = self.listener.getsockname()

    def relay(self, client):
        upstream = None
        try:
            # A failed or partial request is never retried by this transport.
            upstream = socket.create_connection(self.upstream, self.connect_timeout)
            client.settimeout(5)
            upstream.settimeout(5)
            readers = [client, upstream]
            peers = {client: upstream, upstream: client}
            started = touched = time.monotonic()
            while readers and not self.stop.is_set():
                now = time.monotonic()
                remaining = min(self.lifetime - (now - started), self.idle_timeout - (now - touched))
                if remaining <= 0:
                    break
                ready, _, _ = select.select(readers, [], [], min(remaining, 0.25))
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        readers.remove(source)
                        peers[source].shutdown(socket.SHUT_WR)
                    else:
                        peers[source].sendall(data)
                        touched = time.monotonic()
        except (OSError, ValueError):
            pass
        finally:
            client.close()
            if upstream is not None:
                upstream.close()
            self.capacity.release()

    def serve(self):
        while not self.stop.is_set():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            if not self.capacity.acquire(False):
                client.close()
                continue
            thread = threading.Thread(target=self.relay, args=(client,))
            thread.daemon = True
            try:
                thread.start()
            except RuntimeError:
                client.close()
                self.capacity.release()

    def close(self):
        self.stop.set()
        self.listener.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream-host", required=True)
    parser.add_argument("--upstream-port", type=int, default=18083)
    args = parser.parse_args()
    Proxy((args.upstream_host, args.upstream_port)).serve()
