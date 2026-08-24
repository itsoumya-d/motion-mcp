import type { SceneBone, SceneRig } from "@motion-mcp/scene-graph";

// ---------------------------------------------------------------------------
// Minimal glTF 2.0 reading — JSON documents only (.glb binary is detected and
// rejected with guidance). Only what skeleton inference needs is decoded:
// nodes, skins, mesh POSITION/J OINTS_0/WEIGHTS_0 accessors.
// ---------------------------------------------------------------------------

interface GltfNode {
  name?: string;
  translation?: number[];
  children?: number[];
}

interface GltfSkin {
  name?: string;
  joints: number[];
}

interface GltfPrimitive {
  attributes?: Record<string, number>;
}

interface GltfMesh {
  name?: string;
  primitives?: GltfPrimitive[];
}

interface GltfDocument {
  asset?: { version?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  skins?: GltfSkin[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: Array<{ uri?: string; byteLength: number }>;
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
}

const COMPONENT_SIZES: Record<number, number> = {
  5121: 1,
  5123: 2,
  5125: 4,
  5126: 4
};

const TYPE_WIDTHS: Record<GltfAccessor["type"], number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4
};

/** True when bytes start with the glTF binary container magic ("glTF"). */
export function isGlb(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

export function parseGltf(source: string | Uint8Array): GltfDocument {
  if (typeof source !== "string") {
    if (isGlb(source)) {
      throw new Error(
        "Binary .glb containers are not supported yet — export the asset as JSON .gltf (with embedded base64 buffers or a sibling .bin)."
      );
    }
    source = new TextDecoder().decode(source);
  }
  const doc = JSON.parse(source) as GltfDocument;
  const version = doc.asset?.version ?? "";
  if (!version.startsWith("2")) {
    throw new Error(`Only glTF 2.0 is supported (asset.version was "${version}").`);
  }
  return doc;
}

async function loadBuffers(doc: GltfDocument, loadExternal: LoadExternalBuffer): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const buffer of doc.buffers ?? []) {
    if (buffer.uri?.startsWith("data:application/octet-stream;base64,")) {
      out.push(Uint8Array.from(Buffer.from(buffer.uri.slice("data:application/octet-stream;base64,".length), "base64")));
    } else if (buffer.uri) {
      out.push(await loadExternal(buffer.uri));
    } else {
      throw new Error("glTF buffer has no uri and no loader was provided.");
    }
  }
  return out;
}

export type LoadExternalBuffer = (uri: string) => Promise<Uint8Array>;

function readBufferView(doc: GltfDocument, buffers: Uint8Array[], viewIndex: number): Uint8Array {
  const view = doc.bufferViews?.[viewIndex];
  if (!view) throw new Error(`glTF bufferView ${viewIndex} missing`);
  const bytes = buffers[view.buffer];
  if (!bytes) throw new Error(`glTF buffer ${view.buffer} not loaded`);
  const start = view.byteOffset ?? 0;
  return bytes.subarray(start, start + view.byteLength);
}

interface AccessorData {
  values: number[][][];
  elementWidth: number;
}

function readAccessor(doc: GltfDocument, buffers: Uint8Array[], accessorIndex: number): AccessorData {
  const accessor = doc.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`glTF accessor ${accessorIndex} missing`);
  const componentSize = COMPONENT_SIZES[accessor.componentType];
  if (!componentSize) throw new Error(`Unsupported glTF componentType ${accessor.componentType}`);
  const width = TYPE_WIDTHS[accessor.type];
  const bytes = readBufferView(doc, buffers, accessor.bufferView);
  const stride = doc.bufferViews?.[accessor.bufferView]?.byteStride ?? componentSize * width;
  const base = accessor.byteOffset ?? 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const values: number[][][] = [];
  let offset = base;
  for (let element = 0; element < accessor.count; element += 1) {
    const vector: number[] = [];
    for (let component = 0; component < width; component += 1) {
      vector.push(readComponent(view, offset + component * componentSize, accessor.componentType));
    }
    values.push([vector]);
    offset += stride;
  }
  return { values, elementWidth: width };
}

