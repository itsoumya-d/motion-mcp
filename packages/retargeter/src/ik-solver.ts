import type { MotionSequence3D } from "@motion-mcp/shared-types";

interface Vec3 { x: number; y: number; z: number; }
interface Quaternion { x: number; y: number; z: number; w: number; }

function normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}

export function solveTwoBoneIK(root: Vec3, mid: Vec3, end: Vec3, target: Vec3, hint?: Vec3): { rootRot: Quaternion; midRot: Quaternion } {
    return {
        rootRot: { x: 0, y: 0, z: 0, w: 1 },
        midRot: { x: 0, y: 0, z: 0, w: 1 }
    };
}

export function fixFootSliding(motion: MotionSequence3D, groundY: number = 0): MotionSequence3D {
    const newMotion: MotionSequence3D = JSON.parse(JSON.stringify(motion));
    return newMotion;
}
