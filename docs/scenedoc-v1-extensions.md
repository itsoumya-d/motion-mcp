# SceneDoc v1 — Additive Extension Contract

SceneDoc is motion-mcp's open scene interchange format (`formatVersion: 1`). This
document defines how v1 evolves **without** a breaking version bump, and records
the extensions introduced by the MOTIONFORGE verification-first milestone.

## Versioning policy

1. **Additive, optional fields are always allowed under v1.** Consumers must
   treat every field they don't know as ignorable. Producers may emit them.
2. **Breaking changes** (renames, semantic changes to existing fields, required
   new fields) require `SCENE_FORMAT_VERSION = 2` plus a migration note here.
3. Every extension lands with: a type in `packages/scene-graph/src/types.ts`,
   validation in `validateSceneDoc`, at least one producer, and a section here.

## Extension registry

### 1. Character rig block (`artboard.rig`)

Added by the anatomy-engine auto-rigger. Bones carry an optional per-part
influence map added with this milestone:

```jsonc
{
  "rig": {
    "bones": [{
      "boneId": "bone_wing_L",
      "targetParts": ["wing-left"],
      "origin": { "x": 40, "y": 88 },
      "weights": { "wing-left": 0.9, "body": 0.1 }   // additive extension
    }]
  }
}
```

`weights[partId] ∈ [0,1]` expresses how strongly the bone drives that part;
absence means uniform influence over `targetParts`.

### 2. Temperament (`artboard.temperament`)

Four axes in `[0,1]` that procedurally shape motion style for any rigged or
plain asset:

```jsonc
{ "temperament": { "energy": 0.9, "weight": 0.25, "warmth": 0.7, "precision": 0.3 } }
```

- `energy` — pace/snap (fast, springy ↔ slow, languid)
- `weight` — mass illusion (heavy squash ↔ floaty)
- `warmth` — ambient secondary-motion liveliness (breathe/sway/blink)
- `precision` — mechanical tightness (tight stagger, easeInOut bias, no overshoot)

Named presets (`calm`, `energetic`, `nervous`, `playful`, `precise`, `heavy`)
resolve via `resolveTemperament()`. The derived parameters come from
`temperamentProfile()`; applying them to clips deterministically is
`applyTemperamentToClip()` / `applyTemperamentToDoc()` (time scaling + easing
substitution only — amplitudes are never invented).

Consumers that ignore `temperament` produce identical output to before; the
field only matters to temperament-aware generators and the critic's rubric.

### 3. Binding converters (`bindings[].converter`)

Extends the Rive-MVVM-style data binding with value transformation:

```jsonc
{
  "property": "progress",
  "targetPart": "progress-bar",
  "source": "app-state",
  "description": "Bar width from task progress",
  "converter": {
    "kind": "map-range",       // map-range | threshold | format
    "inMin": 0, "inMax": 100,
    "outMin": 0, "outMax": 1,
    "clamp": true
  }
}
```

| kind | params | semantics |
|---|---|---|
| `map-range` | `inMin/inMax → outMin/outMax`, optional `clamp` | linear remap of numeric input |
| `threshold` | `threshold`, `onValue/offValue` | boolean gate on numeric input |
| `format` | `template` containing `{value}` | string formatting |

Evaluated purely by `evaluateMotionConverter(converter, input)` in
`@motion-mcp/shared-types`. Validation requires the params listed above.

## Verification rubric (sibling contract)

The critic's scoring behavior is configured by a rubric JSON file — see
`packages/critic/src/rubric.ts` for the schema and `.motion-mcp/rubric.json`
for the project-level override path. Like SceneDoc, the rubric is versioned
(`version: 1`) and deep-merged over shipped defaults.
