"""
CleanOps AI — YOLOv8 Fine-Tuning on Trash Detection Dataset
=============================================================
Retrains YOLOv8n on the 29-class trash/litter dataset (Roboflow v35)
so the CleanOps pipeline can detect specific litter categories instead
of generic COCO classes.

Usage:
  python train_yolo.py
  python train_yolo.py --epochs 25 --model yolov8s.pt
  python train_yolo.py --resume   (resume from last checkpoint)

Output:
  E:/tmp/runs/trash_detect/weights/best.pt   ← use this in cleanops_verify.py
"""

import argparse
import os
import sys
import time
from pathlib import Path

# ── Dependency check ─────────────────────────────────────────
try:
    from ultralytics import YOLO
    import torch
except ImportError:
    print("ERROR: ultralytics not installed.")
    print("Run:  pip install ultralytics")
    sys.exit(1)

# ── Constants ─────────────────────────────────────────────────
BASE_DIR   = Path("E:/tmp")
DATA_YAML  = BASE_DIR / "data_trash.yaml"
RUN_DIR    = BASE_DIR / "runs" / "trash_detect"
BEST_PT    = RUN_DIR / "weights" / "best.pt"
LAST_PT    = RUN_DIR / "weights" / "last.pt"

TRASH_CLASSES = [
    "Aluminium foil", "Bottle cap", "Broken glass", "Cigarette",
    "Clear plastic bottle", "Crisp packet", "Cup", "Drink can",
    "Food Carton", "Food container", "Food waste", "Garbage bag",
    "Glass bottle", "Lid", "Other Carton", "Other can",
    "Other container", "Other plastic bottle", "Other plastic wrapper",
    "Other plastic", "Paper bag", "Paper", "Plastic bag wrapper",
    "Plastic film", "Pop tab", "Single-use carrier bag",
    "Straw", "Styrofoam piece", "Unlabeled litter",
]

# ─────────────────────────────────────────────────────────────
def print_banner():
    print()
    print("╔══════════════════════════════════════════════════════════╗")
    print("║      CleanOps AI  —  YOLOv8 Trash Detection Training     ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print()

def detect_device() -> str:
    """Returns 'cuda:0', 'mps', or 'cpu' depending on available hardware."""
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        vram     = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"✅ GPU detected: {gpu_name} ({vram:.1f} GB VRAM) — using CUDA")
        return "0"   # YOLO expects device index as string for CUDA
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        print("✅ Apple MPS detected — using MPS")
        return "mps"
    else:
        print("⚠️  No GPU found — training on CPU (slow but works)")
        return "cpu"

def verify_dataset():
    """Quick sanity-check that train/valid images exist."""
    train_img = Path("E:/tmp/trash-detection.v35.yolov5pytorch/train/images")
    valid_img = Path("E:/tmp/trash-detection.v35.yolov5pytorch/valid/images")

    if not train_img.exists():
        print(f"ERROR: Training images not found at: {train_img}")
        sys.exit(1)
    if not valid_img.exists():
        print(f"ERROR: Validation images not found at: {valid_img}")
        sys.exit(1)

    train_count = len(list(train_img.glob("*.jpg")) + list(train_img.glob("*.png")))
    valid_count = len(list(valid_img.glob("*.jpg")) + list(valid_img.glob("*.png")))

    print(f"📂 Dataset verified:")
    print(f"   Train images : {train_count}")
    print(f"   Valid images : {valid_count}")
    print(f"   Classes      : 29 (litter categories)")
    print()
    return train_count, valid_count

