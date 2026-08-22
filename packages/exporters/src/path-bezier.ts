/**
 * SVG path `d` → Lottie bezier converter.
 *
 * Supports the full command set: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z.
 * Quadratics are elevated to cubics; arcs use proper endpoint
 * parameterization (W3C SVG Appendix F.6) split into ≤90° cubic segments.
 *
 * Output follows the Lottie shape convention per subpath:
 *   v = absolute vertices, o/i = out/in tangents relative to each vertex.
 */

export interface BezierSubPath {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}

interface Token {
  cmd?: string;
  num?: number;
}

function tokenize(d: string): Token[] {
  const tokens: Token[] = [];
  const regex = /([A-Za-z])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(d))) {
    if (match[1]) tokens.push({ cmd: match[1] });
    else if (match[2]) tokens.push({ num: Number.parseFloat(match[2]) });
  }
  return tokens;
}

const KAPPA = 0.5522847498307936;

export function pathToBezier(d: string): BezierSubPath[] {
  const tokens = tokenize(d);
  const subpaths: BezierSubPath[] = [];
  const state: { current: BezierSubPath | null } = { current: null };

  const newSubpath = (): BezierSubPath => ({ c: false, v: [], i: [], o: [] });

  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevC2x = 0;
  let prevC2y = 0;
  let prevQx = 0;
  let prevQy = 0;
  let prevCmd = "";

  const flush = () => {
    const open = state.current;
    if (open && open.v.length > 1) subpaths.push(open);
    state.current = null;
  };
  const cur = (): BezierSubPath => {
    if (!state.current) state.current = newSubpath();
    return state.current;
  };
  const begin = (x: number, y: number) => {
    // v/i/o stay index-aligned from the very first vertex.
    state.current = { c: false, v: [[x, y]], i: [[0, 0]], o: [[0, 0]] };
    cx = x;
    cy = y;
    sx = x;
    sy = y;
  };
  const lineTo = (x: number, y: number) => {
    const target = cur();
    target.v.push([x, y]);
    target.i.push([0, 0]);
    target.o.push([0, 0]);
    cx = x;
    cy = y;
  };
  const curveTo = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    const target = cur();
    // out tangent of the previous vertex becomes the first control point
    target.o[target.o.length - 1] = [c1x - cx, c1y - cy];
    target.v.push([x, y]);
    target.i.push([c2x - x, c2y - y]);
    target.o.push([0, 0]);
    prevC2x = c2x;
    prevC2y = c2y;
    cx = x;
    cy = y;
  };

  let idx = 0;
  const nextNum = (): number => tokens[idx++]?.num ?? 0;
  const peekCmd = (): string | undefined => tokens[idx]?.cmd;

  while (idx < tokens.length) {
    let cmd = tokens[idx].cmd;
    if (cmd) idx += 1;
    else cmd = prevCmd; // implicit repetition for polybezier forms
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();

    switch (up) {
      case "M": {
        const x = nextNum() + (rel ? cx : 0);
        const y = nextNum() + (rel ? cy : 0);
        flush();
        begin(x, y);
        prevCmd = rel ? "l" : "L"; // subsequent pairs are lineto
        continue;
      }
      case "L": {
        lineTo(nextNum() + (rel ? cx : 0), nextNum() + (rel ? cy : 0));
        break;
      }
      case "H": {
        lineTo(nextNum() + (rel ? cx : 0), cy);
        break;
      }
      case "V": {
        lineTo(cx, nextNum() + (rel ? cy : 0));
        break;
      }
      case "C": {
        const x1 = nextNum() + (rel ? cx : 0);
        const y1 = nextNum() + (rel ? cy : 0);
        const x2 = nextNum() + (rel ? cx : 0);
        const y2 = nextNum() + (rel ? cy : 0);
        const x = nextNum() + (rel ? cx : 0);
        const y = nextNum() + (rel ? cy : 0);
        curveTo(x1, y1, x2, y2, x, y);
        break;
      }
      case "S": {
        const reflectedX = prevCmdMatch(prevCmd, "CS") ? 2 * cx - prevC2x : cx;
        const reflectedY = prevCmdMatch(prevCmd, "CS") ? 2 * cy - prevC2y : cy;
        const x2 = nextNum() + (rel ? cx : 0);
        const y2 = nextNum() + (rel ? cy : 0);
        const x = nextNum() + (rel ? cx : 0);
        const y = nextNum() + (rel ? cy : 0);
        curveTo(reflectedX, reflectedY, x2, y2, x, y);
        break;
      }
      case "Q": {
        const qx = nextNum() + (rel ? cx : 0);
        const qy = nextNum() + (rel ? cy : 0);
        const x = nextNum() + (rel ? cx : 0);
        const y = nextNum() + (rel ? cy : 0);
        quadTo(qx, qy, x, y);
        prevQx = qx;
        prevQy = qy;
        break;
      }
      case "T": {
        const qx = prevCmdMatch(prevCmd, "QT") ? 2 * cx - prevQx : cx;
        const qy = prevCmdMatch(prevCmd, "QT") ? 2 * cy - prevQy : cy;
        const x = nextNum() + (rel ? cx : 0);
        const y = nextNum() + (rel ? cy : 0);
        quadTo(qx, qy, x, y);
        prevQx = qx;
        prevQy = qy;
        break;
      }
      case "A": {
        const rx = nextNum();
        const ry = nextNum();
        const rotationDeg = nextNum();
        const largeArc = nextNum();
        const sweep = nextNum();
        const x = nextNum() + (rel ? cx : 0);
        const y = nextNum() + (rel ? cy : 0);
        for (const segment of arcToCubics(cx, cy, rx, ry, rotationDeg, largeArc !== 0, sweep !== 0, x, y)) {
          curveTo(segment.c1[0], segment.c1[1], segment.c2[0], segment.c2[1], segment.end[0], segment.end[1]);
        }
        if (peekCmd() !== "A") prevCmd = "";
        break;
      }
      case "Z": {
        const open = state.current;
        if (open !== null && open.v.length > 0) {
          lineTo(sx, sy);
          open.c = true;
        }
        flush();
        break;
      }
      default:
        // Unknown command — skip its numeric arguments conservatively.
        idx += 1;
        break;
    }

    prevCmd = cmd;
    void up;
  }
  flush();
  return subpaths;

  function quadTo(qx: number, qy: number, x: number, y: number): void {
    // Quadratic → cubic elevation
    const c1x = cx + (2 / 3) * (qx - cx);
    const c1y = cy + (2 / 3) * (qy - cy);
    const c2x = x + (2 / 3) * (qx - x);
    const c2y = y + (2 / 3) * (qy - y);
    curveTo(c1x, c1y, c2x, c2y, x, y);
  }
}

