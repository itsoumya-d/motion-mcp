import { analyzeSvgAnatomy, queueAnimation } from "./anatomy.js";
import { CROW_SVG, DEMO_EVENT_STREAM, HUMAN_SVG, UNNAMED_BIRD_SVG } from "./fixtures.js";

const targets = [
  ["human (named parts)", HUMAN_SVG],
  ["crow (named parts)", CROW_SVG],
  ["unnamed bird (geometry only)", UNNAMED_BIRD_SVG]
] as const;

for (const [name, svg] of targets) {
  const report = analyzeSvgAnatomy(svg);
  const manifest = report.manifest;
  console.log(`\n=== ${name} ===`);
  console.log(
    `species: ${manifest.speciesLabel} (${manifest.speciesId}) confidence=${manifest.matchConfidence} ok=${manifest.ok}`
  );
  console.log(
    `parts: ${report.parts
      .map((part) => `${part.role}:${part.nodeId}${part.source === "geometry" ? "*" : ""}`)
      .join(", ")}`
  );
  console.log(`capabilities: ${manifest.capabilities.map((capability) => capability.id).join(", ") || "none"}`);
  if (report.notes.length > 0) console.log(`notes: ${report.notes.join(" | ")}`);

  const queue = queueAnimation(report, DEMO_EVENT_STREAM);
  console.log(`event stream (${queue.speciesId}):`);
  for (const event of queue.events) {
    const detail = event.steps
      .map((step) => `${step.controller}@${step.nodeIds.join("+")}`)
      .join(" -> ");
    console.log(`  t=${String(event.atMs).padStart(4)}ms ${event.action}: ${detail}`);
  }
  for (const miss of queue.unresolved) {
    console.log(`  t=${String(miss.atMs).padStart(4)}ms ${miss.action}: SKIPPED (${miss.reason})`);
  }
}
console.log("\n(* = inferred geometrically from unnamed shapes)");
