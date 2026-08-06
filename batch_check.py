"""
Batch cleanliness check - runs CleanOps pipeline on every image in before\
and prints a summary table.
"""
import sys, io, os, json, subprocess
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BEFORE_DIR = r"e:\tmp\before"
PYTHON     = sys.executable
SCRIPT     = r"e:\tmp\cleanops_verify.py"

VERDICT_LABEL = {
    "clean":           "[CLEAN]          ",
    "needs_attention": "[NEEDS ATTENTION]",
    "failed":          "[FAILED]         ",
    "rejected":        "[REJECTED]       ",
}

SUPPORTED = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}

images = sorted([
    f for f in os.listdir(BEFORE_DIR)
    if os.path.splitext(f)[1].lower() in SUPPORTED
])

SEP = "=" * 72
print(f"\n{SEP}")
print(f"  CleanOps Batch Check  |  {len(images)} images in before\\")
print(SEP)
print(f"  {'File':<32} {'Verdict':<19} {'Score':>6}  {'Dirt%':>6}  {'Issues':>6}")
print(SEP)

skipped = []
results = []

for fname in images:
    path = os.path.join(BEFORE_DIR, fname)
    try:
        proc = subprocess.run(
            [PYTHON, SCRIPT, "--image", path, "--json",
             "--output-dir", r"e:\tmp\output"],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"}
        )
        stdout = proc.stdout
        json_start = stdout.find('{')
        if json_start == -1:
            skipped.append((fname, "no JSON output"))
            continue

        data, _ = json.JSONDecoder().raw_decode(stdout, json_start)
        verdict = data.get("verdict", "unknown")
        label   = VERDICT_LABEL.get(verdict, verdict)

        comp    = data.get("stage3_comparison", {})
        score   = comp.get("improvement_score", None)
        dirt    = comp.get("dirt_coverage_after_pct", None)
        det     = data.get("stage2_detection", {})
        issues  = det.get("issue_count", "-")

        score_s  = f"{score:.2f}" if score is not None else "  -  "
        dirt_s   = f"{dirt:.1f}%" if dirt  is not None else "  -  "
        issues_s = str(issues)

        short = (fname[:30] + "..") if len(fname) > 32 else fname
        print(f"  {short:<32} {label} {score_s:>6}  {dirt_s:>6}  {issues_s:>6}")
        results.append((fname, verdict, score, dirt, issues))

    except subprocess.TimeoutExpired:
        skipped.append((fname, "timed out"))
    except Exception as e:
        skipped.append((fname, str(e)))

print(SEP)

# Summary counts
counts = {}
for _, v, *_ in results:
    counts[v] = counts.get(v, 0) + 1
print(f"\n  Summary:")
for v, c in sorted(counts.items()):
    print(f"    {VERDICT_LABEL.get(v, v).strip():<19}  {c} image(s)")

# Unsupported formats
all_files   = os.listdir(BEFORE_DIR)
unsupported = [f for f in all_files
               if os.path.splitext(f)[1].lower() not in SUPPORTED
               and not f.startswith('.')]
if unsupported:
    print(f"\n  Unsupported formats (need conversion):")
    for f in unsupported:
        print(f"    - {f}")

if skipped:
    print(f"\n  Skipped ({len(skipped)}):")
    for f, reason in skipped:
        print(f"    - {f}  ({reason})")

print()
