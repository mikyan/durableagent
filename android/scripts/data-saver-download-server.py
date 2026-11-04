"""Synthetic root-run endpoint for the Android network-change test; no private input."""
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if not re.fullmatch(r"/t13/[a-f0-9-]{36}", self.path):
            self.send_error(404)
            return
        started = time.monotonic()
        sent = 0
        print(json.dumps({"event": "opened", "path": self.path, "at": started}), flush=True)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            while time.monotonic() - started < 60:
                self.wfile.write(b"T13 synthetic download\n".ljust(1024, b"."))
                self.wfile.flush()
                sent += 1024
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            print(json.dumps({"event": "closed", "path": self.path, "at": time.monotonic(), "sentBytes": sent}), flush=True)


if __name__ == "__main__":
    # The emulator reaches the host loopback through its fixed 10.0.2.2 alias.
    ThreadingHTTPServer(("127.0.0.1", 18763), Handler).serve_forever()
