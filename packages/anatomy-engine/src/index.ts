export * from "./types.js";
export * from "./schemas.js";
export {
  analyzeSvgAnatomy,
  hasCapability,
  listSpecies,
  queueAnimation,
  resolveAction
} from "./anatomy.js";
export { detectByGeometry, detectByName } from "./detector.js";
export { parseSvg, parseViewBox, nodeBBox, pathPoints } from "./svg-parse.js";
export { CROW_SVG, DEMO_EVENT_STREAM, HUMAN_SVG, UNNAMED_BIRD_SVG } from "./fixtures.js";