def train(epochs: int, base_model: str, img_size: int, batch: int,
          device: str, resume: bool) -> Path:
    """
    Fine-tune YOLOv8 on the trash dataset.
    Returns path to best.pt weights.
    """
    if resume and LAST_PT.exists():
        print(f"🔄 Resuming from: {LAST_PT}")
        model = YOLO(str(LAST_PT))
        results = model.train(resume=True)
    else:
        print(f"🚀 Starting fine-tune from: {base_model}")
        print(f"   Epochs     : {epochs}")
        print(f"   Image size : {img_size}px")
        print(f"   Batch size : {batch}")
        print(f"   Device     : {device or 'auto'}")
        print()

        model = YOLO(base_model)
        results = model.train(
            data      = str(DATA_YAML),
            epochs    = epochs,
            imgsz     = img_size,
            batch     = batch,
            device    = device,
            project   = str(BASE_DIR / "runs"),
            name      = "trash_detect",
            exist_ok  = True,          # overwrite previous run with same name
            patience  = max(10, epochs // 2),   # early stopping patience
            save      = True,
            save_period = 5,           # save checkpoint every 5 epochs
            val       = True,
            plots     = True,
            verbose   = True,
            # ── Augmentation (good for small-object litter) ──
            degrees   = 10.0,          # slight rotation
            flipud    = 0.1,
            fliplr    = 0.5,
            mosaic    = 1.0,           # mosaic augmentation (4-image tiles)
            mixup     = 0.1,
            hsv_h     = 0.015,
            hsv_s     = 0.7,
            hsv_v     = 0.4,
            scale     = 0.5,
            translate = 0.1,
        )

    best_path = BEST_PT if BEST_PT.exists() else LAST_PT
    return best_path

def validate_model(model_path: Path) -> dict:
    """Run validation on the trained model and return metrics."""
    print()
    print("─" * 50)
    print("📊 Running validation on trained model …")
    model   = YOLO(str(model_path))
    metrics = model.val(data=str(DATA_YAML), verbose=True)
    return metrics

def print_results(best_path: Path, metrics):
    """Print a clean summary with before/after accuracy."""
    print()
    print("╔══════════════════════════════════════════════════════════╗")
    print("║                  TRAINING COMPLETE                       ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print()
    print(f"✅ Best model saved to:")
    print(f"   {best_path}")
    print()

    # Metrics from validation
    try:
        mp     = metrics.box.mp       # mean precision
        mr     = metrics.box.mr       # mean recall
        map50  = metrics.box.map50    # mAP@0.5
        map    = metrics.box.map      # mAP@0.5:0.95
        print("📈 Validation Metrics (trained model):")
        print(f"   Mean Precision   : {mp:.3f}  ({mp*100:.1f}%)")
        print(f"   Mean Recall      : {mr:.3f}  ({mr*100:.1f}%)")
        print(f"   mAP@0.5          : {map50:.3f}  ({map50*100:.1f}%)")
        print(f"   mAP@0.5:0.95     : {map:.3f}  ({map*100:.1f}%)")
    except Exception:
        print("   (metrics not available — check runs/trash_detect/)")

    print()
    print("─" * 50)
    print("🔧 Next step — integrate into CleanOps:")
    print(f"   Set MODEL_PATH = r\"{best_path}\" in cleanops_verify.py")
    print()
    print("   Or run the updater:")
    print("   python update_cleanops_model.py")
    print("─" * 50)
    print()

def before_after_accuracy_demo():
    """
    Shows a quick accuracy comparison: generic YOLOv8n vs trained model
    by running both on a sample test image and comparing detections.
    """
    import cv2
    import glob

    test_images = glob.glob("E:/tmp/trash-detection.v35.yolov5pytorch/test/images/*.jpg")
    if not test_images:
        print("⚠️  No test images found for before/after demo.")
        return

    sample_img = test_images[0]
    img        = cv2.imread(sample_img)

    print()
    print("─" * 50)
    print("🔍 BEFORE vs AFTER Accuracy Demo")
    print(f"   Image: {os.path.basename(sample_img)}")
    print("─" * 50)

    # ── BEFORE: generic YOLOv8n (COCO classes) ──
    generic_model = YOLO("yolov8n.pt")
    before_results = generic_model(img, verbose=False)[0]
    before_dets = []
    for box in before_results.boxes:
        cls_id = int(box.cls[0])
        cls_name = before_results.names[cls_id]
        conf = float(box.conf[0])
        if conf >= 0.25:
            before_dets.append((cls_name, conf))

    print(f"\n[BEFORE] Generic YOLOv8n (COCO) detections: {len(before_dets)}")
    for name, conf in before_dets[:8]:
        print(f"   • {name:<25} {conf:.0%}")
    if not before_dets:
        print("   (no detections above 25% confidence)")

    # ── AFTER: retrained trash model ──
    if BEST_PT.exists():
        trained_model = YOLO(str(BEST_PT))
        after_results = trained_model(img, verbose=False)[0]
        after_dets = []
        for box in after_results.boxes:
            cls_id = int(box.cls[0])
            cls_name = after_results.names[cls_id]
            conf = float(box.conf[0])
            if conf >= 0.25:
                after_dets.append((cls_name, conf))

        print(f"\n[AFTER]  Trained Trash Model detections: {len(after_dets)}")
        for name, conf in after_dets[:8]:
            print(f"   • {name:<25} {conf:.0%}")
        if not after_dets:
            print("   (no detections above 25% confidence on this image)")
            print("   (try a different image or more epochs for better accuracy)")
    else:
        print("\n[AFTER]  Best model weights not found yet.")

    print()

# ─────────────────────────────────────────────────────────────
# CLI entry point
# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Fine-tune YOLOv8 on the CleanOps trash-detection dataset"
    )
    parser.add_argument("--epochs",  type=int,   default=10,
                        help="Number of training epochs (default: 10)")
    parser.add_argument("--model",   type=str,   default="yolov8n.pt",
                        help="Base YOLOv8 model: yolov8n.pt / yolov8s.pt / yolov8m.pt")
    parser.add_argument("--imgsz",   type=int,   default=640,
                        help="Training image size (default: 640)")
    parser.add_argument("--batch",   type=int,   default=-1,
                        help="Batch size (-1 = auto, default: -1)")
    parser.add_argument("--resume",  action="store_true",
                        help="Resume training from last checkpoint")
    parser.add_argument("--demo-only", action="store_true",
                        help="Skip training, only run before/after demo")
    args = parser.parse_args()

    print_banner()

    if not args.demo_only:
        # Verify dataset
        verify_dataset()

        # Detect best device
        device = detect_device()

        t_start = time.time()
        best_path = train(
            epochs     = args.epochs,
            base_model = args.model,
            img_size   = args.imgsz,
            batch      = args.batch,
            device     = device,
            resume     = args.resume,
        )
        elapsed = time.time() - t_start
        print(f"\n⏱  Training time: {elapsed/60:.1f} minutes")

        # Validate
        if best_path.exists():
            metrics = validate_model(best_path)
            print_results(best_path, metrics)
        else:
            print(f"⚠️  Warning: best.pt not found at expected path: {best_path}")
    else:
        print("Running demo only (skipping training) …")

    # Before/After accuracy demo on a test image
    before_after_accuracy_demo()


if __name__ == "__main__":
    main()
