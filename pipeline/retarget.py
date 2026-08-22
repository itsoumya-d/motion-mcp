"""Retarget world-space joint positions into hierarchical Euler XYZ rotations.

Given per-frame joint positions (the shape of ARDY's posed_joints) and a rest
skeleton, solve each joint's local Euler XYZ rotation so its primary child
bone points at the observed child position.

Honest limitation: twist around a bone's own axis is unobservable when that
bone has a single child whose position we track through interior chains —
interior twists ARE recovered implicitly because they move descendants — but
terminal bones (hands, feet, head) have nothing left to point anywhere and are
emitted as identity. Positional round-trips remain exact; refined rotations can
later blend ARDY's global-rotation outputs.

Pure stdlib: batch sizes are tiny (17 joints x ~500 frames).
"""

import math

DEG = math.pi / 180.0

# ---------- vec3 / mat3 ----------

def v_sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def v_add(a, b): return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
def v_dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def v_cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

def v_norm(a):
    n = math.sqrt(v_dot(a, a))
    if n < 1e-12:
        return None
    return [a[0] / n, a[1] / n, a[2] / n]

def m_identity():
    return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]

def m_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

def m_transpose(a):
    return [[a[j][i] for j in range(3)] for i in range(3)]

def m_vec(a, v):
    return [sum(a[i][k] * v[k] for k in range(3)) for i in range(3)]

def euler_xyz_deg_to_mat(rx, ry, rz):
    cx, sx = math.cos(rx * DEG), math.sin(rx * DEG)
    cy, sy = math.cos(ry * DEG), math.sin(ry * DEG)
    cz, sz = math.cos(rz * DEG), math.sin(rz * DEG)
    mx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    my = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    mz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return m_mul(m_mul(mx, my), mz)

def mat_to_euler_xyz_deg(m):
    sy = max(-1.0, min(1.0, m[0][2]))
    ry = math.asin(sy)
    if abs(sy) < 0.99999:
        rx = math.atan2(-m[1][2], m[2][2])
        rz = math.atan2(-m[0][1], m[0][0])
    else:
        rx = math.atan2(m[1][0], m[1][1])
        rz = 0.0
    return [rx / DEG, ry / DEG, rz / DEG]

def rotation_from_to(src, dst):
    """Minimal rotation taking unit vector src onto unit vector dst (Rodrigues)."""
    s = v_norm(src)
    d = v_norm(dst)
    if s is None or d is None:
        return m_identity()
    c = max(-1.0, min(1.0, v_dot(s, d)))
    if c > 0.9999995:
        return m_identity()
    if c < -0.9999995:
        axis = v_norm(v_cross(s, [1.0, 0.0, 0.0]))
        if axis is None:
            axis = v_norm(v_cross(s, [0.0, 1.0, 0.0])) or [0.0, 0.0, 1.0]
        ang = math.pi
    else:
        axis = v_norm(v_cross(s, d))
        if axis is None:
            return m_identity()
        ang = math.acos(c)
    kx, ky, kz = axis
    kc = [[0.0, -kz, ky], [kz, 0.0, -kx], [-ky, kx, 0.0]]
    kcsq = m_mul(kc, kc)
    sin_a = math.sin(ang)
    cos_a = math.cos(ang)
    return [
        [
            (1.0 if i == j else 0.0) + sin_a * kc[i][j] + (1.0 - cos_a) * kcsq[i][j]
            for j in range(3)
        ]
        for i in range(3)
    ]

# ---------- skeleton ----------

class Skeleton:
    """Ordered joints (parents before children) with parent-relative rest offsets."""

    def __init__(self, joints):
        self.joints = joints
        self.index = {j["name"]: i for i, j in enumerate(joints)}
        self.children = {j["name"]: [] for j in joints}
        for j in joints:
            if j["parent"]:
                self.children[j["parent"]].append(j["name"])
        self.rest_world = self._fk_zero()

    def primary_child(self, name):
        kids = self.children[name]
        return kids[0] if kids else None

    def _fk_zero(self):
        pos = {}
        order = []
        for j in self.joints:
            if j["parent"] is None:
                pos[j["name"]] = list(j["offset"])
            else:
                pos[j["name"]] = v_add(pos[j["parent"]], j["offset"])
            order.append(pos[j["name"]])
        return order

# ---------- forward kinematics ----------

def fk_positions(skeleton, local_euler_frames):
    """[T][J][rx,ry,rz degrees] -> world positions [T][J][3]."""
    out = []
    for frame in local_euler_frames:
        world_m = {}
        world_p = {}
        positions = []
        for j in skeleton.joints:
            idx = skeleton.index[j["name"]]
            local_r = euler_xyz_deg_to_mat(*frame[idx])
            if j["parent"] is None:
                world_m[j["name"]] = local_r
                world_p[j["name"]] = list(j["offset"])
            else:
                parent_m = world_m[j["parent"]]
                world_m[j["name"]] = m_mul(parent_m, local_r)
                world_p[j["name"]] = v_add(
                    world_p[j["parent"]],
                    m_vec(parent_m, j["offset"]),
                )
            positions.append(world_p[j["name"]])
        out.append(positions)
    return out

# ---------- inverse (positional retarget) ----------

def solve_local_rotations(skeleton, world_frames):
    """[T][J][3] world positions -> [T][J][rx,ry,rz] local euler degrees.

    Walk parents-first. For each joint, find the minimal additional world-space
    rotation A steering the parent-oriented rest bone direction onto the
    observed one; the joint's world orientation becomes A . R_parent and its
    local rotation is extracted via the similarity transform R_parent^T . A .
    R_parent. Terminal joints emit identity."""
    solved = []
    for frame in world_frames:
        world_r = {}
        locals_row = []
        for j in skeleton.joints:
            name = j["name"]
            parent = j["parent"]
            parent_r = world_r.get(parent, m_identity()) if parent else m_identity()
            child = skeleton.primary_child(name)
            if child is None:
                world_r[name] = parent_r
                locals_row.append([0.0, 0.0, 0.0])
                continue
            ci = skeleton.index[child]
            ji = skeleton.index[name]
            rest_dir = v_sub(skeleton.rest_world[ci], skeleton.rest_world[ji])
            obs_dir = v_sub(frame[ci], frame[ji])
            steer = rotation_from_to(
                m_vec(parent_r, rest_dir),
                obs_dir,
            )
            world = m_mul(steer, parent_r)
            world_r[name] = world
            r_local = m_mul(m_transpose(parent_r), m_mul(steer, parent_r))
            locals_row.append(mat_to_euler_xyz_deg(r_local))
        solved.append(locals_row)
    return solved