function readComponent(view: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5121:
      return view.getUint8(offset);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      throw new Error(`Unsupported glTF componentType ${componentType}`);
  }
}

function flatValues(data: AccessorData): number[][] {
  return data.values.map((entry) => entry[0]!);
}

// ---------------------------------------------------------------------------
// Rig proposals
// ---------------------------------------------------------------------------

export interface RigProposalFromGltf {
  proposalOnly: true;
  /** How the skeleton was obtained. */
  source: "skin" | "mesh-inference";
  boneCount: number;
  rigBlock: SceneRig;
  /** Per-bone influence statistics when JOINTS_0/WEIGHTS_0 were present. */
  weightSummary?: Record<string, { influences: number; maxWeight: number }>;
  notes: string[];
}

export interface ProposeRigFromGltfOptions {
  /** Band count for unskinned mesh inference along the longest axis. Default 5. */
  bands?: number;
  /** Loads external .bin buffers referenced by non-data URIs. */
  loadBuffer?: LoadExternalBuffer;
}

/**
 * glTF → SceneDoc rig proposal. Skinned assets yield their exact joint
 * hierarchy (names preserved, translations projected onto the artboard XY);
 * unskinned static meshes get an inferred chain by slicing vertices into
 * bands along each dimension. Nothing is persisted — review, then commit.
 */
export async function proposeRigFromGltf(
  source: string | Uint8Array,
  options: ProposeRigFromGltfOptions = {}
): Promise<RigProposalFromGltf> {
  const doc = parseGltf(source);
  const buffers = await loadBuffers(doc, options.loadBuffer ?? (() => {
    throw new Error("glTF references an external .bin buffer; provide loadBuffer(uri) to fetch it.");
  }));

  if (doc.skins && doc.skins.length > 0) {
    return skinnedProposal(doc, buffers);
  }
  return inferredProposal(doc, buffers, options.bands ?? 5);
}

function skinnedProposal(doc: GltfDocument, buffers: Uint8Array[]): RigProposalFromGltf {
  const skin = doc.skins![0]!;
  const nodes = doc.nodes ?? [];
  const notes: string[] = [];

  const parentOf = new Map<number, number>();
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      parentOf.set(child, index);
    }
  });

  const finalBones: SceneBone[] = skin.joints.map((jointIndex, slot) => {
    const node = nodes[jointIndex] ?? {};
    const parentId = parentOf.get(jointIndex);
    const parentSlot = parentId !== undefined ? skin.joints.indexOf(parentId) : -1;
    return {
      boneId: `bone_${node.name ?? `joint_${slot}`}`,
      name: node.name ?? `joint_${slot}`,
      parentBoneId:
        parentSlot >= 0 ? `bone_${nodes[skin.joints[parentSlot]!]?.name ?? `joint_${parentSlot}`}` : undefined,
      targetParts: [],
      origin: {
        x: round2(node.translation?.[0] ?? 0),
        y: round2(-(node.translation?.[1] ?? 0))
      }
    };
  });

  const weightSummary = collectWeights(doc, buffers, skin.joints.length);
  if (!weightSummary) {
    notes.push("No JOINTS_0/WEIGHTS_0 attributes found on mesh primitives — weight painting will be proposed separately.");
  }
  notes.push(
    "Joint hierarchy comes straight from the file's first skin; verify root choice matches how you want motion layered."
  );

  return {
    proposalOnly: true,
    source: "skin",
    boneCount: finalBones.length,
    rigBlock: { speciesId: "generic-rigged", matchConfidence: 1, bones: finalBones, ikChains: [], secondaryMotion: [] },
    ...(weightSummary ? { weightSummary } : {}),
    notes
  };
}

