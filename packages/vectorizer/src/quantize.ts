export interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

export interface QuantizeResult {
  width: number;
  height: number;
  /** Per-pixel palette index; 255 marks transparent pixels. */
  indices: Uint8Array;
  palette: PaletteColor[];
}

interface SampleBox {
  samples: Array<{ r: number; g: number; b: number }>;
}

const TRANSPARENT_INDEX = 255;
const MAX_SAMPLES = 20000;

function channelRange(samples: SampleBox["samples"]): { axis: 0 | 1 | 2; range: number } {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const sample of samples) {
    if (sample.r < rMin) rMin = sample.r;
    if (sample.r > rMax) rMax = sample.r;
    if (sample.g < gMin) gMin = sample.g;
    if (sample.g > gMax) gMax = sample.g;
    if (sample.b < bMin) bMin = sample.b;
    if (sample.b > bMax) bMax = sample.b;
  }
  const ranges: [number, 0 | 1 | 2][] = [
    [rMax - rMin, 0],
    [gMax - gMin, 1],
    [bMax - bMin, 2]
  ];
  ranges.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return { axis: ranges[0]![1], range: ranges[0]![0] };
}

function boxAverage(samples: SampleBox["samples"]): PaletteColor {
  let r = 0, g = 0, b = 0;
  for (const sample of samples) {
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  const count = Math.max(samples.length, 1);
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };
}

/**
 * Deterministic median-cut quantization. Sampling, box splitting, and
 * nearest-color mapping are all stable: identical input yields identical
 * palettes and indices.
 */
export function quantizeFrame(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number
): QuantizeResult {
  const pixelCount = width * height;
  const indices = new Uint8Array(pixelCount).fill(TRANSPARENT_INDEX);

  const stride = Math.max(1, Math.floor(Math.sqrt(pixelCount / MAX_SAMPLES)));
  const samples: SampleBox["samples"] = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      if (rgba[offset + 3]! < 128) continue;
      samples.push({ r: rgba[offset]!, g: rgba[offset + 1]!, b: rgba[offset + 2]! });
    }
  }
  if (samples.length === 0) {
    return { width, height, indices, palette: [] };
  }

  // Median cut: always split the box with the widest channel spread,
  // ties broken by box order so the process is deterministic.
  let boxes: SampleBox[] = [{ samples }];
  while (boxes.length < maxColors) {
    let bestIndex = -1;
    let bestRange = 0;
    let bestAxis: 0 | 1 | 2 = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index]!;
      if (box.samples.length < 2) continue;
      const { axis, range } = channelRange(box.samples);
      if (range > bestRange) {
        bestRange = range;
        bestIndex = index;
        bestAxis = axis;
      }
    }
    if (bestIndex < 0 || bestRange === 0) break;

    const target = boxes[bestIndex]!;
    const keyOf = (sample: { r: number; g: number; b: number }) =>
      bestAxis === 0 ? sample.r : bestAxis === 1 ? sample.g : sample.b;
    const sortedValues = target.samples.map(keyOf).sort((a, b) => a - b);
    const median = sortedValues[Math.floor(sortedValues.length / 2)]!;
    const left: SampleBox["samples"] = [];
    const right: SampleBox["samples"] = [];
    for (const sample of target.samples) {
      (keyOf(sample) < median ? left : right).push(sample);
    }
    if (left.length === 0 || right.length === 0) break;
    boxes = [
      ...boxes.slice(0, bestIndex),
      { samples: left },
      { samples: right },
      ...boxes.slice(bestIndex + 1)
    ];
  }

  const palette = boxes
    .filter((box) => box.samples.length > 0)
    .map((box) => boxAverage(box.samples));

  // Nearest-color mapping over every opaque pixel.
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    if (rgba[offset + 3]! < 128) continue;
    const r = rgba[offset]!, g = rgba[offset + 1]!, b = rgba[offset + 2]!;
    let bestIndex = 0;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (let entry = 0; entry < palette.length; entry += 1) {
      const color = palette[entry]!;
      const dr = r - color.r;
      const dg = g - color.g;
      const db = b - color.b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = entry;
      }
    }
    indices[pixel] = bestIndex;
  }

  return { width, height, indices, palette };
}

export function colorToHex(color: PaletteColor): string {
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}
