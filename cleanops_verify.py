"""
CleanOps AI Image Verification Service
=======================================
Takes ONE input image, runs the full pipeline:
  Stage 1 — OpenCV quality gate (blur, brightness, resolution)
  Stage 2 — Issue detection (contour-based dirt/stain finder)
  Stage 3 — Before/After comparison (SSIM, PSNR, pixel diff)

Usage:
  python cleanops_verify.py --image path/to/image.jpg
  python cleanops_verify.py --image path/to/image.jpg --demo  (generates fake before internally)

Flask API:
  POST /verify   multipart/form-data: image=<file>
  GET  /health
"""

import cv2
import numpy as np
from skimage.metrics import structural_similarity as ssim
from skimage.metrics import peak_signal_noise_ratio as psnr
import argparse
import json
import os
import sys
from datetime import datetime
from flask import Flask, request, jsonify

# ── YOLOv8 (ultralytics) — optional, graceful fallback if not installed ──
try:
    from ultralytics import YOLO as _YOLO_CLASS
    _YOLO_AVAILABLE = True
except ImportError:
    _YOLO_AVAILABLE = False

# ── Model paths: retrained trash model takes priority over generic COCO ──
_TRASH_MODEL_PATH = "E:/tmp/runs/trash_detect/weights/best.pt"
_GENERIC_MODEL_PATH = "yolov8n.pt"

# Flag: True when the retrained 29-class trash model is loaded
_USING_TRASH_MODEL = False

# ── 29 trash/litter classes from the retrained model ──
# ALL of these are SCORED — they directly affect the cleaning grade.
_TRASH_CLASSES = {
    "Aluminium foil", "Bottle cap", "Broken glass", "Cigarette",
    "Clear plastic bottle", "Crisp packet", "Cup", "Drink can",
    "Food Carton", "Food container", "Food waste", "Garbage bag",
    "Glass bottle", "Lid", "Other Carton", "Other can",
    "Other container", "Other plastic bottle", "Other plastic wrapper",
    "Other plastic", "Paper bag", "Paper", "Plastic bag wrapper",
    "Plastic film", "Pop tab", "Single-use carrier bag",
    "Straw", "Styrofoam piece", "Unlabeled litter",
}

# ── COCO classes used when falling back to the generic model ──
# These are info-only (NOT scored) — generic model cannot reliably
# distinguish litter from permanent objects.
_CLUTTER_CLASSES = {
    "bottle", "cup", "bowl", "book", "laptop", "mouse", "keyboard",
    "cell phone", "remote", "scissors", "backpack", "handbag",
    "suitcase", "umbrella", "wine glass", "fork", "knife", "spoon",
    "banana", "apple", "sandwich", "orange", "pizza", "donut", "cake",
    "potted plant", "vase", "clock", "teddy bear", "hair drier",
    "toothbrush", "chair", "couch", "dining table", "bed",
}

_yolo_model = None  # lazy singleton


# ──────────────────────────────────────────────────────────
# Shadow exclusion helper
# ──────────────────────────────────────────────────────────

def _shadow_mask(bgr_img: np.ndarray) -> np.ndarray:
    """
    Returns a binary mask (255 = shadow pixel, 0 = not shadow).

    Shadows are characterised by THREE properties compared to dirt:
      1. LOW Value (dark)         — same as dirt, so not enough alone
      2. LOW Saturation           — shadows desaturate; dirt/grime keeps
                                    or adds colour (brown, yellow, grey)
      3. SMOOTH local texture     — shadow edges are gradual; dirt has
                                    micro-texture (fibres, particles)

    A pixel is classified as shadow when ALL three tests pass.
    """
    hsv = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2HSV)
    v   = hsv[:, :, 2].astype(np.float32)   # brightness
    s   = hsv[:, :, 1].astype(np.float32)   # saturation

    # Test 1 — dark enough to be a shadow candidate
    dark_candidate = (v < 90).astype(np.uint8) * 255

    # Test 2 — low saturation (shadows stay near-grey)
    #  Saturation < 55 (out of 255) = very little colour → likely shadow
    low_sat = (s < 55).astype(np.uint8) * 255

    # Test 3 — smooth texture (Laplacian variance in a local window is low)
    #  Compute local variance of the Laplacian response.  Shadow regions are
    #  smooth; dirty patches are rough/textured.
    gray    = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
    lap     = cv2.Laplacian(gray, cv2.CV_32F)
    lap_sq  = lap ** 2
    # Local mean of squared Laplacian  ≈  local variance of texture
    kernel  = np.ones((15, 15), np.float32) / (15 * 15)
    loc_var = cv2.filter2D(lap_sq, -1, kernel)
    smooth  = (loc_var < 120).astype(np.uint8) * 255   # low texture = smooth

    # Shadow = dark AND low-sat AND smooth — all three must agree
    shadow = cv2.bitwise_and(dark_candidate, low_sat)
    shadow = cv2.bitwise_and(shadow, smooth)

    # Small morphological clean-up to remove noise
    shadow = cv2.morphologyEx(
        shadow, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    )
    return shadow


def _get_yolo_model():
    """
    Load the best available YOLO model — once — and reuse across calls.

    Priority:
      1. Retrained 29-class trash model  →  best accuracy for litter detection
      2. Generic YOLOv8n (COCO 80 cls)  →  fallback when training not done yet
    """
    global _yolo_model, _USING_TRASH_MODEL
    if _yolo_model is None and _YOLO_AVAILABLE:
        import os
        if os.path.exists(_TRASH_MODEL_PATH):
            print(f"[YOLOv8] ✅ Loading RETRAINED trash model: {_TRASH_MODEL_PATH}")
            _yolo_model       = _YOLO_CLASS(_TRASH_MODEL_PATH)
            _USING_TRASH_MODEL = True
        else:
            print(f"[YOLOv8] ⚠️  Retrained model not found at: {_TRASH_MODEL_PATH}")
            print(f"[YOLOv8]    Falling back to generic {_GENERIC_MODEL_PATH}")
            print(f"[YOLOv8]    Run  python train_yolo.py  to train the custom model.")
            _yolo_model       = _YOLO_CLASS(_GENERIC_MODEL_PATH)
            _USING_TRASH_MODEL = False
    return _yolo_model

