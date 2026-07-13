"""Loopback HTTP API for the local cleanliness model."""

from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from threading import Thread
from time import monotonic
from typing import Protocol

from scorer import InvalidImageError, load_scorer


BIND_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_IMAGE_BYTES = 8 * 1024 * 1024
logger = logging.getLogger(__name__)


class ImageScorer(Protocol):
    model_version: str

    def score(self, jpeg: bytes) -> float: ...


class CleanlinessServer(ThreadingHTTPServer):
    def __init__(self, port: int = DEFAULT_PORT, scorer: ImageScorer | None = None):
        super().__init__((BIND_HOST, port), ScoreHandler)
        self.scorer = scorer
        self.load_failed = False

    def load_model(self, loader: Callable[[], ImageScorer] = load_scorer) -> None:
        try:
            self.scorer = loader()
        except Exception as exc:
            self.load_failed = True
            logger.error("Model loading failed (%s)", type(exc).__name__)


class ScoreHandler(BaseHTTPRequestHandler):
    server: CleanlinessServer

    def handle_one_request(self) -> None:
        self.started_at = monotonic()
        super().handle_one_request()

    def log_request(self, code="-", size="-") -> None:
        logger.info(
            "method=%r path=%r status=%s latencyMs=%d",
            self.command, getattr(self, "path", ""), code, (monotonic() - self.started_at) * 1000,
        )

    def log_message(self, format, *args) -> None:
        # Keep standard-library diagnostics from printing unparsed request data.
        pass

    def respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def not_found(self) -> None:
        self.respond(404, {"error": "NOT_FOUND"})

    def __getattr__(self, name):
        # BaseHTTPRequestHandler dispatches methods via do_<method>.
        if name.startswith("do_"):
            return self.not_found
        raise AttributeError(name)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.not_found()
            return
        scorer = self.server.scorer
        if scorer is None:
            status = "error" if self.server.load_failed else "loading"
            self.respond(503, {"status": status})
        else:
            self.respond(200, {"status": "ok", "modelVersion": scorer.model_version, "device": "cpu"})

    def do_POST(self) -> None:
        if self.path != "/score":
            self.not_found()
            return
        if self.headers.get_content_type() != "image/jpeg":
            self.respond(415, {"error": "UNSUPPORTED_MEDIA_TYPE"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        length_header = lengths[0] if len(lengths) == 1 else ""
        if "Transfer-Encoding" in self.headers or not (length_header.isascii() and length_header.isdecimal()):
            self.respond(400, {"error": "INVALID_IMAGE"})
            return
        length_header = length_header.lstrip("0") or "0"
        if len(length_header) > len(str(MAX_IMAGE_BYTES)) or int(length_header) > MAX_IMAGE_BYTES:
            self.respond(413, {"error": "IMAGE_TOO_LARGE"})
            return
        scorer = self.server.scorer
        if scorer is None:
            self.respond(503, {"error": "MODEL_NOT_READY"})
            return

        length = int(length_header)
        jpeg = self.rfile.read(length)
        if not jpeg or len(jpeg) != length:
            self.respond(400, {"error": "INVALID_IMAGE"})
            return
        started_at = monotonic()
        try:
            p_dirty = scorer.score(jpeg)
            if not 0 <= p_dirty <= 1:
                raise ValueError("Invalid dirty probability")
        except InvalidImageError:
            self.respond(400, {"error": "INVALID_IMAGE"})
        except Exception:
            self.respond(503, {"error": "MODEL_NOT_READY"})
        else:
            self.respond(200, {
                "pDirty": p_dirty,
                "modelVersion": scorer.model_version,
                "latencyMs": int((monotonic() - started_at) * 1000),
            })


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    port = int(os.environ.get("CLEANLINESS_SERVICE_PORT", DEFAULT_PORT))
    with CleanlinessServer(port) as server:
        Thread(target=server.load_model, daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
