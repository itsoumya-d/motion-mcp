import type { SceneArtboard, SceneDoc } from "@motion-mcp/scene-graph";
import { KNOWN_TYPE_NAMES, type RivImportResult } from "./importer.js";

/**
 * Builds an honest SceneDoc skeleton from a parsed .riv inventory.
 *
 * v1 wedge scope: the skeleton carries the file identity and a full content
 * inventory (objects, type histogram, discovered names) so agents can reason
 * about a Rive file before full geometry/state-machine mapping lands.
 */
export function toSceneSkeleton(result: RivImportResult, fallbackName = "riv-import"): SceneDoc {
  const header = result.header;
  const name = result.strings[0]?.value ?? fallbackName;

  const artboard: SceneArtboard & { rivInventory?: Record<string, unknown> } = {
    artboardId: `riv_${header?.fileId ?? 0}`,
    name,
    experienceSummary:
      `Rive format ${header ? `${header.majorVersion}.${header.minorVersion}` : "?"} — ` +
      `${result.objects.length} objects, ${result.strings.length} named strings. ` +
      inventoryLine(result),
    layers: [],
    clips: {},
    stateMachines: [],
    bindings: [],
    listeners: [],
    audioEvents: [],
    semantics: { reducedMotionSafe: false },
    rivInventory: {
      majorVersion: header?.majorVersion,
      minorVersion: header?.minorVersion,
      fileId: header?.fileId,
      objectCount: result.objects.length,
      typeHistogram: result.typeHistogram,
      strings: result.strings.map((hit) => hit.value),
      warnings: result.warnings
    }
  };

  return {
    formatVersion: 1,
    sceneId: `scene_riv_${header?.fileId ?? "unknown"}`,
    name,
    createdAt: new Date().toISOString(),
    artboards: [artboard]
  };
}

function inventoryLine(result: RivImportResult): string {
  const parts = Object.entries(result.typeHistogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([typeKey, count]) => `${KNOWN_TYPE_NAMES[Number(typeKey)] ?? `type${typeKey}`}×${count}`);
  return parts.join(", ");
}