function prevCmdMatch(prev: string, set: string): boolean {
  return set.includes(prev.toUpperCase());
}

interface CubicSegment {
  c1: [number, number];
  c2: [number, number];
  end: [number, number];
}

/** Endpoint parameterization of an elliptical arc into ≤90° cubics. */
export function arcToCubics(
  x1: number,
  y1: number,
  rxRaw: number,
  ryRaw: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): CubicSegment[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxRaw);
  let ry = Math.abs(ryRaw);
  if (rx === 0 || ry === 0) return [{ c1: [x1, y1], c2: [x2, y2], end: [x2, y2] }];

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // F.6.6 correction of out-of-range radii
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // F.6.5 center computation
  const sign = largeArc !== sweep ? 1 : -1;
  const rx1 = rx * rx;
  const ry1 = ry * ry;
  const px = (rx1 * y1p * y1p + ry1 * x1p * x1p);
  const denom = px === 0 ? 1e-12 : rx1 * ry1 - px;
  const co = Math.sqrt(Math.max(0, (rx1 * ry1 - rx1 * y1p * y1p - ry1 * x1p * x1p) / (rx1 * y1p * y1p + ry1 * x1p * x1p)));
  const cxp = sign * co * ((rx * y1p) / ry);
  const cyp = sign * -co * ((ry * x1p) / rx);
  void denom;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const clamped = Math.min(Math.max(dot / (len || 1), -1), 1);
    let a = Math.acos(clamped);
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / segments;
  const t = (4 / 3) * Math.tan(step / 4);

  const pointAt = (theta: number): [number, number] => [
    cosPhi * rx * Math.cos(theta) - sinPhi * ry * Math.sin(theta) + cx,
    sinPhi * rx * Math.cos(theta) + cosPhi * ry * Math.sin(theta) + cy
  ];
  const derivativeAt = (theta: number): [number, number] => [
    -cosPhi * rx * Math.sin(theta) - sinPhi * ry * Math.cos(theta),
    -sinPhi * rx * Math.cos(theta) + cosPhi * ry * Math.sin(theta)
  ];

  const out: CubicSegment[] = [];
  let theta = theta1;
  let start: [number, number] = [x1, y1];
  for (let index = 0; index < segments; index += 1) {
    const nextTheta = theta + step;
    const end = index === segments - 1 ? ([x2, y2] as [number, number]) : pointAt(nextTheta);
    const d1 = derivativeAt(theta);
    const d2 = derivativeAt(nextTheta);
    out.push({
      c1: [start[0] + t * d1[0], start[1] + t * d1[1]],
      c2: [end[0] - t * d2[0], end[1] - t * d2[1]],
      end
    });
    start = end;
    theta = nextTheta;
  }
  return out;
}
