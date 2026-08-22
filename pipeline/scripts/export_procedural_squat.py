#!/usr/bin/env python3
"""Export the procedural squat as a baked MotionDoc fixture.

Demonstrates the bake path end to end: authored MotionDoc -> reduce ->
quantize -> runtime-consumable JSON. Once ARDY is wired on this machine its
outputs replace these fixtures; the runtime loader stays identical.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from motiondoc import add_track, add_translation, new_doc  # noqa: E402
from bake import count_keys, process_doc  # noqa: E402

FIXTURE_DIR = ROOT.parent / "packages" / "motion-runtime" / "fixtures"

SQUAT_TRACKS = {
    "thighL": [[0, 0, 0, 0], [900, 82, 0, -6], [1500, 84, 0, -6], [2400, 0, 0, 0]],
    "thighR": [[0, 0, 0, 0], [900, 82, 0, 6], [1500, 84, 0, 6], [2400, 0, 0, 0]],
    "shinL": [[0, 0, 0, 0], [900, -74, 0, 0], [1500, -76, 0, 0], [2400, 0, 0, 0]],
    "shinR": [[0, 0, 0, 0], [900, -74, 0, 0], [1500, -76, 0, 0], [2400, 0, 0, 0]],
    "spine": [[0, 0, 0, 0], [900, 16, 0, 0], [1500, 18, 0, 0], [2400, 0, 0, 0]],
    "upperArmL": [[0, 0, 0, 4], [900, 74, 0, 10], [1500, 76, 0, 10], [2400, 0, 0, 4]],
    "upperArmR": [[0, 0, 0, -4], [900, 74, 0, -10], [1500, 76, 0, -10], [2400, 0, 0, -4]],
    "forearmL": [[0, 0, 0, 0], [900, -18, 0, 0], [2400, 0, 0, 0]],
    "forearmR": [[0, 0, 0, 0], [900, -18, 0, 0], [2400, 0, 0, 0]],
    "head": [[0, 0, 0, 0], [900, -14, 0, 0], [2400, 0, 0, 0]],
}
SQUAT_ROOT = [[0, 0, 0, 0], [900, 0, -0.34, 0], [1500, 0, -0.36, 0], [2400, 0, 0, 0]]


def build_squat():
    doc = new_doc(
        "baked-squat",
        2400,
        True,
        meta={
            "exercise": "squat",
            "source": "procedural",
            "generator": "pipeline/scripts/export_procedural_squat.py",
        },
    )
    for joint, keys in SQUAT_TRACKS.items():
        add_track(doc, joint, keys)
    add_translation(doc, "root", SQUAT_ROOT)
    return doc


def main():
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    raw = build_squat()
    baked = process_doc(raw)
    raw_path = FIXTURE_DIR / "squat.source.json"
    baked_path = FIXTURE_DIR / "squat.baked.json"
    for path, doc in ((raw_path, raw), (baked_path, baked)):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(doc, handle, separators=(",", ":"))
            handle.write("\n")
    print(f"raw   {raw_path}: {count_keys(raw)} keys")
    print(f"baked {baked_path}: {count_keys(baked)} keys")


if __name__ == "__main__":
    main()
