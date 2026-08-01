"""
CleanOps — Chunked Training Manager
====================================
Trains in milestones: 10 → 15 → 20 → 30 → 50 → 100
Each run picks up from where the last one stopped.

Usage:
    python train_chunks.py              # auto-advance to next milestone
    python train_chunks.py --status     # just show current progress
    python train_chunks.py --milestone 30   # jump to a specific milestone
"""

import os
import sys
import csv
import yaml
import argparse
import subprocess
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
ARGS_YAML   = Path('e:/tmp/runs/trash_detect/args.yaml')
RESULTS_CSV = Path('e:/tmp/runs/trash_detect/results.csv')
LAST_PT     = Path('e:/tmp/runs/trash_detect/weights/last.pt')
BEST_PT     = Path('e:/tmp/runs/trash_detect/weights/best.pt')

# The milestone ladder — each step is a total epoch target
MILESTONES  = [10, 15, 20, 30, 50, 100]


# ── Helpers ───────────────────────────────────────────────────────────────────
def get_current_epoch():
    """Read how many epochs have actually been completed."""
    if not RESULTS_CSV.exists():
        return 0
    with open(RESULTS_CSV, newline='') as f:
        rows = list(csv.reader(f))
    # rows[0] = header, rows[1:] = data
    data = [r for r in rows[1:] if r and r[0].strip()]
    if not data:
        return 0
    return int(data[-1][0])


def get_best_metrics():
    """Return the best mAP50 row from results.csv."""
    if not RESULTS_CSV.exists():
        return None
    with open(RESULTS_CSV, newline='') as f:
        reader = csv.DictReader(f)
        rows   = [r for r in reader if r.get('epoch', '').strip()]
    if not rows:
        return None
    return max(rows, key=lambda r: float(r.get('metrics/mAP50(B)', 0)))


def print_status():
    current_epoch = get_current_epoch()
    best          = get_best_metrics()
    next_milestone = next((m for m in MILESTONES if m > current_epoch), None)

    print('\n' + '='*60)
    print('  CleanOps — Training Progress')
    print('='*60)
    print(f'  Epochs completed  : {current_epoch}')

    if best:
        print(f'  Best mAP@50       : {float(best["metrics/mAP50(B)"]):.4f}  (epoch {best["epoch"].strip()})')
        print(f'  Best mAP@50-95    : {float(best["metrics/mAP50-95(B)"]):.4f}')
        print(f'  Best Precision    : {float(best["metrics/precision(B)"]):.4f}')
        print(f'  Best Recall       : {float(best["metrics/recall(B)"]):.4f}')

    print(f'\n  Milestones        : {MILESTONES}')
    completed = [m for m in MILESTONES if m <= current_epoch]
    remaining = [m for m in MILESTONES if m > current_epoch]
    print(f'  Completed         : {completed if completed else "none"}')
    print(f'  Remaining         : {remaining if remaining else "ALL DONE!"}')

    if next_milestone:
        print(f'\n  ▶  Next target    : {next_milestone} epochs  (+{next_milestone - current_epoch} more)')

    print('='*60 + '\n')
    return current_epoch, next_milestone


def set_epoch_target(target: int):
    """Patch epochs: N in args.yaml to the new target."""
    content = ARGS_YAML.read_text()
    lines   = content.splitlines()
    patched = []
    for line in lines:
        if line.startswith('epochs:'):
            patched.append(f'epochs: {target}')
        elif line.startswith('patience:'):
            # Extend patience so it doesn't early-stop too soon
            patched.append(f'patience: {max(20, target // 2)}')
        else:
            patched.append(line)
    ARGS_YAML.write_text('\n'.join(patched))
    print(f'  ✔ args.yaml updated → epochs: {target}')


def run_chunk(target_epoch: int):
    current = get_current_epoch()
    if current >= target_epoch:
        print(f'  Already at epoch {current} — milestone {target_epoch} already reached.')
        return

    add = target_epoch - current
    print(f'\n  🚀 Training {add} more epochs  (epoch {current} → {target_epoch})')
    print(f'     Model  : {LAST_PT}')
    print(f'     Device : CPU  (grab a coffee ☕)\n')

    set_epoch_target(target_epoch)

    cmd = [
        sys.executable, '-m', 'ultralytics',
        'train',
        'resume',
        f'model={LAST_PT}',
    ]

    result = subprocess.run(cmd, cwd='e:/tmp')
    if result.returncode == 0:
        print('\n  ✅ Chunk complete!')
        print_status()
        print('  Run this script again to advance to the next milestone.\n')
    else:
        print('\n  ❌ Training failed — check the output above.\n')


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='CleanOps Chunked Trainer')
    parser.add_argument('--status',    action='store_true', help='Show progress only')
    parser.add_argument('--milestone', type=int, default=None,
                        help='Jump to a specific epoch milestone (e.g. --milestone 30)')
    args = parser.parse_args()

    current_epoch, next_milestone = print_status()

    if args.status:
        return

    if args.milestone:
        if args.milestone not in MILESTONES and args.milestone > current_epoch:
            MILESTONES.append(args.milestone)
            MILESTONES.sort()
        target = args.milestone
    elif next_milestone:
        target = next_milestone
    else:
        print('  🏆 All milestones completed! Model is fully trained.\n')
        return

    confirm = input(f'  Train to epoch {target}? [Y/n]: ').strip().lower()
    if confirm in ('', 'y', 'yes'):
        run_chunk(target)
    else:
        print('  Skipped. Run again when ready.\n')


if __name__ == '__main__':
    main()