function collectWeights(
  doc: GltfDocument,
  buffers: Uint8Array[],
  jointCount: number
): Record<string, { influences: number; maxWeight: number }> | undefined {
  const summary = new Map<number, { influences: number; maxWeight: number }>();
  let seenAny = false;

  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const jointsAttr = primitive.attributes?.JOINTS_0;
      const weightsAttr = primitive.attributes?.WEIGHTS_0;
      if (jointsAttr === undefined || weightsAttr === undefined) continue;
      seenAny = true;
      const joints = flatValues(readAccessor(doc, buffers, jointsAttr));
      const weights = flatValues(readAccessor(doc, buffers, weightsAttr));
      for (let vertex = 0; vertex < Math.min(joints.length, weights.length); vertex += 1) {
        for (let slot = 0; slot < Math.min(4, joints[vertex]!.length, weights[vertex]!.length); slot += 1) {
          const joint = joints[vertex]![slot]!;
          const weight = weights[vertex]![slot]!;
          if (weight <= 0 || joint >= jointCount) continue;
          const entry = summary.get(joint) ?? { influences: 0, maxWeight: 0 };
          entry.influences += 1;
          entry.maxWeight = Math.max(entry.maxWeight, weight);
          summary.set(joint, entry);
        }
      }
    }
  }

  if (!seenAny) return undefined;
  const out: Record<string, { influences: number; maxWeight: number }> = {};
  for (const [joint, stats] of summary) {
    out[`bone_${joint}`] = {
      influences: stats.influences,
      maxWeight: round2(stats.maxWeight)
    };
  }
  return out;
}

function inferredProposal(
  doc: GltfDocument,
  buffers: Uint8Array[],
  bands: number
): RigProposalFromGltf {
  const positions: number[][] = [];
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined) continue;
      positions.push(...flatValues(readAccessor(doc, buffers, positionAccessor)));
    }
  }
  if (positions.length === 0) {
    throw new Error("No POSITION accessors found across meshes — cannot infer a skeleton.");
  }

  const sampled = thin(positions, 50000);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of sampled) {
    for (const axis of [0, 1, 2]) {
      min[axis] = Math.min(min[axis]!, point[axis] ?? 0);
      max[axis] = Math.max(max[axis]!, point[axis] ?? 0);
    }
  }
  const spans = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
  const dominantAxis = spans.indexOf(Math.max(...spans));

  const sorted = [...sampled].sort((a, b) => (a[dominantAxis] ?? 0) - (b[dominantAxis] ?? 0));
  const bandSize = Math.max(1, Math.floor(sorted.length / bands));
  const bones: SceneBone[] = [];

  for (let band = 0; band < bands; band += 1) {
    const slice = sorted.slice(band * bandSize, band === bands - 1 ? sorted.length : (band + 1) * bandSize);
    if (slice.length === 0) continue;
    let sumX = 0;
    let sumY = 0;
    for (const point of slice) {
      sumX += point[0] ?? 0;
      sumY += point[1] ?? 0;
    }
    bones.push({
      boneId: `bone_band_${band}`,
      name: `band_${band}`,
      parentBoneId: band > 0 ? `bone_band_${band - 1}` : undefined,
      targetParts: [`part-${band + 1}`],
      origin: {
        x: round2(sumX / slice.length),
        y: round2(-(sumY / slice.length))
      }
    });
  }

  return {
    proposalOnly: true,
    source: "mesh-inference",
    boneCount: bones.length,
    rigBlock: { speciesId: "inferred-chain", matchConfidence: 0.4, bones, ikChains: [], secondaryMotion: [] },
    notes: [
      `No skin in file — skeleton INFERRED by slicing ${sampled.length} vertices into ${bones.length} bands along the ${axisName(dominantAxis)} axis.`,
      "Inferred chains suit simple props/tubes; for characters consider authoring a skin upstream instead."
    ]
  };
}

function thin(points: number[][], cap: number): number[][] {
  if (points.length <= cap) return points;
  const stride = points.length / cap;
  const out: number[][] = [];
  for (let slot = 0; slot < cap; slot += 1) {
    out.push(points[Math.floor(slot * stride)]!);
  }
  return out;
}

function axisName(axis: number): string {
  return ["X", "Y", "Z"][axis] ?? "?";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
