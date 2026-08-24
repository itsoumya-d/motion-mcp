import { inferRigFromTracks, type RigTrackPart } from "@motion-mcp/anatomy-engine";
import type { SceneDoc } from "@motion-mcp/scene-graph";

export interface VideoRigBoneSummary {
  boneId: string;
  name: string;
  parentBoneId?: string;
  targetParts: string[];
}

export interface VideoRigProposal {
  partsTracked: number;
  bonesProposed: number;
  /** PartIds folded into the root instead of earning their own bone. */
  stillParts: string[];
  /** Set when no rig was attached and why. */
  skippedReason?: string;
  bones: VideoRigBoneSummary[];
}

/**
 * Attaches an inferred SceneRig to a vectorized-flipbook SceneDoc and
 * returns the human-reviewable proposal describing what was attached.
 *
 * Degenerate inputs (fewer than two tracked parts, or zero observed
 * motion) never produce a silent wrong rig — they return a skipped
 * reason and leave the doc untouched, preserving pure-flipbook behavior.
 */
export function attachVideoRig(
  doc: SceneDoc,
  tracks: RigTrackPart[],
  options: { canvas?: { width: number; height: number } } = {}
): VideoRigProposal {
  const base = {
    partsTracked: tracks.length,
    bonesProposed: 0,
    stillParts: [] as string[],
    bones: [] as VideoRigBoneSummary[]
  };

  const moving = tracks.filter((track) => track.displacementPx > 0);
  if (tracks.length < 2 || moving.length === 0) {
    return {
      ...base,
      skippedReason:
        tracks.length < 2
          ? `only ${tracks.length} part(s) tracked; a rig needs at least two`
          : "no part moved across the kept keyframes"
    };
  }

  const { rig, stillParts } = inferRigFromTracks(tracks, options);
  doc.artboards[0]!.rig = rig;

  return {
    partsTracked: tracks.length,
    bonesProposed: rig.bones.length,
    stillParts,
    bones: rig.bones.map((bone) => ({
      boneId: bone.boneId,
      name: bone.name,
      parentBoneId: bone.parentBoneId,
      targetParts: [...bone.targetParts]
    }))
  };
}
