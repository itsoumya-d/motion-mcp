# SceneDoc v1 — the open scene format

SceneDoc is Motion MCP's unified, diff-friendly JSON interchange format. One
document spans both motion worlds that used to live apart: **Rive-like UI
state machines** (states / transitions / bindings) and **keyframed character
clips** (MotionDoc-style). Every part of the pipeline consumes or produces it:
researchers write SceneDocs, emitters read them, the player plays them,
importers fill them.

- Authoritative types: [`packages/scene-graph/src/types.ts`](../packages/scene-graph/src/types.ts)
- Additive extension policy: [scenedoc-v1-extensions.md](./scenedoc-v1-extensions.md)

## Top level (`SceneDoc`)

| Field | Type | Notes |
|---|---|---|
| `formatVersion` | `1` | Constant; bump rules live in the extensions doc |
| `sceneId` | string | Stable identity; generators seed from content, not wall clocks |
| `name` | string | Human label |
| `createdAt` | ISO string | Metadata only — excluded from determinism claims |
| `canvas?` | `{ width?, height?, viewBox? }` | Artboard-space coordinate frame |
| `artboards` | `SceneArtboard[]` | One per screen/character surface |

## Artboard (`SceneArtboard`)

Identity & context: `artboardId`, `name`, optional `sourceFile`, `screenId`,
`routePattern`, `framework`, plus authoring notes (`experienceSummary`,
`restraintRules[]`).

Content:

| Field | Purpose |
|---|---|
| `layers: SceneLayer[]` | Named z-ordered groups targeting SVG part ids |
| `clips: Record<string, SceneClip>` | Keyframed timelines, addressed by id |
| `stateMachines: SceneStateMachine[]` | Rive-like graphs over clips |
| `bindings: MotionBinding[]` | App-state → motion-input wiring (typed prop on generated components) |
| `listeners: MotionListener[]` | DOM/gesture event wiring |
| `audioEvents: SceneAudioEvent[]` | Synced audio triggers |
| `rig?: SceneRig` | *v1 extension* — bones, IK chains, secondary motion |
| `temperament?: SceneTemperament` | *v1 extension* — four personality axes in `[0,1]`: `energy`, `weight`, `warmth`, `precision` |

## Clips & tracks

```jsonc
{
  "clipId": "clip-play",
  "durationMs": 1166,
  "loop": true,
  "tracks": [
    { "targetPart": "part-01", "property": "translateX",
      "keys": [ { "t": 0, "value": 0, "easing": "easeInOut" },
                { "t": 166, "value": 12, "easing": "easeInOut" } ] }
  ]
}
```

- `targetPart` — a part id, or `"*"` for the whole layer/artboard.
- `property` — one of the typed `SceneProperty` values (`opacity`, `scale`,
  `scaleX`, `scaleY`, `rotate`, `translateX`, `translateY`) or an emitter-known
  string.
- `keys[].easing` — `linear | easeIn | easeOut | easeInOut | hold | spring`.
- Loop seams are validated by the critic (`review_animation`); parity across
  renderable targets is enforced by `verify_cross_runtime`.

## State machines

States reference clips (`clipId`, `loop`), carry a `kind`
(entry/interactive/ambient), and transition via guarded edges. Bindings make
machines react to real app state — see the binding converters noted in the
extensions doc.

## Versioning contract

SceneDoc v1 evolves additively: new optional fields never break older readers,
and every accepted extension is documented with rationale and migration notes
in [scenedoc-v1-extensions.md](./scenedoc-v1-extensions.md) (currently
`temperament`, binding converters, per-bone `weights`). Breaking changes
require a `formatVersion` bump and an importer story for v1 files.
