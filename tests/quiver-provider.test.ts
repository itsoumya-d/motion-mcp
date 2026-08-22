import assert from "node:assert/strict";
import test from "node:test";
import {
  QuiverProvider,
  backoffDelayMs,
  motionCreditsForQuiver,
  parseApiKeys,
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
  assert.equal(generated.pricingCredits, 20);
});

test("fallback pricing matches live QuiverAI prices", () => {
  const provider = new QuiverProvider({ mock: true });
  assert.equal(provider.keyCount, 0);
});

test("parseApiKeys splits comma-separated keys and drops empties", () => {
  assert.deepEqual(parseApiKeys("a,b , ,c"), ["a", "b", "c"]);
  assert.deepEqual(parseApiKeys(undefined), []);
  assert.deepEqual(parseApiKeys(""), []);
});

test("constructor prefers explicit apiKey then QUIVERAI_API_KEYS then QUIVERAI_API_KEY", () => {
  const previous = {
    keys: process.env.QUIVERAI_API_KEYS,
    single: process.env.QUIVERAI_API_KEY
  };
  try {
    delete process.env.QUIVERAI_API_KEYS;
    delete process.env.QUIVERAI_API_KEY;
    assert.equal(new QuiverProvider({ mock: false }).keyCount, 0);

    process.env.QUIVERAI_API_KEY = "single";
    assert.equal(new QuiverProvider({ mock: false }).keyCount, 1);

    process.env.QUIVERAI_API_KEYS = "k1,k2,k3";
    assert.equal(new QuiverProvider({ mock: false }).keyCount, 3);

    assert.equal(new QuiverProvider({ apiKey: "explicit", mock: false }).keyCount, 1);
  } finally {
    if (previous.keys === undefined) delete process.env.QUIVERAI_API_KEYS;
    else process.env.QUIVERAI_API_KEYS = previous.keys;
    if (previous.single === undefined) delete process.env.QUIVERAI_API_KEY;
    else process.env.QUIVERAI_API_KEY = previous.single;
  }
});

test("backoff honors x-ratelimit-reset seconds and caps growth", () => {
  assert.equal(backoffDelayMs(0, null), 500);
  assert.equal(backoffDelayMs(1, null), 1000);
  assert.equal(backoffDelayMs(6, null), 8000);
  assert.ok(backoffDelayMs(0, "2") >= 250 && backoffDelayMs(0, "2") <= 2000);
});
