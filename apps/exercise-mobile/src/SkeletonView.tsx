import React, { useMemo } from "react";
import Svg, { Circle, Ellipse, Line } from "react-native-svg";
import { HUMANOID, worldJointPositions } from "@motion-mcp/motion-runtime";
import type { PoseSample } from "@motion-mcp/motion-runtime";

const BONES: Array<[string, string]> = [
  ["root", "spine"],
  ["spine", "chest"],
  ["chest", "neck"],
  ["neck", "head"],
  ["chest", "upperArmL"],
  ["upperArmL", "forearmL"],
  ["forearmL", "handL"],
  ["chest", "upperArmR"],
  ["upperArmR", "forearmR"],
  ["forearmR", "handR"],
  ["root", "thighL"],
  ["thighL", "shinL"],
  ["shinL", "footL"],
  ["root", "thighR"],
  ["thighR", "shinR"],
  ["shinR", "footR"]
];

const YAW = (22 * Math.PI) / 180;

interface Projected {
  [joint: string]: { x: number; y: number; s: number };
}

function project(sample: PoseSample | null, width: number, height: number): Projected {
  const world = worldJointPositions(
    HUMANOID,
    sample ?? { timeMs: 0, clipId: "rest", rotations: {}, translations: {} }
  );
  const scale = Math.min(width, height) / 2.55;
  const cx = width / 2;
  const groundY = height * 0.84;
  const out: Projected = {};
  for (const joint of HUMANOID.joints) {
    const p = world[joint.name]!;
    const rx = p[0] * Math.cos(YAW) + p[2] * Math.sin(YAW);
    const rz = -p[0] * Math.sin(YAW) + p[2] * Math.cos(YAW);
    const depth = 1 / (1 + rz * 0.3);
    out[joint.name] = {
      x: cx + rx * scale * depth,
      y: groundY - p[1] * scale * depth,
      s: depth
    };
  }
  return out;
}

export function SkeletonView({
  sample,
  width,
  height
}: {
  sample: PoseSample | null;
  width: number;
  height: number;
}): React.JSX.Element {
  const points = useMemo(() => project(sample, width, height), [sample, width, height]);
  return (
    <Svg width={width} height={height}>
      <Ellipse
        cx={points.root?.x ?? width / 2}
        cy={height * 0.86}
        rx={44}
        ry={7}
        fill="#000000"
        opacity={0.35}
      />
      {BONES.map(([from, to]) => {
        const a = points[from];
        const b = points[to];
        if (!a || !b) return null;
        return (
          <Line
            key={`${from}-${to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#8aa2b8"
            strokeWidth={6 * ((a.s + b.s) / 2)}
            strokeLinecap="round"
          />
        );
      })}
      {(["handL", "handR", "footL", "footR"] as const).map((name) => {
        const p = points[name];
        if (!p) return null;
        return <Circle key={name} cx={p.x} cy={p.y} r={5 * p.s} fill="#e8b04b" />;
      })}
      <Circle cx={points.head?.x} cy={points.head?.y - 4} r={11 * (points.head?.s ?? 1)} fill="#e8b04b" />
    </Svg>
  );
}
