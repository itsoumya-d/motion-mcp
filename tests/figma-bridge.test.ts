import assert from "node:assert/strict";
import test from "node:test";
import {
  renderFrameToSvg,
  snapshotToSceneDoc,
  type FigmaSnapshot
} from "../packages/figma-bridge/src/index.ts";
import { validateSceneDoc } from "../packages/scene-graph/src/index.ts";

function cardSnapshot(): FigmaSnapshot {
  return {
    version: 1,
    source: "figma-plugin",
    file: "Checkout Cards",
    frames: [
      {
        id: "frame-default",
        name: "Card / Default",
        width: 320,
        height: 120,
        background: "#FFFFFF",
        elements: [
          { id: "card-surface", name: "Surface", kind: "rect", x: 0, y: 0, width: 320, height: 120, fill: "#FFFFFF", cornerRadius: 100 },
          { id: "icon", name: "Icon", kind: "ellipse", x: 24, y: 24, width: 32, height: 32, fill: "#7C3AED" },
          { id: "label", name: "Label", kind: "text", x: 72, y: 48, width: 160, height: 24, text: "Pay <now> & here", fontSize: 18 }
        ]
      },
      {
        id: "frame-hover",
        name: "Card / Hover",
        width: 320,
        height: 120,
        background: "#F5F3FF",
        elements: [
          { id: "card-surface", name: "Surface", kind: "rect", x: 0, y: 0, width: 320, height: 120, fill: "#F5F3FF" },
          { id: "icon", name: "Icon", kind: "ellipse", x: 40, y: 20, width: 40, height: 40, fill: "#7C3AED", rotationDeg: 6 },
          { id: "badge", name: "Badge", kind: "vector", x: 260, y: 16, width: 40, height: 20, vectorPaths: [{ windingRule: "EVENODD", data: "M 0 10 L 10 0 L 30 0 L 40 10 L 30 20 L 10 20 Z" }] }
        ]
      },
      {
        id: "frame-orphan",
        name: "Empty State",
        width: 200,
        height: 80,
        elements: [
          { id: "ghost", name: "Ghost", kind: "rect", x: 10, y: 10, width: 180, height: 60, fill: "#EEEEEE" }
        ]
      }
    ],
    connections: [
      { fromFrameId: "frame-default", toFrameId: "frame-hover", trigger: "ON_CLICK", animationType: "SMART_ANIMATE", durationMs: 240, easing: "GENTLE" },
      { fromFrameId: "frame-hover", toFrameId: "frame-default", trigger: "MOUSE_LEAVE", animationType: "DISSOLVE", durationMs: 90, easing: "LINEAR" },
      { fromFrameId: "frame-hover", toFrameId: "frame-ghost", trigger: "ON_CLICK", animationType: "INSTANT", durationMs: 500, easing: "INSTANT" }
    ]
  };
}

test("connected frames cluster into one artboard; unconnected frames stand alone", () => {
  const doc = snapshotToSceneDoc(cardSnapshot());
  assert.equal(doc.artboards.length, 2);

  const cluster = doc.artboards.find((artboard) => artboard.artboardId === "figma_frame-default")!;
  assert.ok(cluster, "cluster artboard uses the entry frame id");
  const orphan = doc.artboards.find((artboard) => artboard.artboardId === "figma_frame-orphan")!;
  assert.ok(orphan, "orphan frame gets its own artboard");

  assert.equal(cluster.stateMachines[0]!.states.length, 2);
  assert.equal(Object.keys(cluster.clips).length, 2);
  assert.equal(cluster.layers[0]!.targetParts.length, 4, "parts union across both states");

  // Dangling connection to frame-ghost is dropped (unknown target).
  assert.deepEqual(
    cluster.stateMachines[0]!.transitions.map((transition) => transition.toStateId),
    ["state-frame-hover", "state-frame-default"]
  );
});

