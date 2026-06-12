import assert from "node:assert/strict";
import test from "node:test";
import {
  QuiverProvider,
  motionCreditsForQuiver,
  selectSvgModel
} from "../packages/quiver-provider/src/index.ts";

test("Quiver credit markup uses a 2x margin multiplier", () => {
  assert.equal(motionCreditsForQuiver(25), 50);
  assert.equal(motionCreditsForQuiver(25.2), 51);
});

test("model selection defaults to arrow-1.1 and escalates for dense prompts", () => {
  assert.equal(selectSvgModel({ prompt: "simple app logo" }), "arrow-1.1");
  assert.equal(selectSvgModel({ prompt: "dense technical dashboard diagram" }), "arrow-1.1-max");
});

test("mock provider returns structured SVG and fallback pricing without an API key", async () => {
  const provider = new QuiverProvider({ mock: true });
  const models = await provider.listModels();
  const generated = await provider.generateSvg({
    prompt: "premium motion logo",
    instructions: "name every animatable part"
  });
  assert.ok(models.some((model) => model.id === "arrow-1.1"));
  assert.match(generated.svg, /<svg/);
  assert.equal(generated.model, "arrow-1.1");
  assert.equal(generated.pricingCredits, 25);
});
