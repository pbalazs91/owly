"""Private bridge to loopback Ollama; Caddy supplies public HTTPS."""
import hmac
import json
import os
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

KEY = Path(os.environ["OWLY_OLLAMA_KEY_FILE"]).read_text().strip()
if len(KEY) < 40:
    raise RuntimeError("Ollama gateway key is missing or too short")
SLOT = threading.BoundedSemaphore(1)
MODEL = "qwen3:0.6b"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log tokens or customer prompts.

    def setup(self):
        super().setup()
        self.connection.settimeout(90)

    def reply(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + KEY):
            return self.reply(401, b'{"error":"Unauthorized"}')
        allowed = {"GET": {"/api/tags", "/api/version", "/v1/models"}, "POST": {"/api/chat", "/v1/chat/completions"}}
        if self.path not in allowed.get(self.command, set()):
            return self.reply(404, b'{"error":"Not found"}')
        data = None
        if self.command == "POST":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > 262144:
                    return self.reply(413, b'{"error":"Request too large"}')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict) or body.get("model") != MODEL:
                    return self.reply(400, b'{"error":"Unsupported model"}')
                body["stream"] = False
                body["think"] = False
                body["keep_alive"] = "2m"
                if self.path == "/api/chat":
                    options = body.setdefault("options", {})
                    if not isinstance(options, dict):
                        raise ValueError("Invalid options")
                    options["num_ctx"] = 2048
                    options["num_predict"] = min(512, max(1, int(options.get("num_predict", 256))))
                else:
                    body["reasoning_effort"] = "none"
                    body.pop("reasoning", None)
                    body["max_tokens"] = min(512, max(1, int(body.get("max_tokens", 256))))
                data = json.dumps(body).encode()
            except (ValueError, TypeError, TimeoutError):
                return self.reply(400, b'{"error":"Invalid request"}')
        if not SLOT.acquire(blocking=False):
            return self.reply(429, b'{"error":"Model busy; retry shortly"}')
        try:
            request = urllib.request.Request("http://127.0.0.1:11434" + self.path, data=data, headers={"Content-Type": "application/json"}, method=self.command)
            with urllib.request.urlopen(request, timeout=80) as response:
                self.reply(response.status, response.read())
        except urllib.error.HTTPError as error:
            self.reply(error.code, b'{"error":"Model request failed"}')
        except (urllib.error.URLError, TimeoutError):
            self.reply(502, b'{"error":"Model unavailable"}')
        finally:
            SLOT.release()


if __name__ == "__main__":
    ThreadingHTTPServer((os.environ["OWLY_OLLAMA_BIND"], 11435), Handler).serve_forever()