test("each frame becomes a state clip holding its absolute pose", () => {
  const doc = snapshotToSceneDoc(cardSnapshot());
  const machine = doc.artboards[0]!.stateMachines[0]!;
  assert.equal(machine.initialStateId, "state-frame-default", "first snapshot frame is initial");

  const hoverClip = doc.artboards[0]!.clips["clip-frame-hover"]!;
  const trackFor = (partId: string, property: string) =>
    hoverClip.tracks.find((track) => track.targetPart === partId && track.property === property)!;

  // icon moved and resized relative to the entry-frame base pose.
  assert.equal(trackFor("icon", "translateX").keys[0]!.value, 40);
  assert.equal(trackFor("icon", "translateY").keys[0]!.value, 20);
  assert.equal(trackFor("icon", "scaleX").keys[0]!.value, 1.25);
  assert.equal(trackFor("icon", "rotate").keys[0]!.value, 6);

  // label exists only in the entry frame → hidden in hover.
  assert.equal(trackFor("label", "opacity").keys[0]!.value, 0);
  // badge exists only in hover → hidden in the default clip.
  const defaultClip = doc.artboards[0]!.clips["clip-frame-default"]!;
  assert.equal(defaultClip.tracks.find((track) => track.targetPart === "badge" && track.property === "opacity")!.keys[0]!.value, 0);
});

test("prototype triggers, easings, durations, and INSTANT map onto SceneDoc transitions", () => {
  const doc = snapshotToSceneDoc(cardSnapshot());
  const transitions = doc.artboards[0]!.stateMachines[0]!.transitions;

  const click = transitions.find((transition) => transition.transitionId === "t-frame-default-frame-hover")!;
  assert.equal(click.event, "activate");
  assert.equal(click.interpolation, "spring");
  assert.equal(click.durationMs, 240);

  const leave = transitions.find((transition) => transition.transitionId === "t-frame-hover-frame-default")!;
  assert.equal(leave.event, "pointerLeave");
  assert.equal(leave.interpolation, "linear");
  assert.equal(leave.durationMs, 90);
});

test("synthesized docs pass scene-graph validation", () => {
  const result = validateSceneDoc(snapshotToSceneDoc(cardSnapshot()));
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("renderFrameToSvg emits layered SVG with stable part ids", () => {
  const snapshot = cardSnapshot();
  const svg = renderFrameToSvg(snapshot.frames[1]!);

  assert.ok(svg.includes('viewBox="0 0 320 120"'), "frame dimensions carry through");
  assert.ok(svg.includes('<rect width="320" height="120" fill="#F5F3FF"/>'), "background rect first");
  assert.ok(svg.includes('id="icon"'), "part ids preserved for SceneDoc tracks");
  assert.ok(svg.includes('cx="60"' ), `ellipse centers on x+w/2: ${svg}`);
  assert.ok(svg.includes('transform="rotate(6 60 40)"'), "rotation pivots on element center");
  assert.ok(svg.includes("<g"), "vector elements render as grouped paths");
  assert.ok(svg.includes('fill-rule="evenodd"'), "winding rule maps to fill-rule");

  const rounded = renderFrameToSvg({
    id: "f",
    name: "Rounded",
    width: 320,
    height: 120,
    elements: [{ id: "surface", name: "Surface", kind: "rect", x: 0, y: 0, width: 320, height: 120, cornerRadius: 100 }]
  });
  assert.ok(rounded.includes('rx="60"'), "cornerRadius clamps to half the smallest dimension (min(100, 160, 60))");
});

test("text content is XML-escaped and baseline offsets by font size", () => {
  const svg = renderFrameToSvg({
    id: "f",
    name: "Text Frame",
    width: 200,
    height: 60,
    elements: [
      { id: "label", name: "Label", kind: "text", x: 8, y: 8, width: 160, height: 24, text: 'a<b>&"c"', fontSize: 20 }
    ]
  });
  assert.ok(svg.includes("font-size=\"20\""));
  assert.ok(svg.includes('y="28"'), "text sits one line down from its top-left corner");
  assert.ok(!svg.includes("<b>"), "raw markup never leaks into output");
  assert.ok(svg.includes("a&lt;b&gt;&amp;&quot;c&quot;"), "entities escape");
});

test("empty snapshots and unknown element kinds are tolerated", () => {
  const empty = snapshotToSceneDoc({ version: 1, source: "figma-plugin", file: "empty", frames: [], connections: [] });
  assert.equal(empty.artboards.length, 0);
  assert.equal(validateSceneDoc(empty).ok, true);

  const svg = renderFrameToSvg({
    id: "f",
    name: "Weird",
    width: 50,
    height: 50,
    elements: [{ id: "mystery", name: "Mystery", kind: "vector" as never, x: 0, y: 0, width: 10, height: 10 }]
  });
  assert.ok(svg.startsWith("<svg"), "still renders a valid document shell");
});
