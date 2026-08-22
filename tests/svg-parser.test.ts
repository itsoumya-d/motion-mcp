import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenSvgNodes,
  parseSvgDimensions,
  parseSvgDocument,
  parseSvgTree,
  transformToMatrix
} from "../packages/svg-parser/src/index.ts";

const RICH_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment that the old regex parser choked on -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"
     width="100"
     height="100">
  <defs>
    <linearGradient id="grad-a" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff0000"/>
      <stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/>
    </linearGradient>
    <g id="eye-template"><circle id="eye-ball" class="eye" cx="4" cy="4" r="3"/></g>
  </defs>
  <style>.eye { fill: #334455; } #pupil { fill: #112233; }</style>
  <g id="head" transform="translate(10,20)" opacity="0.5">
    <rect id="pupil" class="eye" x="0.5" y='0.5' width="2" height="2"
          style="fill: #00ff00"/>
    <use href="#eye-template" x="30" y="40"/>
    <path d="M0 0L10 &amp; 10Z" fill="url(#grad-a)"/>
    <clipPath id="clip-1"><circle cx="1" cy="1" r="9"/></clipPath>
    <title>The head</title>
  </g>
</svg>`;

test("parses multi-line attributes, comments and entities without choking", () => {
  const result = parseSvgDocument(RICH_SVG);
  assert.equal(result.roots.length, 1);
  const svg = result.roots[0]!;
  assert.equal(svg.tag, "svg");
  // defs and style are consumed (rules/gradients registered), renderable content remains
  assert.deepEqual(svg.children.map((child) => child.tag), ["g"]);
  const head = svg.children[0]!;
  // clipPath is referenced content and must not leak into the part tree
  assert.deepEqual(head.children.map((child) => child.tag), ["rect", "use", "path", "title"]);
});

test("captures dimensions and viewBox from the root element", () => {
  const dims = parseSvgDimensions(RICH_SVG);
  assert.equal(dims.width, 100);
  assert.equal(dims.height, 100);
  assert.equal(dims.viewBox, "0 0 100 100");
  assert.deepEqual(parseSvgTree(RICH_SVG).length, 1);
});

test("resolves transforms into one composed matrix down the tree", () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(10,20)">
      <rect transform="translate(5,5)" width="2" height="2"/>
    </g>
  </svg>`;
  const svgRoot = parseSvgTree(source)[0]!;
  const g = svgRoot.children[0]!;
  assert.deepEqual(g.resolvedTransform, [1, 0, 0, 1, 10, 20]);
  const rect = g.children[0]!;
  assert.equal(rect.resolvedTransform![4], 15);
  assert.equal(rect.resolvedTransform![5], 25);
  assert.ok(transformToMatrix("rotate(90)").every(Number.isFinite));
});

test("cascades presentation attributes, style rules and inline style", () => {
  const doc = parseSvgDocument(RICH_SVG);
  const head = doc.roots[0]!.children.find((node) => node.id === "head")!;
  const pupil = head.children.find((node) => node.id === "pupil")!;
  // inline style beats CSS rule
  assert.equal(pupil.style!.fill, "#00ff00");
  // opacity multiplies down the tree (group has 0.5)
  assert.equal(pupil.opacity, 0.5);
  const useClone = head.children.find((node) => node.tag === "use")!;
  const ball = flattenSvgNodes(useClone).find((node) => node.id === "eye-ball")!;
  // CSS class rule beats inherited defaults for the cloned eye
  assert.equal(ball.style!.fill, "#334455");
});

test("expands use references with translation applied", () => {
  const doc = parseSvgDocument(RICH_SVG);
  const head = doc.roots[0]!.children.find((node) => node.id === "head")!;
  const useNode = head.children.find((node) => node.tag === "use")!;
  const cloneRoot = useNode.children[0]!;
  const flat = flattenSvgNodes(cloneRoot);
  const ball = flat.find((node) => node.id === "eye-ball");
  assert.ok(ball, "use target subtree should be cloned as children");
  assert.equal(ball.attrs.cx, "4");
  // the clone root carries the composed context matrix: group translate(10,20) + use translate(30,40)
  const rootMatrix = cloneRoot.resolvedTransform ?? [];
  assert.equal(rootMatrix[4], 40);
  assert.equal(rootMatrix[5], 60);
});

test("registers gradients with stops and coordinates", () => {
  const doc = parseSvgDocument(RICH_SVG);
  const gradient = doc.gradients["grad-a"];
  assert.ok(gradient);
  assert.equal(gradient.kind, "linear");
  assert.equal(gradient.stops.length, 2);
  assert.equal(gradient.stops[1].color, "#0000ff");
  assert.equal(gradient.stops[1].opacity, 0.5);
  assert.equal(gradient.coords.x2, 1);
});

test("marks hidden subtrees and captures text content", () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg">
    <g display="none"><circle r="1"/></g>
    <text id="label">Hello world</text>
  </svg>`;
  const tree = parseSvgTree(source);
  const hiddenGroup = tree[0]!.children[0]!;
  assert.equal(hiddenGroup.hidden, true);
  assert.equal(hiddenGroup.children[0]!.hidden, true);
  const label = tree[0]!.children[1]!;
  assert.equal(label.textContent, "Hello world");
});

test("survives malformed input without throwing", () => {
  const broken = `<svg xmlns="http://www.w3.org/2000/svg"><unclosed></svg>`;
  let result;
  try {
    result = parseSvgDocument(broken);
  } catch {
    assert.fail("parser must not throw on malformed input");
  }
  if (result.roots.length > 0 || result.warnings.length >= 0) {
    assert.ok(Array.isArray(result.warnings));
  }
});

test("flattenSvgNodes walks depth-first over the parsed tree", () => {
  const tree = parseSvgTree(
    `<svg xmlns="http://www.w3.org/2000/svg"><g><rect/></g><circle/></svg>`
  );
  const flat = flattenSvgNodes(tree[0]!);
  assert.deepEqual(flat.map((node) => node.tag), ["svg", "g", "rect", "circle"]);
});
