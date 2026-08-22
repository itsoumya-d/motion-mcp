"""Keyframe reduction and rotation quantization for MotionDoc tracks."""

import json
import math
from pathlib import Path

from motiondoc import FORMAT_ID, new_doc


def load_doc(path):
    with open(path, "r", encoding="utf-8") as handle:
        doc = json.load(handle)
    if doc.get("format") != FORMAT_ID:
        raise ValueError(f"{path} is not a {FORMAT_ID} document")
    return doc


def _rdp(points, eps):
    """Ramer-Douglas-Peucker over [t, x, y, z] rows; keeps first and last."""
    if len(points) < 3:
        return list(points)
    start = points[0]
    end = points[-1]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dz = end[2] - start[2]
    dw = end[3] - start[3]
    dd = dx * dx + dy * dy + dz * dz + dw * dw
    index = -1
    worst = 0.0

    def seg_dist(p):
        px = p[0] - start[0]
        py = p[1] - start[1]
        pz = p[2] - start[2]
        pw = p[3] - start[3]
        if dd <= 1e-12:
            return math.sqrt(px * px + py * py + pz * pz + pw * pw)
        t = (px * dx + py * dy + pz * dz + pw * dw) / dd
        qx = px - t * dx
        qy = py - t * dy
        qz = pz - t * dz
        qw = pw - t * dw
        return math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)

    for i in range(1, len(points) - 1):
        dist = seg_dist(points[i])
        if dist > worst:
            worst = dist
            index = i
    if worst > eps and index > 0:
        left = _rdp(points[: index + 1], eps)
        right = _rdp(points[index:], eps)
        return left[:-1] + right
    return [start, end]


def reduce_track(keys, eps=0.4):
    """Reduce a [[t,x,y,z], ...] track. Time is normalized to 0..100 before RDP so
    angle degrees dominate the distance metric."""
    if len(keys) <= 2:
        return list(keys)
    span = max((k[0] for k in keys), default=1.0) or 1.0
    scaled = [[k[0] / span * 100.0, k[1], k[2], k[3]] for k in keys]
    kept = _rdp(scaled, eps)
    return [[round(k[0] / 100.0 * span), k[1], k[2], k[3]] for k in kept]


def quantize_track(keys, angle_step=0.05, time_step=10):
    out = []
    for k in keys:
        t = round(k[0] / time_step) * time_step
        out.append(
            [
                float(t),
                round(k[1] / angle_step) * angle_step,
                round(k[2] / angle_step) * angle_step,
                round(k[3] / angle_step) * angle_step,
            ]
        )
    merged = []
    for row in out:
        if merged and merged[-1][1:] == row[1:] and abs(merged[-1][0] - row[0]) <= time_step:
            continue
        merged.append(row)
    return merged


def quantize_translation_track(keys, pos_step=0.005, time_step=10):
    return quantize_track(keys, angle_step=pos_step, time_step=time_step)


def process_doc(doc, eps=0.4, translation_eps=0.03):
    """Return a reduced + quantized copy of a MotionDoc.

    eps is in angle-degrees (time normalized); translation_eps is in meters so
    root dips survive reduction instead of being flattened by the angle scale.
    """
    out = new_doc(doc["id"], doc["durationMs"], doc["loop"], meta=doc.get("meta"))
    for joint, keys in doc.get("tracks", {}).items():
        out["tracks"][joint] = quantize_track(reduce_track(keys, eps=eps))
    for joint, keys in doc.get("translations", {}).items():
        out["translations"][joint] = quantize_translation_track(reduce_track(keys, eps=translation_eps))
    return out


def count_keys(doc):
    total = sum(len(v) for v in doc.get("tracks", {}).values())
    total += sum(len(v) for v in doc.get("translations", {}).values())
    return total


def bake_library(src_dir, out_dir, eps=0.4):
    """Reduce + quantize every MotionDoc in src_dir into out_dir with a manifest."""
    src_dir = Path(src_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for src in sorted(src_dir.glob("*.json")):
        try:
            doc = load_doc(src)
        except ValueError:
            continue
        baked = process_doc(doc, eps=eps)
        name = f"{src.stem}.baked.json"
        with open(out_dir / name, "w", encoding="utf-8") as handle:
            json.dump(baked, handle, separators=(",", ":"))
            handle.write("\n")
        entries.append(
            {
                "file": name,
                "id": baked["id"],
                "durationMs": baked["durationMs"],
                "loop": baked["loop"],
                "exercise": (baked.get("meta") or {}).get("exercise"),
                "keys": count_keys(baked),
            }
        )
    manifest = {
        "format": "motion-mcp.clip-library",
        "version": 1,
        "clips": entries,
    }
    with open(out_dir / "library.json", "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    return manifest
