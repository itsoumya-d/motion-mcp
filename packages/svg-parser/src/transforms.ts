/**
 * Minimal affine 2D transform utilities for SVG parsing.
 * Matrices are [a, b, c, d, e, f] matching SVG matrix(...) notation.
 */

export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0]! * b[0]! + a[2]! * b[1]!,
    a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!,
    a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
    a[1]! * b[4]! + a[3]! * b[5]! + a[5]!
  ];
}

function numbers(source: string): number[] {
  return (source.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Parses an SVG `transform` attribute value into one composed matrix. */
export function transformToMatrix(source: string | undefined): Matrix {
  if (!source) return IDENTITY;
  let result: Matrix = IDENTITY;
  const opRegex = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = opRegex.exec(source))) {
    const op = match[1]!;
    const args = numbers(match[2] ?? "");
    switch (op) {
      case "matrix": {
        if (args.length >= 6) {
          result = multiply(result, [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]);
        }
        break;
      }
      case "translate": {
        const tx = args[0] ?? 0;
        const ty = args[1] ?? 0;
        result = multiply(result, [1, 0, 0, 1, tx, ty]);
        break;
      }
      case "scale": {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        result = multiply(result, [sx, 0, 0, sy, 0, 0]);
        break;
      }
      case "rotate": {
        const angle = degToRad(args[0] ?? 0);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          const cx = args[1]!;
          const cy = args[2]!;
          result = multiply(result, multiply(multiply([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]));
        } else {
          result = multiply(result, rotation);
        }
        break;
      }
      case "skewX": {
        result = multiply(result, [1, 0, Math.tan(degToRad(args[0] ?? 0)), 1, 0, 0]);
        break;
      }
      case "skewY": {
        result = multiply(result, [1, Math.tan(degToRad(args[0] ?? 0)), 0, 1, 0, 0]);
        break;
      }
      default:
        break;
    }
  }
  return result;
}

/** Applies a matrix to an [x, y] point. */
export function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
  return [
    matrix[0]! * x + matrix[2]! * y + matrix[4]!,
    matrix[1]! * x + matrix[3]! * y + matrix[5]!
  ];
}
