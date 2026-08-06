from ultralytics import YOLO
import cv2
import numpy as np
import os

os.makedirs('e:/tmp/output', exist_ok=True)

model_general = YOLO('e:/tmp/yolov8n.pt')
model_trash   = YOLO('e:/tmp/runs/trash_detect/weights/best.pt')

IMGS = {
    'before': 'e:/tmp/before/dirty.jpg',
    'after' : 'e:/tmp/after/clean.jpg',
}

TARGET_H = 640


def process_image(path):
    img_orig = cv2.imread(path)
    h0, w0   = img_orig.shape[:2]

    r_trash   = model_trash.predict(path,   conf=0.20, verbose=False)[0]
    r_general = model_general.predict(path, conf=0.30, verbose=False)[0]

    trash_boxes   = []
    general_boxes = []

    for box in r_trash.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        trash_boxes.append((x1, y1, x2, y2, model_trash.names[int(box.cls[0])], float(box.conf[0])))

    for box in r_general.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        general_boxes.append((x1, y1, x2, y2, model_general.names[int(box.cls[0])], float(box.conf[0])))

    # Build dirty mask from trash detections
    dirty_mask = np.zeros((h0, w0), dtype=np.uint8)
    for (x1, y1, x2, y2, _, _) in trash_boxes:
        dirty_mask[y1:y2, x1:x2] = 255

    canvas = img_orig.copy()

    # Blue tint on CLEAN regions
    clean_mask = cv2.bitwise_not(dirty_mask)
    blue_layer = np.zeros_like(canvas)
    blue_layer[:] = (180, 100, 30)
    canvas = cv2.addWeighted(canvas, 1.0,
                             cv2.bitwise_and(blue_layer, blue_layer, mask=clean_mask),
                             0.18, 0)

    # Red tint on DIRTY regions
    if dirty_mask.any():
        red_layer    = np.zeros_like(canvas)
        red_layer[:] = (0, 0, 200)
        canvas = cv2.addWeighted(canvas, 1.0,
                                 cv2.bitwise_and(red_layer, red_layer, mask=dirty_mask),
                                 0.30, 0)

    # Cyan boxes = general YOLO objects
    for (x1, y1, x2, y2, name, conf) in general_boxes:
        cv2.rectangle(canvas, (x1, y1), (x2, y2), (0, 220, 220), 2)
        lbl = name + ' ' + str(round(conf, 2))
        (tw, th), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(canvas, (x1, y1 - th - 6), (x1 + tw + 4, y1), (0, 180, 180), -1)
        cv2.putText(canvas, lbl, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

    # Red boxes = trash detections
    for (x1, y1, x2, y2, name, conf) in trash_boxes:
        cv2.rectangle(canvas, (x1, y1), (x2, y2), (0, 0, 255), 3)
        lbl = 'TRASH:' + name + ' ' + str(round(conf, 2))
        (tw, th), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(canvas, (x1, y1 - th - 6), (x1 + tw + 4, y1), (0, 0, 200), -1)
        cv2.putText(canvas, lbl, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    scale  = TARGET_H / h0
    canvas = cv2.resize(canvas, (int(w0 * scale), TARGET_H))

    return canvas, trash_boxes, general_boxes


print('Processing BEFORE...')
img_before, t_before, g_before = process_image(IMGS['before'])
print('Processing AFTER...')
img_after, t_after, g_after     = process_image(IMGS['after'])

GAP      = 6
HEADER_H = 110
FOOTER_H = 160
PANEL_H  = TARGET_H
total_w  = img_before.shape[1] + GAP + img_after.shape[1]
total_h  = HEADER_H + PANEL_H + FOOTER_H

canvas = np.ones((total_h, total_w, 3), dtype=np.uint8) * 15

# Header
cv2.rectangle(canvas, (0, 0), (total_w, HEADER_H), (25, 25, 35), -1)
cv2.putText(canvas, 'CleanOps AI  -  Dual-Model Detection Report',
            (total_w // 2 - 400, 48), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (220, 220, 220), 2)
legend = 'CYAN = YOLOv8 General Objects   |   RED = Custom Trash Model   |   BLUE tint = Clean   |   RED tint = Dirty'
cv2.putText(canvas, legend,
            (total_w // 2 - 490, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (140, 160, 180), 1)

# Place images
bw = img_before.shape[1]
canvas[HEADER_H:HEADER_H + PANEL_H, 0:bw]    = img_before
canvas[HEADER_H:HEADER_H + PANEL_H, bw + GAP:] = img_after


def clean_score(trash_boxes):
    if not trash_boxes:
        return 100.0
    pen = min(sum(c for _, _, _, _, _, c in trash_boxes), 1.0)
    return round((1 - pen) * 100, 1)


score_before = clean_score(t_before)
score_after  = clean_score(t_after)

fy = HEADER_H + PANEL_H + 10
aw = img_after.shape[1]

# Before footer
trash_names_before  = ', '.join(sorted(set(n for _, _, _, _, n, _ in t_before))) or 'none'
gen_names_before    = ', '.join(sorted(set(n for _, _, _, _, n, _ in g_before))[:5]) or 'none'
cv2.rectangle(canvas, (0, fy), (bw, fy + FOOTER_H - 15), (50, 20, 20), -1)
cv2.putText(canvas, 'BEFORE  (Dirty)',
            (14, fy + 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (80, 100, 255), 2)
cv2.putText(canvas, 'Trash items  : ' + str(len(t_before)) + '  (' + trash_names_before + ')',
            (14, fy + 62), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (180, 180, 255), 1)
cv2.putText(canvas, 'YOLO objects : ' + str(len(g_before)) + '  (' + gen_names_before + ')',
            (14, fy + 86), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (100, 220, 220), 1)
cv2.putText(canvas, 'Cleanliness Score :  ' + str(score_before) + '%',
            (14, fy + 120), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (60, 80, 255), 2)

# After footer
trash_names_after = ', '.join(sorted(set(n for _, _, _, _, n, _ in t_after))) or 'none'
gen_names_after   = ', '.join(sorted(set(n for _, _, _, _, n, _ in g_after))[:5]) or 'none'
ax = bw + GAP
cv2.rectangle(canvas, (ax, fy), (ax + aw, fy + FOOTER_H - 15), (15, 50, 15), -1)
cv2.putText(canvas, 'AFTER  (Clean)',
            (ax + 14, fy + 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (60, 220, 100), 2)
cv2.putText(canvas, 'Trash items  : ' + str(len(t_after)) + '  (' + trash_names_after + ')',
            (ax + 14, fy + 62), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (180, 255, 180), 1)
cv2.putText(canvas, 'YOLO objects : ' + str(len(g_after)) + '  (' + gen_names_after + ')',
            (ax + 14, fy + 86), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (100, 220, 220), 1)
cv2.putText(canvas, 'Cleanliness Score :  ' + str(score_after) + '%',
            (ax + 14, fy + 120), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (40, 200, 80), 2)

out = 'e:/tmp/output/dual_model_comparison.jpg'
cv2.imwrite(out, canvas, [cv2.IMWRITE_JPEG_QUALITY, 95])
print('Saved ->', out)
print('BEFORE: trash=' + str(len(t_before)) + ', general=' + str(len(g_before)) + ', score=' + str(score_before) + '%')
print('AFTER : trash=' + str(len(t_after))  + ', general=' + str(len(g_after))  + ', score=' + str(score_after)  + '%')
