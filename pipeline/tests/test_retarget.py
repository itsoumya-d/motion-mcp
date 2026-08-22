import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from retarget import (  # noqa: E402
    Skeleton,
    euler_xyz_deg_to_mat,
    fk_positions,
    mat_to_euler_xyz_deg,
    rotation_from_to,
    solve_local_rotations,
)


def load_humanoid():
    with open(ROOT / "maps" / "humanoid.json", "r", encoding="utf-8") as handle:
        return Skeleton(json.load(handle)["joints"])


def lcg(seed):
    state = seed
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        return_value = ((state >> 33) / float(1 << 31)) - 1.0
        yield return_value


def interior_joints(skeleton):
    return [
        j["name"]
        for j in skeleton.joints
        if skeleton.primary_child(j["name"]) is not None
    ]


class RetargetTest(unittest.TestCase):
    @staticmethod
    def chain_skeleton():
        with open(ROOT / "maps" / "humanoid.json", "r", encoding="utf-8") as handle:
            joints = json.load(handle)["joints"]
        keep = {"root", "spine", "chest", "neck", "head"}
        return Skeleton([j for j in joints if j["name"] in keep])

    def test_chain_position_round_trip_is_exact(self):
        skel = self.chain_skeleton()
        rand = lcg(42)
        interior = set(interior_joints(skel))
        frames = [
            [
                (
                    [next(rand) * 28.0, next(rand) * 28.0, next(rand) * 28.0]
                    if j["name"] in interior
                    else [0.0, 0.0, 0.0]
                )
                for j in skel.joints
            ]
            for _ in range(6)
        ]
        world = fk_positions(skel, frames)
        solved = solve_local_rotations(skel, world)
        rebuilt = fk_positions(skel, solved)
        worst = max(
            math.sqrt(sum((a - b) ** 2 for a, b in zip(pa, pb)))
            for fa, fb in zip(world, rebuilt)
            for pa, pb in zip(fa, fb)
        )
        self.assertLess(worst, 1e-6, f"chain round-trip error {worst}")

    def test_branching_rig_round_trip_stays_bounded(self):
        skel = load_humanoid()
        rand = lcg(42)
        interior = set(interior_joints(skel))
        frames = []
        for _ in range(6):
            row = []
            for j in skel.joints:
                if j["name"] in interior:
                    row.append([next(rand) * 25.0, next(rand) * 25.0, next(rand) * 25.0])
                else:
                    row.append([0.0, 0.0, 0.0])
            frames.append(row)

        world = fk_positions(skel, frames)
        solved = solve_local_rotations(skel, world)
        rebuilt = fk_positions(skel, solved)

        worst = max(
            math.sqrt(sum((a - b) ** 2 for a, b in zip(pa, pb)))
            for fa, fb in zip(world, rebuilt)
            for pa, pb in zip(fa, fb)
        )
        # Branching joints (root: spine+thighs, chest: neck+arms) cannot be
        # satisfied by single-child steering when descendants rotate; positional
        # retargeting is the fallback path, not the ARDY primary path (the npz
        # carries global rotations which will drive exact retargeting).
        self.assertLess(worst, 0.22, f"branch-coupled drift {worst}")

    def test_terminal_joints_emit_identity(self):
        skel = load_humanoid()
        rand = lcg(7)
        interior = set(interior_joints(skel))
        frames = [
            [
                (
                    [next(rand) * 20.0, next(rand) * 20.0, next(rand) * 20.0]
                    if j["name"] in interior
                    else [0.0, 0.0, 0.0]
                )
                for j in skel.joints
            ]
            for _ in range(3)
        ]
        world = fk_positions(skel, frames)
        solved = solve_local_rotations(skel, world)
        terminal = {"handL", "handR", "footL", "footR", "head"}
        for row in solved:
            for j, angles in zip(skel.joints, row):
                if j["name"] in terminal:
                    self.assertEqual(angles, [0.0, 0.0, 0.0])

    def test_euler_mat_inverse_round_trip(self):
        rand = lcg(99)
        for _ in range(200):
            rx, ry, rz = next(rand) * 170, next(rand) * 89, next(rand) * 170
            m = euler_xyz_deg_to_mat(rx, ry, rz)
            back = mat_to_euler_xyz_deg(m)
            m2 = euler_xyz_deg_to_mat(*back)
            for i in range(3):
                for j in range(3):
                    self.assertAlmostEqual(m[i][j], m2[i][j], places=5)

    def test_rotation_from_to_maps_directions(self):
        cases = [
            ([0, 1, 0], [1, 0, 0]),
            ([1, 0, 0], [0, 0, 1]),
            ([0, -1, 0], [0, 0.7071067811865476, 0.7071067811865476]),
        ]
        for src, dst in cases:
            r = rotation_from_to(src, dst)
            out = [sum(r[i][k] * src[k] for k in range(3)) for i in range(3)]
            for a, b in zip(out, dst):
                self.assertAlmostEqual(a, b, places=6)


if __name__ == "__main__":
    unittest.main()
