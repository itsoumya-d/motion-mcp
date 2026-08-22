/**
 * GIF89a encoder tuned for flat vector motion: global palette built from
 * exact colors when possible (typical for SVG renders), popularity-bucketed
 * quantization otherwise, variable-width LZW compression, and NETSCAPE
 * looping so animations replay everywhere.
 */

export interface GifFrameInput {
  /** RGBA pixels, 4 bytes per pixel, width*height long. */
  rgba: Uint8Array;
  width: number;
  height: number;
  delayMs: number;
}

const MAX_COLORS = 256;

export function encodeGif(frames: GifFrameInput[]): Uint8Array {
  if (frames.length === 0) throw new Error("encodeGif needs at least one frame");
  const { width, height } = frames[0]!;

  const { palette, indexOf } = buildPalette(frames);
  const paletteBits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const paletteSize = 1 << paletteBits;
  const minCodeSize = Math.max(2, paletteBits);

  const out: number[] = [];
  pushText(out, "GIF89a");

  // Logical Screen Descriptor
  pushU16(out, width);
  pushU16(out, height);
  out.push(0x80 | ((paletteBits - 1) & 0x07)); // GCT present, size bits
  out.push(0x00); // background color index
  out.push(0x00); // pixel aspect ratio

  // Global Color Table
  for (let index = 0; index < paletteSize; index += 1) {
    const entry = palette[index];
    if (entry) {
      out.push(entry[0], entry[1], entry[2]);
    } else {
      out.push(0, 0, 0);
    }
  }

  // NETSCAPE looping extension (infinite loop)
  out.push(0x21, 0xff, 0x0b);
  pushText(out, "NETSCAPE2.0");
  out.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const frame of frames) {
    const indices = quantizeToIndices(frame.rgba, indexOf);
    const delayCentis = Math.max(2, Math.round(frame.delayMs / 10));

    // Graphic Control Extension
    out.push(0x21, 0xf9, 0x04, 0x04); // disposal = "do not dispose" << 2
    pushU16(out, delayCentis);
    out.push(0x00, 0x00);

    // Image Descriptor
    out.push(0x2c);
    pushU16(out, 0); // left
    pushU16(out, 0); // top
    pushU16(out, frame.width);
    pushU16(out, frame.height);
    out.push(0x00); // no local color table, not interlaced

    out.push(minCodeSize);
    const lzw = lzwEncode(indices, minCodeSize);
    for (let offset = 0; offset < lzw.length; offset += 255) {
      const block = lzw.subarray(offset, Math.min(offset + 255, lzw.length));
      out.push(block.length, ...block);
    }
    out.push(0x00); // end of image data
  }

  out.push(0x3b); // trailer
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

