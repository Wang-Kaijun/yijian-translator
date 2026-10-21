"""Yijian browser bridge for the official Claudish PAW program. Python 3.10+."""
import argparse
import hmac
import importlib.util
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROGRAM_ID = "e469f61ccab2699fbd51"
DEFAULT_ORIGIN = "https://wang-kaijun.github.io"


class PawState:
    def __init__(self):
        self.function = None
        self.lock = threading.Lock()
        self.verified = False

    def health(self):
        return {"service": "yijian-paw", "version": 1, "program_id": PROGRAM_ID,
                "sdk_installed": importlib.util.find_spec("programasweights") is not None,
                "model_ready": self.function is not None, "verified": self.verified}

    def run(self, text):
        if self.function is None:
            import programasweights as paw
            self.function = paw.function(PROGRAM_ID)
        return self.function(text)


def create_server(host="127.0.0.1", port=8766, origins=None, token="", state=None):
    state = state or PawState()
    origins = set(origins or [DEFAULT_ORIGIN])

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Do not log user text, API keys, or request paths.

        def reply(self, status, data=None):
            encoded = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else b""
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def authorized(self, preflight=False):
            origin = self.headers.get("Origin")
            if origin and origin not in origins:
                self.reply(403, {"error": "origin_not_allowed"})
                return False
            if not preflight and token and not hmac.compare_digest(self.headers.get("X-API-Key", ""), token):
                self.reply(401, {"error": "invalid_key"})
                return False
            return True

        def do_OPTIONS(self):
            if self.authorized(preflight=True):
                self.reply(204)

        def do_GET(self):
            if self.authorized():
                self.reply(200, state.health()) if self.path == "/health" else self.reply(404, {"error": "not_found"})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path not in ("/infer", "/verify"):
                return self.reply(404, {"error": "not_found"})
            if self.headers.get("Content-Type", "").split(";")[0].lower() != "application/json":
                return self.reply(415, {"error": "json_required"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16384:
                    return self.reply(413, {"error": "body_too_large"})
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, UnicodeDecodeError):
                return self.reply(400, {"error": "invalid_json"})
            verifying = self.path == "/verify"
            text = "The key distinction is this: only owners can merge. That is the boundary." if verifying else data.get("input")
            if not verifying and data.get("program_id") != PROGRAM_ID:
                return self.reply(422, {"error": "unsupported_program"})
            if not isinstance(text, str) or not text.strip() or len(text) > 1200:
                return self.reply(422, {"error": "invalid_input"})
            if not state.lock.acquire(blocking=False):
                return self.reply(409, {"error": "busy"})
            try:
                output = state.run(text)
                if not isinstance(output, str) or not output.strip():
                    raise RuntimeError("empty_output")
                state.verified = True
                self.reply(200, {**state.health(), "output": output} if verifying else {"program_id": PROGRAM_ID, "output": output})
            except ValueError:
                self.reply(422, {"error": "input_or_context_limit"})
            except Exception as error:
                print("PAW could not load or run. Check installation/model cache. Error type:", type(error).__name__, flush=True)
                self.reply(503, {"error": "runtime_unavailable"})
            finally:
                state.lock.release()

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def get_request(self):
            conn, addr = super().get_request()
            conn.settimeout(200)
            return conn, addr

    return Server((host, port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--origin", action="append", help="Allowed browser origin; repeat to allow more than one")
    args = parser.parse_args()
    token = os.environ.get("YIJIAN_PAW_KEY", "")
    if args.host not in ("localhost", "127.0.0.1", "::1") and not token:
        parser.error("LAN access requires YIJIAN_PAW_KEY. Set a private key before binding to the LAN.")
    with create_server(args.host, args.port, args.origin, token) as server:
        print(f"Yijian PAW bridge: http://{args.host}:{args.port}. Model loads on first verify/rewrite.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
