"""Load the DINOv2 cleanliness model and score JPEGs on CPU."""

import hashlib
import io
import json
import os
from pathlib import Path
from threading import Lock

from PIL import Image, ImageOps
import timm
import torch
import torch.nn as nn
import torchvision.transforms as T


DEFAULT_MODEL_DIR = Path("/home/shumail/Documents/kaggle_models_20261117/cleandirty-4cat-dinov2")
MODEL_VERSION_PREFIX = "cleandirty-4cat-dinov2-"


class InvalidImageError(ValueError):
    """The request body cannot be decoded as a JPEG."""


class Net(nn.Module):
    """Network definition from the training script and predict.py."""

    def __init__(self, name, img, topk):
        super().__init__()
        self.topk = topk
        self.backbone = timm.create_model(name, pretrained=False, num_classes=0, img_size=img)
        self.n_prefix = self.backbone.num_prefix_tokens
        d = self.backbone.embed_dim
        self.g_head = nn.Sequential(nn.LayerNorm(2 * d), nn.Dropout(0.2), nn.Linear(2 * d, 1))
        self.p_head = nn.Sequential(nn.LayerNorm(d), nn.Dropout(0.1), nn.Linear(d, 1))
        self.mix = nn.Linear(2, 1)

    def forward(self, x):
        t = self.backbone.forward_features(x)
        pt = t[:, self.n_prefix:]
        g = self.g_head(torch.cat([t[:, 0], pt.mean(1)], 1)).squeeze(1)
        s = self.p_head(pt).squeeze(2)
        l = s.topk(self.topk, dim=1).values.mean(1)
        return self.mix(torch.stack([g, l], 1)).squeeze(1), s


def decode_jpeg(data: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(data), formats=["JPEG"]) as image:
            image.draft("RGB", (1400, 1400))
            return ImageOps.exif_transpose(image).convert("RGB")
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("Could not decode JPEG") from exc


class Scorer:
    def __init__(self, network: nn.Module, config: dict, model_version: str):
        self.model_version = model_version
        self._network = network.to("cpu").eval()
        self._temperature = config["temperature"]
        size = config["img"]
        self._transform = T.Compose([
            T.Resize((size, size)),
            T.ToTensor(),
            T.Normalize(config["mean"], config["std"]),
        ])
        self._lock = Lock()

    def score(self, jpeg: bytes) -> float:
        with decode_jpeg(jpeg) as image:
            image_tensor = self._transform(image).unsqueeze(0)
        with self._lock, torch.no_grad():
            logit, _ = self._network(image_tensor)
            return float(torch.sigmoid(logit / self._temperature)[0])


def load_scorer(model_dir: Path | None = None) -> Scorer:
    folder = Path(os.environ.get("CLEANLINESS_MODEL_DIR", DEFAULT_MODEL_DIR)) if model_dir is None else model_dir
    config_path = folder / "config.json"
    weights_path = folder / "best_model.pt"
    for path in (config_path, weights_path):
        if not path.is_file():
            raise FileNotFoundError(f"Missing cleanliness model file: {path}")

    config_bytes = config_path.read_bytes()
    config = json.loads(config_bytes)
    network = Net(config["model"], config["img"], config["topk"])
    digest = hashlib.sha256(config_bytes)
    with weights_path.open("rb") as weights:
        for chunk in iter(lambda: weights.read(1024 * 1024), b""):
            digest.update(chunk)
        weights.seek(0)
        network.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    return Scorer(network, config, MODEL_VERSION_PREFIX + digest.hexdigest()[:12])