function buildPalette(frames: GifFrameInput[]): {
  palette: Rgb[];
  indexOf: (rgba: Uint8Array, pixelIndex: number) => number;
} {
  const exact = new Map<number, Rgb>();
  let overflow = false;
  outer: for (const frame of frames) {
    for (let pixel = 0; pixel < frame.rgba.length; pixel += 4) {
      const r = frame.rgba[pixel]!;
      const g = frame.rgba[pixel + 1]!;
      const b = frame.rgba[pixel + 2]!;
      const a = frame.rgba[pixel + 3]!;
      const key = colorKey(r, g, b, a);
      if (!exact.has(key)) {
        exact.set(key, flatten(r, g, b, a));
        if (exact.size > MAX_COLORS) {
          overflow = true;
          break outer;
        }
      }
    }
  }

  if (!overflow) {
    const palette: Rgb[] = [...exact.values()];
    const lookup = new Map<number, number>();
    let index = 0;
    for (const [key] of exact) lookup.set(key, index++);
    return {
      palette,
      indexOf: (rgba, pixel) => {
        const key = colorKey(
          rgba[pixel]!,
          rgba[pixel + 1]!,
          rgba[pixel + 2]!,
          rgba[pixel + 3]!
        );
        return lookup.get(key) ?? 0;
      }
    };
  }

  // Popularity buckets at decreasing bit depths until we fit.
  for (const bits of [5, 4, 3, 2]) {
    const counts = new Map<number, number>();
    for (const frame of frames) {
      for (let pixel = 0; pixel < frame.rgba.length; pixel += 4) {
        const key = bucketKey(frame.rgba, pixel, bits);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    if (counts.size > MAX_COLORS) continue;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLORS);
    const palette: Rgb[] = top.map(([key]) => unbucket(key, bits));
    const lookup = new Map(top.map(([key], index) => [key, index]));
    const shift = 8 - bits;
    return {
      palette,
      indexOf: (rgba, pixel) => {
        const key = bucketKey(rgba, pixel, bits);
        return lookup.get(key) ?? 0;
      },
      ...(shift ? {} : {})
    };
  }
  throw new Error("unable to quantize below 256 colors");
}

function colorKey(r: number, g: number, b: number, a: number): number {
  // Flatten alpha over white inside the key so semi-transparent AA edges dedupe.
  const fr = Math.round(r * (a / 255) + 255 * (1 - a / 255));
  const fg = Math.round(g * (a / 255) + 255 * (1 - a / 255));
  const fb = Math.round(b * (a / 255) + 255 * (1 - a / 255));
  return (fr << 16) | (fg << 8) | fb;
}

function flatten(r: number, g: number, b: number, a: number): Rgb {
  return [
    Math.round(r * (a / 255) + 255 * (1 - a / 255)),
    Math.round(g * (a / 255) + 255 * (1 - a / 255)),
    Math.round(b * (a / 255) + 255 * (1 - a / 255))
  ];
}

function bucketKey(rgba: Uint8Array, pixel: number, bits: number): number {
  const shift = 8 - bits;
  const mask = (1 << bits) - 1;
  const r = ((rgba[pixel]! >> shift) & mask);
  const g = ((rgba[pixel + 1]! >> shift) & mask);
  const b = ((rgba[pixel + 2]! >> shift) & mask);
  return (r << (bits * 2)) | (g << bits) | b;
}

function unbucket(key: number, bits: number): Rgb {
  const shift = 8 - bits;
  const mask = (1 << bits) - 1;
  const restore = (value: number) => Math.min(255, (value << shift) + (1 << (shift - 1)) - 1);
  const b = key & mask;
  const g = (key >> bits) & mask;
  const r = (key >> (bits * 2)) & mask;
  return [restore(r), restore(g), restore(b)];
}

function quantizeToIndices(rgba: Uint8Array, indexOf: (rgba: Uint8Array, pixel: number) => number): Uint8Array {
  const indices = new Uint8Array(rgba.length / 4);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    indices[pixel] = indexOf(rgba, pixel * 4);
  }
  return indices;
}

// ---------------------------------------------------------------------------
// LZW (GIF variant, LSB-first packing, 12-bit code ceiling)
// ---------------------------------------------------------------------------

export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dictionary = new Map<number, number>();

  const writer = new BitWriter();
  writer.write(clearCode, codeSize);

  let prefix = -1;
  for (const pixel of indices) {
    if (prefix === -1) {
      prefix = pixel;
      continue;
    }
    const key = (prefix << 8) | pixel;
    const found = dictionary.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    writer.write(prefix, codeSize);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++);
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      writer.write(clearCode, codeSize);
      dictionary = new Map();
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
    }
    prefix = pixel;
  }
  if (prefix !== -1) writer.write(prefix, codeSize);
  writer.write(eoiCode, codeSize);
  return writer.bytes();
}

class BitWriter {
  private buffer: number[] = [];
  private current = 0;
  private bitsUsed = 0;

  write(code: number, size: number): void {
    for (let bit = 0; bit < size; bit += 1) {
      this.current |= ((code >> bit) & 1) << this.bitsUsed;
      this.bitsUsed += 1;
      if (this.bitsUsed === 8) {
        this.buffer.push(this.current);
        this.current = 0;
        this.bitsUsed = 0;
      }
    }
  }

  bytes(): Uint8Array {
    const result = this.buffer.slice();
    if (this.bitsUsed > 0) result.push(this.current);
    return Uint8Array.from(result);
  }
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function pushU16(target: number[], value: number): void {
  target.push(value & 0xff, (value >> 8) & 0xff);
}

function pushText(target: number[], text: string): void {
  for (const char of text) target.push(char.charCodeAt(0));
}
