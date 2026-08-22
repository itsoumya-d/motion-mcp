"""Adapter for ARDY generate.py output (.npz) -> MotionDoc.

ARDY's scripts/generate.py writes .npz files containing posed_joints [T, J, 3],
local/global rotations, root positions and foot contacts. The exact joint
ordering depends on the checkpoint skeleton (core / g1 / soma), so this adapter
requires an explicit joint map until the first checkpoint is inspected:

    python pipeline/cli.py from-ardy outputs/squat.npz \
        --joint-map pipeline/maps/core-to-humanoid.json -o baked/squat.json

The map file shape:
    {"joints": {"0": "root", "1": "spine", ...}, "fps": 20}
Index keys are npz column indices; unmapped joints are dropped with a warning.
"""

import json


def load_joint_map(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if "joints" not in data:
        raise ValueError("joint map must contain a 'joints' object")
    return data


def doc_from_npz(npz_path, joint_map_path):
    import numpy as np  # guarded: only needed for ARDY inputs

    mapping = load_joint_map(joint_map_path)
    name_by_index = {int(k): v for k, v in mapping["joints"].items()}
    fps = int(mapping.get("fps", 20))

    data = np.load(npz_path, allow_pickle=False)
    if "posed_joints" not in data:
        raise ValueError(
            f"{npz_path} has no 'posed_joints' array; regenerate via ardy scripts/generate.py"
        )
    joints = data["posed_joints"]  # [T, J, 3]
    frames = joints.shape[0]
    duration_ms = int(round(frames / fps * 1000))
    root = joints[:, 0:1, :]  # assumed pelvis; verified during first bake

    doc = {
        "format": "motion-mcp.motiondoc",
        "version": 1,
        "id": str(npz_path).rsplit("/", 1)[-1].replace(".npz", ""),
        "fps": fps,
        "durationMs": duration_ms,
        "loop": True,
        "meta": {
            "source": "ardy",
            "generator": "nv-tlabs/ardy",
            "skeleton": str(mapping.get("skeleton", "unknown")),
        },
        "tracks": {},
        "translations": {},
    }

    # Joint positions alone are not local rotations; a proper retarget pass
    # (positions -> hierarchical euler angles for the humanoid rig) lands in the
    # next iteration once the core checkpoint's joint order is confirmed.
    doc["meta"]["rawJointCount"] = int(joints.shape[1])
    doc["meta"]["frames"] = int(frames)
    doc["meta"]["retarget"] = "pending"
    doc["translations"]["rootPath"] = [
        [
            round(i / fps * 1000),
            float(root[i][0][0]),
            float(root[i][0][1]),
            float(root[i][0][2]),
        ]
        for i in range(0, frames, max(frames // 240, 1))
    ]
    return doc