# ──────────────────────────────────────────────────────────
# STAGE 1 — OpenCV Quality gate
# ──────────────────────────────────────────────────────────

def quality_gate(img: np.ndarray) -> dict:
    """
    Checks image for:
      - Blur (Laplacian variance)
      - Brightness (mean pixel value)
      - Minimum resolution (640x480)
    Returns dict with pass/fail + reason.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = img.shape[:2]

    blur_score  = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness  = float(gray.mean())
    resolution  = (w, h)

    issues = []
    if blur_score < 80:
        issues.append(f"Image too blurry (score={blur_score:.1f}, need >80)")
    if brightness < 40:
        issues.append(f"Image too dark (brightness={brightness:.1f}, need >40)")
    if brightness > 230:
        issues.append(f"Image overexposed (brightness={brightness:.1f}, need <230)")
    if w < 320 or h < 240:
        issues.append(f"Resolution too low ({w}x{h}, need ≥320x240)")

    return {
        "passed":      len(issues) == 0,
        "blur_score":  round(blur_score, 2),
        "brightness":  round(brightness, 2),
        "resolution":  f"{w}x{h}",
        "issues":      issues,
    }


# ──────────────────────────────────────────────────────────
# STAGE 2 — Issue detection (contour + color analysis)
# ──────────────────────────────────────────────────────────

def detect_issues(img: np.ndarray) -> tuple[list[dict], np.ndarray]:
    """
    Detects potential cleaning issues using:
      - Dark region detection (dirt / stains) — shadows excluded
      - Saturation spikes (stains with distinct colour)
      - YOLO object detection (shown as [INFO], not scored)
    Returns:
      - list of detected issue dicts
      - annotated image (copy of input with bboxes drawn)
    """
    annotated   = img.copy()
    detected    = []
    gray        = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv         = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, w        = img.shape[:2]
    total_px    = h * w

    # ── Build shadow mask — pixels to EXCLUDE from dirt detection ──
    shadow = _shadow_mask(img)

    # ── 1. Dark region detection (dirt, grime) — shadows removed ──
    _, raw_dark  = cv2.threshold(gray, 60, 255, cv2.THRESH_BINARY_INV)
    # Remove shadow pixels: keep only dark areas that are NOT shadows
    dark_mask    = cv2.bitwise_and(raw_dark, cv2.bitwise_not(shadow))
    dark_mask    = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN,
                                     cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    dark_pct     = cv2.countNonZero(dark_mask) / total_px

    if dark_pct > 0.04:
        contours, _ = cv2.findContours(dark_mask, cv2.RETR_EXTERNAL,
                                        cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 800:
                continue
            x, y, bw, bh = cv2.boundingRect(cnt)
            cv2.rectangle(annotated, (x, y), (x+bw, y+bh), (0, 0, 200), 2)
            cv2.putText(annotated, "Dirt/grime", (x, max(y-8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 200), 1, cv2.LINE_AA)
            detected.append({
                "label":      "Dirt / grime",
                "confidence": round(min(dark_pct * 6, 0.97), 2),
                "bbox":       [int(x), int(y), int(bw), int(bh)],
                "area_pct":   round(area / total_px * 100, 2),
            })

    # ── 2. High-saturation stain detection ──
    saturation     = hsv[:, :, 1]
    _, sat_mask    = cv2.threshold(saturation, 140, 255, cv2.THRESH_BINARY)
    sat_mask       = cv2.morphologyEx(sat_mask, cv2.MORPH_OPEN,
                                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    sat_pct        = cv2.countNonZero(sat_mask) / total_px

    if sat_pct > 0.03:
        contours, _ = cv2.findContours(sat_mask, cv2.RETR_EXTERNAL,
                                        cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 600:
                continue
            x, y, bw, bh = cv2.boundingRect(cnt)
            cv2.rectangle(annotated, (x, y), (x+bw, y+bh), (30, 100, 255), 2)
            cv2.putText(annotated, "Stain", (x, max(y-8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30, 100, 255), 1, cv2.LINE_AA)
            detected.append({
                "label":      "Stain",
                "confidence": round(min(sat_pct * 5, 0.95), 2),
                "bbox":       [int(x), int(y), int(bw), int(bh)],
                "area_pct":   round(area / total_px * 100, 2),
            })

    # \u2500\u2500 3. YOLOv8 object detection \u2500\u2500
    # \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    # TRASH MODEL MODE (retrained):
    #   \u2022 All 29 litter classes are SCORED \u2014 they affect the cleaning grade
    #   \u2022 Drawn with bright orange/green boxes labelled with the trash class name
    # GENERIC MODEL FALLBACK (COCO):
    #   \u2022 Matched COCO clutter classes are INFO-only (scored=False)
    #   \u2022 Drawn with teal [INFO] boxes \u2014 same as original behaviour
    yolo = _get_yolo_model()
    yolo_obj_count  = 0
    yolo_trash_count = 0
    if yolo is not None:
        yolo_results = yolo(img, verbose=False)[0]
        seen_classes: set[str] = set()

        for box in yolo_results.boxes:
            cls_id   = int(box.cls[0])
            cls_name = yolo_results.names[cls_id]
            conf     = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            obj_w = x2 - x1
            obj_h = y2 - y1

            if _USING_TRASH_MODEL:
                # \u2500\u2500 Retrained trash model: every detected class is real litter \u2500\u2500
                if conf < 0.25:
                    continue
                # Use orange box for litter items (scored)
                box_color = (0, 140, 255)    # bright orange in BGR
                tag = f"{cls_name} {conf:.0%}"
                (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)
                # Filled label background
                cv2.rectangle(annotated, (x1, max(y1 - th - 8, 0)),
                              (x1 + tw + 6, max(y1, th + 8)), (0, 100, 200), -1)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), box_color, 2)
                cv2.putText(annotated, tag, (x1 + 3, max(y1 - 4, th + 4)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1, cv2.LINE_AA)
                # scored=True \u2192 counts toward cleaning score
                detected.append({
                    "label":      cls_name,
                    "confidence": round(conf, 2),
                    "bbox":       [x1, y1, obj_w, obj_h],
                    "area_pct":   round((obj_w * obj_h) / total_px * 100, 2),
                    "detector":   "yolov8-trash",
                    "scored":     True,   # \u2190 COUNTED in cleaning score
                })
                seen_classes.add(cls_name)
                yolo_trash_count += 1

            else:
                # \u2500\u2500 Generic COCO model fallback: info-only for clutter classes \u2500\u2500
                if cls_name not in _CLUTTER_CLASSES or conf < 0.30:
                    continue
                # Teal dashed box (info only, not scored)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 200, 180), 1)
                cv2.rectangle(annotated, (x1+2, y1+2), (x2-2, y2-2), (0, 200, 180), 1)
                tag = f"[INFO] {cls_name} {conf:.0%}"
                (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
                cv2.rectangle(annotated, (x1, max(y1 - th - 6, 0)),
                              (x1 + tw + 4, max(y1, th + 6)), (20, 80, 70), -1)
                cv2.putText(annotated, tag, (x1 + 2, max(y1 - 4, th + 2)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.48, (180, 255, 240), 1, cv2.LINE_AA)
                # scored=False \u2192 excluded from cleaning score
                detected.append({
                    "label":      f"Object / {cls_name}",
                    "confidence": round(conf, 2),
                    "bbox":       [x1, y1, obj_w, obj_h],
                    "area_pct":   round((obj_w * obj_h) / total_px * 100, 2),
                    "detector":   "yolov8n",
                    "scored":     False,   # \u2190 NOT counted in cleaning score
                })
                seen_classes.add(cls_name)
                yolo_obj_count += 1

        if seen_classes:
            if _USING_TRASH_MODEL:
                print(f"[YOLOv8-Trash] Litter detected (SCORED): {', '.join(sorted(seen_classes))}")
            else:
                print(f"[YOLOv8] Objects (info only, not scored): {', '.join(sorted(seen_classes))}")
    else:
        # No YOLO available \u2014 skip object detection entirely (no fallback clutter scoring)
        print("[YOLOv8] Not available \u2014 skipping object detection")

    # Count only dirt/stain issues (scored=True) for the legend
    dirt_count = sum(1 for d in detected if d.get("scored", True))

    # Build legend \u2014 show which model is active
    model_tag = "\u2705 Trash Model" if _USING_TRASH_MODEL else "\u26a0\ufe0f Generic COCO"
    legend1   = (f"{model_tag}  |  Litter: {yolo_trash_count}  |  "
                 f"Dirt/Stain: {sum(1 for d in detected if d.get('scored', True) and 'detector' not in d)}"
                 f"  |  Other: {yolo_obj_count}")
    cv2.putText(annotated, legend1,
                (10, h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(annotated, legend1,
                (10, h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (20, 20, 20), 1, cv2.LINE_AA)

    return detected, annotated


# ──────────────────────────────────────────────────────────
# STAGE 3 — Before / After comparison
# ──────────────────────────────────────────────────────────

def make_simulated_before(after_img: np.ndarray) -> np.ndarray:
    """
    Simulates a 'dirty before' version of the input image by:
      - Adding a dark overlay (simulated grime)
      - Injecting a synthetic stain patch
      - Reducing brightness slightly
    Used when only one image is provided.
    """
    before      = after_img.copy().astype(np.float32)

    # Add grime overlay
    grime       = np.zeros_like(before)
    h, w        = before.shape[:2]
    grime_mask  = np.random.rand(h, w).astype(np.float32)
    grime_mask  = cv2.GaussianBlur(grime_mask, (61, 61), 0)
    grime_mask  = (grime_mask * 60).astype(np.float32)

    before[:, :, 0] = np.clip(before[:, :, 0] - grime_mask, 0, 255)
    before[:, :, 1] = np.clip(before[:, :, 1] - grime_mask * 0.8, 0, 255)
    before[:, :, 2] = np.clip(before[:, :, 2] - grime_mask * 0.5, 0, 255)

    # Inject synthetic stain patch
    cx, cy  = int(w * 0.35), int(h * 0.55)
    rx, ry  = int(w * 0.12), int(h * 0.09)
    stain   = before.copy()
    cv2.ellipse(stain, (cx, cy), (rx, ry), 30, 0, 360, (20, 40, 120), -1)
    before  = cv2.addWeighted(before, 0.72, stain, 0.28, 0)

    return np.clip(before, 0, 255).astype(np.uint8)


def compare_images(before: np.ndarray, after: np.ndarray) -> tuple[dict, np.ndarray]:
    """
    Compares before and after images using:
      - SSIM  (Structural Similarity Index)
      - PSNR  (Peak Signal-to-Noise Ratio)
      - Pixel differencing (absdiff)
      - Canny edge change ratio

    Returns:
      - comparison dict with all metrics and verdict
      - colour-coded diff-overlay image (same size as before)
    """
    # Resize after to match before dimensions
    bh, bw  = before.shape[:2]
    after_r = cv2.resize(after, (bw, bh))

    gray_b  = cv2.cvtColor(before,  cv2.COLOR_BGR2GRAY)
    gray_a  = cv2.cvtColor(after_r, cv2.COLOR_BGR2GRAY)

    # ── SSIM ──
    ssim_score, _ssim_map = ssim(gray_b, gray_a, full=True)
    ssim_score            = float(ssim_score)

    # ── PSNR ──
    psnr_score = float(psnr(before, after_r))
    if np.isinf(psnr_score):
        psnr_score = 100.0

    # ── Pixel diff ──
    diff_raw        = cv2.absdiff(before, after_r)
    diff_gray       = cv2.cvtColor(diff_raw, cv2.COLOR_BGR2GRAY)
    _, diff_thresh  = cv2.threshold(diff_gray, 25, 255, cv2.THRESH_BINARY)
    changed_pct     = float(cv2.countNonZero(diff_thresh)) / (bh * bw)

    # ── Edge change ratio ──
    edges_b         = cv2.Canny(gray_b, 50, 150)
    edges_a         = cv2.Canny(gray_a, 50, 150)
    edge_diff       = cv2.bitwise_xor(edges_b, edges_a)
    edge_change_pct = float(cv2.countNonZero(edge_diff)) / (bh * bw)

    # ── Dirt/stain coverage: before vs after (shadows excluded) ──
    def dirt_coverage(bgr_img: np.ndarray) -> float:
        g          = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
        hsv_img    = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2HSV)
        # Raw dark mask
        raw_dark   = cv2.threshold(g, 80, 255, cv2.THRESH_BINARY_INV)[1]
        # Remove shadow pixels before combining
        shad       = _shadow_mask(bgr_img)
        dark_mask  = cv2.bitwise_and(raw_dark, cv2.bitwise_not(shad))
        # High-saturation stains (colour spikes — shadows won't trigger this)
        sat_mask   = cv2.threshold(hsv_img[:, :, 1], 110, 255, cv2.THRESH_BINARY)[1]
        dirt_mask  = cv2.bitwise_or(dark_mask, sat_mask)
        dirt_mask  = cv2.morphologyEx(dirt_mask, cv2.MORPH_OPEN,
                                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        return float(cv2.countNonZero(dirt_mask)) / (bgr_img.shape[0] * bgr_img.shape[1])

    dirt_before = dirt_coverage(before)
    dirt_after  = dirt_coverage(after_r)
    if dirt_before > 0.005:
        dirt_reduction = max(0.0, (dirt_before - dirt_after) / dirt_before)
    else:
        dirt_reduction = 1.0

    # ── Improvement score ──
    remaining_dirt_penalty = dirt_after
    raw_score   = dirt_reduction * 0.7 + (1 - remaining_dirt_penalty) * 0.3
    improvement = round(min(max(raw_score, 0.0), 1.0), 3)

    if improvement >= 0.55:
        verdict = "clean"
    elif improvement >= 0.28:
        verdict = "needs_attention"
    else:
        verdict = "failed"

    # ── Diff visualisation (colour-coded overlay) ──
    diff_vis     = cv2.applyColorMap(diff_gray, cv2.COLORMAP_JET)
    diff_overlay = cv2.addWeighted(after_r, 0.45, diff_vis, 0.55, 0)

    metrics = {
        "ssim":               round(ssim_score, 4),
        "psnr_db":            round(psnr_score, 2),
        "changed_pct":        round(changed_pct * 100, 2),
        "edge_change_pct":    round(edge_change_pct * 100, 2),
        "dirt_coverage_before_pct": round(dirt_before * 100, 2),
        "dirt_coverage_after_pct":  round(dirt_after * 100, 2),
        "dirt_reduction_pct": round(dirt_reduction * 100, 2),
        "improvement_score":  improvement,
        "verdict":            verdict,
        "verdict_label": {
            "clean":           "CLEAN — work verified",
            "needs_attention": "NEEDS ATTENTION — minor issues remain",
            "failed":          "FAILED — insufficient cleaning",
        }[verdict],
    }

    return metrics, diff_overlay


# ──────────────────────────────────────────────────────────
# Full pipeline
# ──────────────────────────────────────────────────────────

def run_pipeline(image_path: str, output_dir: str = None) -> dict:
    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(image_path))
    img = cv2.imread(image_path)
    if img is None:
        return {"error": f"Cannot read image: {image_path}"}

    ts      = datetime.now().strftime("%Y%m%d_%H%M%S")
    result  = {"timestamp": ts, "input_image": image_path}

    # Stage 1
    quality = quality_gate(img)
    result["stage1_quality"] = quality
    if not quality["passed"]:
        result["pipeline_stopped"] = "Stage 1 — image rejected by quality gate"
        result["verdict"] = "rejected"
        return result

    # Stage 2
    issues, annotated = detect_issues(img)
    result["stage2_detection"] = {
        "issue_count": len(issues),
        "issues":      issues,
    }
    ann_path = os.path.join(output_dir, f"cleanops_annotated_{ts}.jpg")
    cv2.imwrite(ann_path, annotated)
    result["annotated_image"] = ann_path

    # Stage 3 — simulate before image from after
    before_img    = make_simulated_before(img)
    metrics, diff = compare_images(before_img, img)
    result["stage3_comparison"] = metrics
    diff_path     = os.path.join(output_dir, f"cleanops_comparison_{ts}.jpg")
    cv2.imwrite(diff_path, diff)
    result["comparison_image"] = diff_path

    result["verdict"]       = metrics["verdict"]
    result["verdict_label"] = metrics["verdict_label"]
    return result


# ──────────────────────────────────────────────────────────
# Human-readable terminal summary
# ──────────────────────────────────────────────────────────

def print_summary(result: dict) -> None:
    """Prints a short, readable summary of the pipeline result to the terminal."""
    sep = "─" * 46
    print(sep)

    if result.get("verdict") == "rejected":
        print("🚫 VERDICT: REJECTED (image quality)")
        print(sep)
        for issue in result["stage1_quality"]["issues"]:
            print(f"  • {issue}")
        print(sep)
        return

    verdict_icons = {
        "clean":           "✅ VERDICT: CLEAN",
        "needs_attention": "⚠️  VERDICT: NEEDS ATTENTION",
        "failed":          "❌ VERDICT: FAILED",
    }
    verdict = result.get("verdict", "unknown")
    print(verdict_icons.get(verdict, f"VERDICT: {verdict.upper()}"))
    print(sep)

    q = result["stage1_quality"]
    print(f"Quality gate   : passed (blur {q['blur_score']:.0f}, "
          f"brightness {q['brightness']:.0f}, {q['resolution']})")

    d = result["stage2_detection"]
    print(f"Issues found   : {d['issue_count']}")
    if d["issue_count"] > 0:
        # Count by label
        counts = {}
        for iss in d["issues"]:
            counts[iss["label"]] = counts.get(iss["label"], 0) + 1
        breakdown = ", ".join(f"{v}x {k}" for k, v in counts.items())
        print(f"                 {breakdown}")

    c = result["stage3_comparison"]
    bar_len   = 20
    filled    = round(c["improvement_score"] * bar_len)
    bar       = "█" * filled + "░" * (bar_len - filled)
    print(f"Score          : [{bar}] {c['improvement_score']:.2f} / 1.00")
    print(f"SSIM           : {c['ssim']:.3f}   "
          f"Dirt before→after: {c['dirt_coverage_before_pct']:.1f}% → "
          f"{c['dirt_coverage_after_pct']:.1f}%")

    print(sep)
    if "annotated_image" in result:
        print(f"📷 Annotated image  → {result['annotated_image']}")
    if "comparison_image" in result:
        print(f"🖼️  Comparison panel → {result['comparison_image']}")
    print(sep)


# ──────────────────────────────────────────────────────────
# Flask API
# ──────────────────────────────────────────────────────────

app = Flask(__name__)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "CleanOps AI Verification"})

@app.route("/verify", methods=["POST"])
def verify():
    if "image" not in request.files:
        return jsonify({"error": "No image file in request (field: 'image')"}), 400
    file    = request.files["image"]
    import tempfile
    tmp     = os.path.join(tempfile.gettempdir(), f"cleanops_input_{datetime.now().strftime('%H%M%S%f')}.jpg")
    file.save(tmp)
    result  = run_pipeline(tmp)
    os.remove(tmp)
    return jsonify(result)


# ──────────────────────────────────────────────────────────
# Before / After pipeline (real two-image mode)
# ──────────────────────────────────────────────────────────

def _put_label_bar(canvas: np.ndarray, x: int, y: int, w: int, text: str,
                   bg: tuple, fg: tuple = (255, 255, 255)) -> None:
    """Draw a filled label rectangle + centred text on canvas (in-place)."""
    bar_h = 32
    cv2.rectangle(canvas, (x, y), (x + w, y + bar_h), bg, -1)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, 0.65, 1)
    tx = x + max((w - tw) // 2, 4)
    ty = y + bar_h - (bar_h - th) // 2
    cv2.putText(canvas, text, (tx, ty),
                cv2.FONT_HERSHEY_DUPLEX, 0.65, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(canvas, text, (tx, ty),
                cv2.FONT_HERSHEY_DUPLEX, 0.65, fg,     1, cv2.LINE_AA)


def _put_text_shadow(canvas: np.ndarray, text: str, org: tuple,
                     scale: float, fg: tuple, thickness: int = 1) -> None:
    """Draw text with a dark shadow for contrast on any background."""
    cv2.putText(canvas, text, org, cv2.FONT_HERSHEY_SIMPLEX,
                scale, (0, 0, 0), thickness + 2, cv2.LINE_AA)
    cv2.putText(canvas, text, org, cv2.FONT_HERSHEY_SIMPLEX,
                scale, fg,      thickness,     cv2.LINE_AA)


def run_comparison_pipeline(before_path: str, after_path: str, output_dir: str = None) -> dict:
    """
    Takes REAL before and after images, runs quality gates on both,
    runs YOLO detection on both, computes cleaning score, and saves ONE
    combined output image:

        ┌──────────────┬──────────────┬──────────────┐
        │ BEFORE       │ AFTER        │ DIFF MAP     │  ← top row (YOLO annotated)
        │ (YOLO boxes) │ (YOLO boxes) │ (heat map)   │
        └──────────────┴──────────────┴──────────────┘
        ┌──────────────────────────────────────────────┐
        │  Cleaning grade / YOLO results / all metrics │  ← results panel
        └──────────────────────────────────────────────┘
    """
    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(after_path))

    before_img = cv2.imread(before_path)
    after_img  = cv2.imread(after_path)

    if before_img is None:
        return {"error": f"Cannot read before image: {before_path}"}
    if after_img is None:
        return {"error": f"Cannot read after image: {after_path}"}

    ts     = datetime.now().strftime("%Y%m%d_%H%M%S")
    result = {"timestamp": ts, "before_image": before_path, "after_image": after_path}

    # ── Quality gates ──
    q_before = quality_gate(before_img)
    q_after  = quality_gate(after_img)
    result["quality_before"] = q_before
    result["quality_after"]  = q_after

    if not q_before["passed"]:
        result["error"] = f"BEFORE image rejected by quality gate: {q_before['issues']}"
        return result
    if not q_after["passed"]:
        result["error"] = f"AFTER image rejected by quality gate: {q_after['issues']}"
        return result

    # ── YOLO / issue detection on both images ──
    issues_before, ann_before = detect_issues(before_img)
    issues_after,  ann_after  = detect_issues(after_img)

    # ── Split into SCORED issues (dirt/stain) and INFO-only objects (YOLO) ──
    # Only scored=True entries (OpenCV dirt/stain) drive the cleaning score.
    # YOLO objects (chair, table, keyboard…) are shown in image but NOT scored.
    def _scored(issues: list[dict]) -> list[dict]:
        return [i for i in issues if i.get("scored", True)]

    def _yolo_objs(issues: list[dict]) -> list[dict]:
        return [i for i in issues if not i.get("scored", True)]

    scored_before = _scored(issues_before)
    scored_after  = _scored(issues_after)
    yolo_before   = _yolo_objs(issues_before)
    yolo_after    = _yolo_objs(issues_after)

    # Use only SCORED (dirt/stain) counts for the score
    result["issues_before"] = len(scored_before)   # dirt/stain only
    result["issues_after"]  = len(scored_after)    # dirt/stain only
    result["yolo_obj_before"] = len(yolo_before)
    result["yolo_obj_after"]  = len(yolo_after)

    # Collect YOLO object class names for display
    def _yolo_classes(objs: list[dict]) -> list[str]:
        names = []
        for obj in objs:
            lbl = obj.get("label", "")
            if lbl.startswith("Object /"):
                names.append(lbl.split("Object /", 1)[1].strip())
        return names

    yolo_before_classes = _yolo_classes(yolo_before)
    yolo_after_classes  = _yolo_classes(yolo_after)
    result["yolo_before"] = yolo_before_classes
    result["yolo_after"]  = yolo_after_classes

    # ── Core comparison metrics + diff overlay ──
    metrics, diff_overlay = compare_images(before_img, after_img)
    result["comparison"] = metrics

    # ── Cleaning percentage + grade ──
    dirt_red  = metrics["dirt_reduction_pct"] / 100.0
    # Only use scored (dirt/stain) issue counts — YOLO objects excluded
    issue_red = 0.0
    if scored_before:
        issue_red = max(0.0, 1.0 - len(scored_after) / len(scored_before))
    cleaned_pct = round((dirt_red * 0.7 + issue_red * 0.3) * 100, 1)
    result["cleaned_pct"] = cleaned_pct

    GRADE_TABLE = [
        (75, "EXCELLENT",  (30, 180,  60), "Spotless — outstanding cleaning work!"),
        (50, "GOOD",       (60, 160, 220), "Well cleaned — minor traces remain."),
        (25, "PARTIAL",   (20, 120, 240), "Partially cleaned — re-inspection advised."),
        ( 0, "POOR",       (30,  30, 180), "Insufficient cleaning — rework required."),
    ]
    grade, grade_col, grade_msg = "POOR", (30, 30, 180), ""
    for threshold, g, col, msg in GRADE_TABLE:
        if cleaned_pct >= threshold:
            grade, grade_col, grade_msg = g, col, msg
            break
    result["grade"] = grade

    # ═══════════════════════════════════════════════════════════════
    #  BUILD COMBINED OUTPUT IMAGE
    # ═══════════════════════════════════════════════════════════════
    PANEL_W  = 640   # width of each image column
    IMG_H    = 480   # height of each image row
    LABEL_H  = 32    # column-label bar height
    RES_H    = 260   # results panel height
    BORDER   = 3     # border between columns
    TOTAL_W  = PANEL_W * 3 + BORDER * 2

    # ── Resize all three images to the same fixed size ──
    def _fit(img: np.ndarray) -> np.ndarray:
        return cv2.resize(img, (PANEL_W, IMG_H), interpolation=cv2.INTER_AREA)

    tile_before = _fit(ann_before)
    tile_after  = _fit(ann_after)
    tile_diff   = _fit(diff_overlay)

    # Dark canvas
    canvas = np.full((LABEL_H + IMG_H + RES_H, TOTAL_W, 3), 18, dtype=np.uint8)

    # ── Column labels ──
    label_defs = [
        (0,                    "BEFORE  (YOLO detected)", (50, 50, 70)),
        (PANEL_W + BORDER,     "AFTER   (YOLO detected)", (30, 70, 50)),
        (PANEL_W*2 + BORDER*2, "COMPARISON  (Diff Map)",  (60, 50, 70)),
    ]
    for lx, ltxt, lbg in label_defs:
        _put_label_bar(canvas, lx, 0, PANEL_W, ltxt, lbg)

    # ── Paste image tiles ──
    y0 = LABEL_H
    canvas[y0:y0+IMG_H, 0:PANEL_W]                               = tile_before
    canvas[y0:y0+IMG_H, PANEL_W+BORDER : PANEL_W*2+BORDER]       = tile_after
    canvas[y0:y0+IMG_H, PANEL_W*2+BORDER*2 : PANEL_W*3+BORDER*2] = tile_diff

    # Vertical dividers
    canvas[y0:y0+IMG_H, PANEL_W:PANEL_W+BORDER]           = 40
    canvas[y0:y0+IMG_H, PANEL_W*2+BORDER:PANEL_W*2+BORDER*2] = 40

    # ═══════════════════════════════════════════════════════════════
    #  RESULTS PANEL
    # ═══════════════════════════════════════════════════════════════
    ry = LABEL_H + IMG_H       # top of results panel
    cv2.rectangle(canvas, (0, ry), (TOTAL_W, ry + RES_H), (22, 22, 30), -1)
    cv2.line(canvas, (0, ry), (TOTAL_W, ry), (60, 60, 80), 2)

    # ── Grade badge (left column) ──
    badge_x, badge_y = 20, ry + 18
    badge_w, badge_h = 220, 80
    cv2.rectangle(canvas, (badge_x, badge_y),
                  (badge_x + badge_w, badge_y + badge_h), grade_col, -1)
    cv2.rectangle(canvas, (badge_x, badge_y),
                  (badge_x + badge_w, badge_y + badge_h), (200, 200, 200), 1)
    # Grade text
    (gw, gh), _ = cv2.getTextSize(grade, cv2.FONT_HERSHEY_DUPLEX, 1.2, 2)
    cv2.putText(canvas, grade,
                (badge_x + (badge_w - gw) // 2, badge_y + 50),
                cv2.FONT_HERSHEY_DUPLEX, 1.2, (255, 255, 255), 2, cv2.LINE_AA)
    # Grade message below badge
    _put_text_shadow(canvas, grade_msg,
                     (badge_x, badge_y + badge_h + 20),
                     0.42, (180, 180, 180))

    # ── Cleaning % progress bar ──
    bar_x    = badge_x
    bar_y    = badge_y + badge_h + 46
    bar_w    = TOTAL_W - badge_x * 2
    bar_h_px = 28
    filled_w = int((cleaned_pct / 100.0) * bar_w)

    cv2.rectangle(canvas, (bar_x, bar_y),
                  (bar_x + bar_w, bar_y + bar_h_px), (40, 40, 50), -1)
    if filled_w > 0:
        cv2.rectangle(canvas, (bar_x, bar_y),
                      (bar_x + filled_w, bar_y + bar_h_px), grade_col, -1)
    cv2.rectangle(canvas, (bar_x, bar_y),
                  (bar_x + bar_w, bar_y + bar_h_px), (80, 80, 100), 1)
    pct_label = f"Cleaning Completed: {cleaned_pct:.1f}%"
    (pw2, ph2), _ = cv2.getTextSize(pct_label, cv2.FONT_HERSHEY_SIMPLEX, 0.58, 1)
    _put_text_shadow(canvas, pct_label,
                     (bar_x + (bar_w - pw2) // 2, bar_y + bar_h_px - 7),
                     0.58, (255, 255, 255), 1)

    # ── Metrics grid (two columns) ──
    mx1 = badge_x         # left col x
    mx2 = TOTAL_W // 2 + 20  # right col x
    my  = bar_y + bar_h_px + 26
    line_h = 26

    c  = metrics
    def _metric_row(canvas, x, y, label, value, vc=(210, 210, 255)):
        _put_text_shadow(canvas, label, (x, y), 0.48, (150, 150, 160))
        (lw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
        _put_text_shadow(canvas, value, (x + lw + 8, y), 0.48, vc)

    # Left column
    _metric_row(canvas, mx1, my,           "SSIM Similarity : ", f"{c['ssim']:.4f}")
    _metric_row(canvas, mx1, my+line_h,    "PSNR            : ", f"{c['psnr_db']:.1f} dB")
    _metric_row(canvas, mx1, my+line_h*2,  "Pixel Changed   : ", f"{c['changed_pct']:.1f}%")
    _metric_row(canvas, mx1, my+line_h*3,  "Edge Change     : ", f"{c['edge_change_pct']:.1f}%")

    # Right column
    _metric_row(canvas, mx2, my,           "Dirt Before     : ", f"{c['dirt_coverage_before_pct']:.1f}%", (200, 120, 100))
    _metric_row(canvas, mx2, my+line_h,    "Dirt After      : ", f"{c['dirt_coverage_after_pct']:.1f}%",  (100, 200, 120))
    _metric_row(canvas, mx2, my+line_h*2,  "Dirt Reduced    : ", f"{c['dirt_reduction_pct']:.1f}%",      (100, 220, 160))

    # ── YOLO detections summary ──
    yolo_y = my + line_h * 4 + 6
    before_cls_str = ", ".join(yolo_before_classes) if yolo_before_classes else "none"
    after_cls_str  = ", ".join(yolo_after_classes)  if yolo_after_classes  else "none"
    # Truncate if too long
    max_chars = 60
    if len(before_cls_str) > max_chars:
        before_cls_str = before_cls_str[:max_chars] + "…"
    if len(after_cls_str) > max_chars:
        after_cls_str = after_cls_str[:max_chars] + "…"

    # Dirt/stain issue counts (these ARE scored)
    _metric_row(canvas, mx1, yolo_y,
                f"Dirt Issues Before : ",
                str(result['issues_before']), (200, 120, 100))
    _metric_row(canvas, mx1, yolo_y + line_h,
                f"Dirt Issues After  : ",
                str(result['issues_after']),  (100, 200, 120))

    # YOLO objects (info only — not scored)
    yolo_info_y = yolo_y + line_h * 2 + 4
    _metric_row(canvas, mx1, yolo_info_y,
                f"YOLO Objects (info, not scored): ",
                before_cls_str if before_cls_str != 'none' else 'none detected',
                (140, 190, 220))
    _metric_row(canvas, mx1, yolo_info_y + line_h,
                f"  → after  : ",
                after_cls_str if after_cls_str != 'none' else 'none detected',
                (140, 190, 220))

    # ── Verdict text bottom-right ──
    verdict_icons = {
        "clean":           "VERDICT: CLEAN",
        "needs_attention": "VERDICT: NEEDS ATTENTION",
        "failed":          "VERDICT: FAILED",
    }
    verdict_cols = {
        "clean":           (60, 200, 80),
        "needs_attention": (60, 160, 240),
        "failed":          (60, 60, 220),
    }
    verdict_str = verdict_icons.get(metrics["verdict"], metrics["verdict"].upper())
    vcol        = verdict_cols.get(metrics["verdict"], (200, 200, 200))
    (vw, vh), _ = cv2.getTextSize(verdict_str, cv2.FONT_HERSHEY_DUPLEX, 0.75, 2)
    _put_text_shadow(canvas, verdict_str,
                     (TOTAL_W - vw - 20, ry + RES_H - 18),
                     0.75, vcol, 2)

    # ── Timestamp ──
    _put_text_shadow(canvas, f"CleanOps AI  |  {ts}",
                     (mx1, ry + RES_H - 18),
                     0.42, (100, 100, 110))

    # ═══════════════════════════════════════════════════════════════
    #  Save single combined output
    # ═══════════════════════════════════════════════════════════════
    os.makedirs(output_dir, exist_ok=True)
    panel_path = os.path.join(output_dir, f"cleanops_result_{ts}.jpg")
    cv2.imwrite(panel_path, canvas, [cv2.IMWRITE_JPEG_QUALITY, 95])
    result["comparison_image"] = panel_path
    print(f"[CleanOps] Combined result saved → {panel_path}")

    return result


def print_comparison_summary(result: dict) -> None:
    """Prints a readable summary for the before/after comparison mode."""
    sep = "-" * 52
    print(sep)

    if "error" in result:
        print(f"ERROR: {result['error']}")
        print(sep)
        return

    cp   = result.get("cleaned_pct", 0)
    grade = result.get("grade", "?")
    grade_icons = {"EXCELLENT": "[++]", "GOOD": "[+ ]", "PARTIAL": "[~~ ]", "POOR": "[--]"}
    print(f"{grade_icons.get(grade, '[?]')} CLEANING SCORE: {cp:.1f}%  |  Grade: {grade}")
    print(sep)

    bar_len = 40
    filled  = round(cp / 100 * bar_len)
    bar     = "#" * filled + "-" * (bar_len - filled)
    print(f"  [{bar}] {cp:.1f}%")
    print()

    c = result["comparison"]
    print(f"  Dirt coverage    : {c['dirt_coverage_before_pct']:.1f}%  ->  {c['dirt_coverage_after_pct']:.1f}%  (reduced {c['dirt_reduction_pct']:.1f}%)")
    print(f"  Issues detected  : {result['issues_before']}  ->  {result['issues_after']}")
    print(f"  SSIM similarity  : {c['ssim']:.4f}  (1.0 = identical)")
    print(f"  Pixel changed    : {c['changed_pct']:.1f}%")
    print()
    print(f"  Before quality   : blur={result['quality_before']['blur_score']}, brightness={result['quality_before']['brightness']}")
    print(f"  After  quality   : blur={result['quality_after']['blur_score']}, brightness={result['quality_after']['brightness']}")
    print(sep)
    if "comparison_image" in result:
        print(f"  Comparison panel -> {result['comparison_image']}")
    print(sep)


# ──────────────────────────────────────────────────────────
# Auto-folder helpers
# ──────────────────────────────────────────────────────────

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".jfif"}


def _first_image_in(folder: str) -> str | None:
    """Return the path of the first image file found in *folder*, or None."""
    if not os.path.isdir(folder):
        return None
    for fname in sorted(os.listdir(folder)):
        if os.path.splitext(fname)[1].lower() in _IMAGE_EXTS:
            return os.path.join(folder, fname)
    return None


def _all_images_in(folder: str) -> list[str]:
    """Return sorted list of all image paths in *folder*."""
    if not os.path.isdir(folder):
        return []
    return [
        os.path.join(folder, f)
        for f in sorted(os.listdir(folder))
        if os.path.splitext(f)[1].lower() in _IMAGE_EXTS
    ]


# ──────────────────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Resolve script directory so relative folder defaults work wherever the
    # script is launched from.
    _SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

    parser = argparse.ArgumentParser(
        description="CleanOps AI Image Verification",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples
--------
  # Auto mode — pick first image from before/ and after/, save to output/
  python cleanops_verify.py

  # Specify explicit files
  python cleanops_verify.py --before path/to/dirty.jpg --after path/to/clean.jpg

  # Custom folders
  python cleanops_verify.py --before-dir site_A/before --after-dir site_A/after --output-dir site_A/results

  # Single image (3-stage pipeline)
  python cleanops_verify.py --image path/to/image.jpg
""",
    )
    parser.add_argument("--image",      type=str, default=None,
                         help="Single image — runs full 3-stage pipeline")
    parser.add_argument("--before",     type=str, default=None,
                         help="Explicit BEFORE image path (overrides --before-dir)")
    parser.add_argument("--after",      type=str, default=None,
                         help="Explicit AFTER  image path (overrides --after-dir)")
    parser.add_argument("--before-dir", type=str,
                         default=os.path.join(_SCRIPT_DIR, "before"),
                         help="Folder to pick BEFORE image from (default: ./before/)")
    parser.add_argument("--after-dir",  type=str,
                         default=os.path.join(_SCRIPT_DIR, "after"),
                         help="Folder to pick AFTER  image from (default: ./after/)")
    parser.add_argument("--output-dir", type=str,
                         default=os.path.join(_SCRIPT_DIR, "output"),
                         help="Folder for result image (default: ./output/)")
    parser.add_argument("--all",        action="store_true",
                         help="Process ALL images from before-dir paired with after-dir")
    parser.add_argument("--server",     action="store_true",
                         help="Run Flask API server")
    parser.add_argument("--port",       type=int, default=5001,
                         help="Flask port (default 5001)")
    parser.add_argument("--summary",    action="store_true",
                         help="Print human-readable summary")
    parser.add_argument("--json",       action="store_true",
                         help="Print raw JSON output")
    args = parser.parse_args()

    out_dir = args.output_dir
    os.makedirs(out_dir, exist_ok=True)

    # ── Flask server ──
    if args.server:
        print(f"Starting CleanOps AI service on port {args.port}...")
        app.run(host="0.0.0.0", port=args.port, debug=False)

    # ── Single image pipeline ──
    elif args.image:
        print(f"\nRunning pipeline on: {args.image}\n")
        out = run_pipeline(args.image, output_dir=out_dir)
        if "error" in out:
            print(f"Error: {out['error']}")
        elif args.summary or not args.json:
            print_summary(out)
            if args.json:
                print()
                print(json.dumps(out, indent=2))
        else:
            print(json.dumps(out, indent=2))

    # ── Before / After comparison (explicit file paths) ──
    elif args.before and args.after:
        print(f"\nComparing BEFORE: {args.before}")
        print(f"         AFTER : {args.after}\n")
        out = run_comparison_pipeline(args.before, args.after, output_dir=out_dir)
        print_comparison_summary(out)
        if args.json:
            print()
            print(json.dumps(out, indent=2))

    # ── AUTO mode: pick from before-dir / after-dir ──
    else:
        if args.all:
            # Pair images by sorted order (first with first, second with second…)
            before_imgs = _all_images_in(args.before_dir)
            after_imgs  = _all_images_in(args.after_dir)
            if not before_imgs:
                print(f"[ERROR] No images found in before-dir: {args.before_dir}")
                sys.exit(1)
            if not after_imgs:
                print(f"[ERROR] No images found in after-dir:  {args.after_dir}")
                sys.exit(1)
            pairs = list(zip(before_imgs, after_imgs))
            print(f"\nAuto mode — processing {len(pairs)} pair(s)\n")
            for b_path, a_path in pairs:
                print(f"  BEFORE : {b_path}")
                print(f"  AFTER  : {a_path}")
                out = run_comparison_pipeline(b_path, a_path, output_dir=out_dir)
                print_comparison_summary(out)
                if args.json:
                    print(json.dumps(out, indent=2))
        else:
            # Default: pick the FIRST image from each folder
            b_path = _first_image_in(args.before_dir)
            a_path = _first_image_in(args.after_dir)

            if b_path is None:
                print(f"[ERROR] No image found in before-dir: {args.before_dir}")
                print("        Put your BEFORE image there, or use --before <file>")
                sys.exit(1)
            if a_path is None:
                print(f"[ERROR] No image found in after-dir:  {args.after_dir}")
                print("        Put your AFTER image there, or use --after <file>")
                sys.exit(1)

            print(f"\nAuto mode")
            print(f"  BEFORE : {b_path}")
            print(f"  AFTER  : {a_path}")
            print(f"  OUTPUT : {out_dir}\n")

            out = run_comparison_pipeline(b_path, a_path, output_dir=out_dir)
            print_comparison_summary(out)
            if args.json:
                print()
                print(json.dumps(out, indent=2))
