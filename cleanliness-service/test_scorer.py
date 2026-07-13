import csv
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import torch
import torch.nn as nn

from scorer import DEFAULT_MODEL_DIR, Scorer, load_scorer


TEST_CONFIG = {
    "model": "test-model",
    "img": 4,
    "topk": 1,
    "mean": [0.5, 0.5, 0.5],
    "std": [0.5, 0.5, 0.5],
    "temperature": 2.0,
}


class StubNetwork(nn.Module):
    def forward(self, tensor):
        self.input = tensor
        return torch.tensor([2.0]), None


class ScorerTests(unittest.TestCase):
    def test_score_uses_temperature_and_normalized_square_rgb(self):
        jpeg = io.BytesIO()
        with Image.new("L", (10, 6), 0) as image:
            image.save(jpeg, format="JPEG")
        network = StubNetwork()
        scorer = Scorer(network, TEST_CONFIG, "test-version")

        self.assertAlmostEqual(scorer.score(jpeg.getvalue()), torch.sigmoid(torch.tensor(1.0)).item())
        self.assertTrue(torch.equal(network.input, torch.full((1, 3, 4, 4), -1.0)))
        self.assertFalse(network.training)

    def test_model_version_hashes_both_files(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            config_path = folder / "config.json"
            config_path.write_text(json.dumps(TEST_CONFIG), encoding="utf-8")
            weights_path = folder / "best_model.pt"
            torch.save(StubNetwork().state_dict(), weights_path)
            expected_hash = hashlib.sha256(config_path.read_bytes() + weights_path.read_bytes()).hexdigest()

            with patch.dict(os.environ, {"CLEANLINESS_MODEL_DIR": directory}), patch("scorer.Net", side_effect=lambda *_: StubNetwork()):
                first_version = load_scorer().model_version
                self.assertEqual(first_version, "cleandirty-4cat-dinov2-" + expected_hash[:12])
                self.assertEqual(load_scorer().model_version, first_version)
                config_path.write_text(json.dumps({**TEST_CONFIG, "temperature": 4.0}), encoding="utf-8")
                self.assertNotEqual(load_scorer().model_version, first_version)

    def test_missing_model_folder_names_missing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            with self.assertRaisesRegex(FileNotFoundError, r"Missing cleanliness model file: .+/missing/config\.json"):
                load_scorer(missing)

    @unittest.skipUnless(os.environ.get("CLEANLINESS_REAL_MODEL_TEST") == "1", "real weights test is opt-in")
    def test_real_weights_match_predict_cli(self):
        source = Path("/home/shumail/Documents/organized_dataset/basin/dirty/basin_dirty_00070.jpg")
        with tempfile.TemporaryDirectory() as directory:
            photo = Path(directory) / "sample.jpg"
            shutil.copyfile(source, photo)
            results = Path(directory) / "predictions.csv"
            reference = subprocess.run(
                [sys.executable, "-B", str(DEFAULT_MODEL_DIR / "predict.py"), str(photo), "--out", str(results)],
                env={**os.environ, "CUDA_VISIBLE_DEVICES": ""},
                capture_output=True, text=True, timeout=120,
            )
            self.assertEqual(reference.returncode, 0, reference.stderr)
            with results.open(newline="", encoding="utf-8") as output:
                expected = float(next(csv.DictReader(output))["p_dirty"])

            actual = load_scorer(DEFAULT_MODEL_DIR).score(photo.read_bytes())
            self.assertAlmostEqual(actual, expected, delta=0.001)
            print(f"Real-model parity: service {actual:.8f}, predict.py {expected:.4f}, delta {abs(actual - expected):.8f}")
