// motion-mcp figma-bridge — collector side (runs in the Figma sandbox).
// Collects frames, elements, and prototype reactions into a plain-JSON
// FigmaBridgeSnapshot. All synthesis lives in @motion-mcp/figma-bridge
// (imported server-side via import_figma_scene), so this file stays thin.

const ELEMENT_KINDS = {
  RECTANGLE: "rect",
  ELLIPSE: "ellipse",
  TEXT: "text",
  VECTOR: "vector",
  LINE: "vector",
  POLYGON: "vector",
  STAR: "vector",
  FRAME: "frame",
  GROUP: "frame"
};

figma.showUI(__html__, { width: 320, height: 260 });

function hex(paint) {
  if (!paint || paint.type !== "SOLID") return undefined;
  const c = paint.color || {};
  const to = (v) => Math.max(0, Math.min(255, Math.round((v || 0) * 255))).toString(16).padStart(2, "0");
  return "#" + to(c.r) + to(c.g) + to(c.b);
}

function elementOf(node) {
  const kind = ELEMENT_KINDS[node.type];
  if (!kind) return null;
  if (node.visible === false) return null;
  const element = {
    id: node.id,
    name: node.name,
    kind,
    x: Math.round(node.x * 100) / 100,
    y: Math.round(node.y * 100) / 100,
    width: Math.round(node.width * 100) / 100,
    height: Math.round(node.height * 100) / 100
  };
  if (typeof node.opacity === "number" && node.opacity < 1) element.opacity = Math.round(node.opacity * 1000) / 1000;
  if (node.rotation) element.rotationDeg = Math.round(node.rotation * 100) / 100;
  const fillHex = hex(Array.isArray(node.fills) ? node.fills[0] : undefined);
  if (fillHex) element.fill = fillHex;
  const strokeHex = hex(Array.isArray(node.strokes) ? node.strokes[0] : undefined);
  if (strokeHex) {
    element.stroke = strokeHex;
    element.strokeWidth = node.strokeWeight || 1;
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    element.cornerRadius = node.cornerRadius;
  }
  if (kind === "vector" && Array.isArray(node.vectorPaths) && node.vectorPaths.length > 0) {
    element.vectorPaths = node.vectorPaths.map((p) => ({ windingRule: p.windingRule, data: p.data }));
  }
  if (kind === "text") {
    element.text = node.characters;
    element.fontSize = node.fontSize;
    element.fontFamily = node.fontName && node.fontName !== figma.mixed ? node.fontName.family : undefined;
  }
  return element;
}

function frameSnapshot(frame) {
  const elements = [];
  for (const child of frame.children || []) {
    const element = elementOf(child);
    if (element) elements.push(element);
  }
  return {
    id: frame.id,
    name: frame.name,
    width: Math.round(frame.width),
    height: Math.round(frame.height),
    background: hex(Array.isArray(frame.fills) ? frame.fills[0] : undefined),
    elements
  };
}

function connectionsFrom(frames) {
  const connections = [];
  for (const frame of frames) {
    for (const reaction of frame.reactions || []) {
      const action = reaction.action || {};
      if (action.type !== "NODE" || !action.destinationId) continue;
      const transition = action.transition || {};
      connections.push({
        fromFrameId: frame.id,
        toFrameId: action.destinationId,
        trigger: reaction.trigger ? reaction.trigger.type : "ON_CLICK",
        animationType: transition.type || "SMART_ANIMATE",
        durationMs: transition.duration != null ? transition.duration * 1000 : 300,
        easing: transition.easing && transition.easing.type ? transition.easing.type : "EASE_OUT"
      });
    }
  }
  return connections;
}

function collect() {
  const page = figma.currentPage;
  let frames = page.selection.filter((n) => n.type === "FRAME");
  if (frames.length === 0) frames = page.children.filter((n) => n.type === "FRAME");
  const snapshot = {
    version: 1,
    source: "figma-plugin",
    file: figma.root && figma.root.name ? figma.root.name : "Figma file",
    frames: frames.map(frameSnapshot),
    connections: connectionsFrom(frames)
  };
  figma.ui.postMessage({
    type: "snapshot",
    snapshot,
    stats: { frames: snapshot.frames.length, connections: snapshot.connections.length }
  });
}

figma.ui.onmessage = (message) => {
  if (message && message.type === "collect") collect();
};
