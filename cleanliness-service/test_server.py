import http.client
import io
import json
from threading import Event, Thread
import unittest

from PIL import Image

from scorer import decode_jpeg
from server import BIND_HOST, MAX_IMAGE_BYTES, CleanlinessServer


JPEG_HEADERS = {"Content-Type": "image/jpeg"}


class FakeScorer:
    model_version = "cleandirty-4cat-dinov2-0123456789ab"

    def score(self, jpeg):
        with decode_jpeg(jpeg):
            return 0.37


class ServerTests(unittest.TestCase):
    def start_server(self, scorer=None):
        self.server = CleanlinessServer(port=0, scorer=scorer)
        self.addCleanup(self.server.server_close)
        thread = Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, body=None, headers=None):
        host, port = self.server.server_address
        connection = http.client.HTTPConnection(host, port, timeout=5)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            self.assertEqual(response.getheader("Content-Type"), "application/json")
            return response.status, response.read()
        finally:
            connection.close()

    def assert_reply(self, status, payload, method, path, body=None, headers=None):
        actual_status, actual_body = self.request(method, path, body, headers)
        self.assertEqual(actual_status, status)
        self.assertEqual(json.loads(actual_body), payload)

    def image_bytes(self, image_format="JPEG"):
        with io.BytesIO() as output, Image.new("RGB", (8, 6), "white") as image:
            image.save(output, format=image_format)
            return output.getvalue()

    def test_health_while_loader_runs_and_when_ready(self):
        self.start_server()
        loading = Event()
        release_loader = Event()

        def load():
            loading.set()
            release_loader.wait()
            return FakeScorer()

        thread = Thread(target=self.server.load_model, args=(load,))
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(release_loader.set)
        self.assertTrue(loading.wait(5))
        self.assert_reply(503, {"status": "loading"}, "GET", "/health")
        release_loader.set()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assert_reply(200, {
            "status": "ok", "modelVersion": FakeScorer.model_version, "device": "cpu",
        }, "GET", "/health")

    def test_health_when_loading_fails(self):
        self.start_server()

        def fail():
            raise FileNotFoundError("missing test weights")

        with self.assertLogs("server", level="ERROR"):
            self.server.load_model(fail)
        self.assert_reply(503, {"status": "error"}, "GET", "/health")

    def test_score_jpeg(self):
        self.start_server(FakeScorer())
        status, body = self.request("POST", "/score", self.image_bytes(), JPEG_HEADERS)
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(set(payload), {"pDirty", "modelVersion", "latencyMs"})
        self.assertEqual(payload["pDirty"], 0.37)
        self.assertEqual(payload["modelVersion"], FakeScorer.model_version)
        self.assertIs(type(payload["latencyMs"]), int)
        self.assertGreaterEqual(payload["latencyMs"], 0)

    def test_score_rejects_invalid_or_non_jpeg_bytes(self):
        self.start_server(FakeScorer())
        for body in (b"", b"not a photo", self.image_bytes("PNG"), self.image_bytes()[:40]):
            with self.subTest(size=len(body)):
                self.assert_reply(400, {"error": "INVALID_IMAGE"}, "POST", "/score", body, JPEG_HEADERS)

    def test_score_rejects_oversized_body_before_reading(self):
        self.start_server(FakeScorer())
        headers = {**JPEG_HEADERS, "Content-Length": str(MAX_IMAGE_BYTES + 1)}
        self.assert_reply(413, {"error": "IMAGE_TOO_LARGE"}, "POST", "/score", b"", headers)

    def test_score_rejects_wrong_content_type(self):
        self.start_server(FakeScorer())
        self.assert_reply(415, {"error": "UNSUPPORTED_MEDIA_TYPE"}, "POST", "/score",
                          self.image_bytes(), {"Content-Type": "image/png"})

    def test_unknown_path_and_method_return_not_found(self):
        self.start_server(FakeScorer())
        for method, path in (("GET", "/unknown"), ("GET", "/score"), ("POST", "/health"), ("BREW", "/health")):
            with self.subTest(method=method, path=path):
                self.assert_reply(404, {"error": "NOT_FOUND"}, method, path)
        self.assertEqual(self.request("HEAD", "/health"), (404, b""))

    def test_score_returns_unavailable_without_scorer(self):
        self.start_server()
        self.assert_reply(503, {"error": "MODEL_NOT_READY"}, "POST", "/score", self.image_bytes(), JPEG_HEADERS)

    def test_server_binds_to_loopback(self):
        self.start_server()
        self.assertEqual(BIND_HOST, "127.0.0.1")
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
