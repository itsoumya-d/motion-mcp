export interface Point {
  x: number;
  y: number;
}

/** Directed unit edge between pixel corners. */
interface Edge { ax: number; ay: number; bx: number; by: number }

export interface Contour {
  /** Palette index this contour encloses. */
  colorIndex: number;
  /** Closed loop of integer corner points (screen coordinates, y down). */
  points: Point[];
}

/**
 * Traces closed boundary loops for one color mask using directed unit edges
 * along pixel borders. Outer boundaries wind clockwise and holes counter-
 * clockwise, so nonzero fill renders regions with holes correctly.
 * Deterministic: identical masks yield identical loops.
 */
export function traceColorMask(
  mask: Uint8Array,
  width: number,
  height: number
): Point[][] {
  const at = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  // Directed edge from corner a to corner b.
  const outgoing = new Map<string, Edge[]>();
  const addEdge = (edge: Edge) => {
    const key = `${edge.ax},${edge.ay}`;
    const list = outgoing.get(key) ?? [];
    list.push(edge);
    outgoing.set(key, list);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) addEdge({ ax: x, ay: y, bx: x + 1, by: y });
      if (!at(x + 1, y)) addEdge({ ax: x + 1, ay: y, bx: x + 1, by: y + 1 });
      if (!at(x, y + 1)) addEdge({ ax: x + 1, ay: y + 1, bx: x, by: y + 1 });
      if (!at(x - 1, y)) addEdge({ ax: x, ay: y + 1, bx: x, by: y });
    }
  }

  const loops: Point[][] = [];
  const startKeys = Array.from(outgoing.keys()).sort();
  for (const startKey of startKeys) {
    while ((outgoing.get(startKey)?.length ?? 0) > 0) {
      const first = outgoing.get(startKey)!.shift()!;
      const loop: Point[] = [{ x: first.ax, y: first.ay }];
      let current = first;
      let guard = 0;
      while (guard++ < width * height * 4 + 8) {
        loop.push({ x: current.bx, y: current.by });
        if (current.bx === first.ax && current.by === first.ay) break;
        const candidates = outgoing.get(`${current.bx},${current.by}`);
        if (!candidates || candidates.length === 0) break;
        // Prefer the most-clockwise continuation so adjacent same-color
        // pixels merge into one loop instead of zig-zagging.
        candidates.sort((a, b) => turnPreference(current, a) - turnPreference(current, b));
        current = candidates.shift()!;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function turnPreference(from: Edge, candidate: Edge): number {
  const inDx = from.bx - from.ax;
  const inDy = from.by - from.ay;
  const outDx = candidate.bx - candidate.ax;
  const outDy = candidate.by - candidate.ay;
  // Cross product: negative = clockwise turn (preferred), zero = straight,
  // positive = counter-clockwise (last resort).
  return Math.sign(inDx * outDy - inDy * outDx);
}

/**
 * Ramer–Douglas–Peucker simplification for a closed loop (anchor-based).
 */
export function simplifyLoop(points: Point[], epsilon: number): Point[] {
  if (points.length <= 4 || epsilon <= 0) return points;
  const anchor = points[0]!;
  const open = [...points.slice(1), anchor];
  const kept = rdp(open, epsilon);
  const result: Point[] = [anchor, ...kept.slice(0, -1)];
  return result.length >= 3 ? result : points;
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  let maxDistance = -1;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointToSegmentDistance(points[index]!, start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= epsilon) {
    return [start, end];
  }
  const left = rdp(points.slice(0, maxIndex + 1), epsilon);
  const right = rdp(points.slice(maxIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
