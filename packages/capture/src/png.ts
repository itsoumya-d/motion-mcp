import { deflateSync, inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
}

/**
 * Minimal PNG decoder for what Chromium/resvg emit: 8-bit depth,
 * color types 6 (RGBA) and 2 (RGB), no interlace. Enough to turn
 * rasterized frames into raw pixels for the GIF encoder.
 */
export function decodePng(buffer: Uint8Array): DecodedPng {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (buffer[index] !== signature[index]) throw new Error("not a PNG (bad signature)");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];

  while (offset < buffer.length) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
    const length = view.getUint32(0, false);
    const type = String.fromCharCode(buffer[offset + 4]!, buffer[offset + 5]!, buffer[offset + 6]!, buffer[offset + 7]!);
    const dataStart = offset + 8;
    const chunk = buffer.subarray(dataStart, dataStart + length);
    if (type === "IHDR") {
      const header = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      width = header.getUint32(0, false);
      height = header.getUint32(4, false);
      // byte 8 = bit depth, byte 9 = color type
      if (chunk[8] !== 8) throw new Error(`unsupported bit depth ${chunk[8]}`);
      colorType = chunk[9]!;
      if (chunk[12] !== 0) throw new Error("interlaced PNGs are not supported");
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // skip CRC
  }

  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`unsupported color type ${colorType} (need RGBA or RGB)`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(concat(idat));
  const stride = width * channels;

  const rgba = new Uint8Array(width * height * 4);
  let previous: Uint8Array | null = null;
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor++]!;
    const row = inflated.subarray(cursor, cursor + stride);
    cursor += stride;
    const reconstructed = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = row[x]!;
      const left = x >= channels ? reconstructed[x - channels]! : 0;
      const up = previous ? previous[x]! : 0;
      const upperLeft = previous && x >= channels ? previous[x - channels]! : 0;
      switch (filter) {
        case 0: reconstructed[x] = raw; break;
        case 1: reconstructed[x] = (raw + left) & 0xff; break;
        case 2: reconstructed[x] = (raw + up) & 0xff; break;
        case 3: reconstructed[x] = (raw + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const prediction = paeth(left, up, upperLeft);
          reconstructed[x] = (raw + prediction) & 0xff;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
    }
    previous = reconstructed;
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels;
      const targetIndex = (y * width + x) * 4;
      rgba[targetIndex] = reconstructed[sourceIndex]!;
      rgba[targetIndex + 1] = reconstructed[sourceIndex + 1]!;
      rgba[targetIndex + 2] = reconstructed[sourceIndex + 2]!;
      rgba[targetIndex + 3] = channels === 4 ? reconstructed[sourceIndex + 3]! : 255;
    }
  }

  return { width, height, rgba };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoding (RGBA8) — used to ship rendered frames to vision judges.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, data.length, false);
  const body = concat([new TextEncoder().encode(type), data]);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(body), false);
  return concat([head, body, crc]);
}

/** Encodes RGBA pixels as an 8-bit RGBA PNG with filter-0 scanlines. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length < width * height * 4) {
    throw new Error("encodePng needs width*height*4 RGBA bytes");
  }
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width, false);
  headerView.setUint32(4, height, false);
  header[8] = 8;
  header[9] = 6;

  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw);

  return concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0))
  ]);
}
