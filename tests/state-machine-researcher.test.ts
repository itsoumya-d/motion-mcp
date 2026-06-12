import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { researchAppMotion, planScreenMotion } from "../packages/app-researcher/src/index.ts";
import { researchStateMachineExperience } from "../packages/state-machine-researcher/src/index.ts";

test("state-machine research creates one Rive-like spec per page-like surface", async () => {
  const root = await makeMultiTargetFixture();
  try {
    const result = await researchStateMachineExperience({
      rootPath: root,
      brief: "Create Rive-like page state machines across the whole codebase."
    });

    const files = result.pages.map((page) => page.file).sort();
    assert.deepEqual(files, [
      "apps/web/app/layout.tsx",
      "apps/web/app/page.tsx",
      "examples/expo-app/app/index.tsx",
      "examples/flutter-app/lib/main.dart",
      "examples/next-app/app/page.tsx",
      "examples/unity-app/Assets/Scripts/MenuButton.cs"
    ]);
    assert.equal(result.summary.totalPages, 6);
    assert.ok(result.researchSources.some((source) => source.includes("Rive")));

    const persisted = JSON.parse(
      await readFile(path.join(root, ".motion-mcp", "state-machine-experience.json"), "utf8")
    ) as typeof result;
    assert.equal(persisted.experienceId, result.experienceId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("known pages receive page-specific layers, transitions, and bindings", async () => {
  const root = await makeMultiTargetFixture();
  try {
    const result = await researchStateMachineExperience({ rootPath: root });
    const byFile = new Map(result.pages.map((page) => [page.file, page]));

    const product = byFile.get("apps/web/app/page.tsx");
    assert.ok(product);
    assert.ok(product.layers.some((layer) => layer.name === "Pipeline Panel"));
    assert.ok(product.layers.some((layer) => layer.name === "Billing Credits"));
    assert.ok(product.bindings.some((binding) => binding.property === "creditState"));

    const shell = byFile.get("apps/web/app/layout.tsx");
    assert.ok(shell);
    assert.deepEqual(shell.layers.map((layer) => layer.name), ["Route Lifecycle"]);
    assert.ok(shell.assetNeeds[0]?.includes("No standalone visual asset"));

    const next = byFile.get("examples/next-app/app/page.tsx");
    assert.ok(next);
    assert.ok(next.layers.some((layer) => layer.name === "Brand Logo"));
    assert.ok(next.layers.some((layer) => layer.name === "Primary CTA"));
    assert.ok(next.layers.some((layer) => layer.name === "Pricing Card"));
    assert.ok(next.transitions.some((transition) => transition.conditions.some((condition) => condition.property === "hasError")));

    const expo = byFile.get("examples/expo-app/app/index.tsx");
    assert.ok(expo);
    assert.equal(expo.framework, "expo");
    assert.ok(expo.layers.some((layer) => layer.states.some((state) => state.kind === "blend1d")));
    assert.ok(expo.layers.some((layer) => layer.states.some((state) => state.kind === "additiveBlend")));
    assert.ok(expo.viewModel.properties.some((property) => property.name === "rewardLevel"));

    const flutter = byFile.get("examples/flutter-app/lib/main.dart");
    assert.ok(flutter);
    assert.equal(flutter.framework, "flutter");
    assert.equal(flutter.codegen.readyForCodegen, false);
    assert.ok(flutter.layers.some((layer) => layer.name === "Payment Feedback Asset"));

    const unity = byFile.get("examples/unity-app/Assets/Scripts/MenuButton.cs");
    assert.ok(unity);
    assert.equal(unity.framework, "unity");
    assert.ok(unity.listeners.some((listener) => listener.type === "game"));
    assert.ok(unity.viewModel.properties.some((property) => property.name === "selectedIndex"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state-machine research composes after app motion research and preserves screen planning", async () => {
  const root = await makeMultiTargetFixture();
  try {
    const { context } = await researchAppMotion({ rootPath: root, brief: "premium but restrained" });
    const experience = await researchStateMachineExperience({ rootPath: root, brief: "premium but restrained" });
    const plan = await planScreenMotion({ rootPath: root, screenId: context.screens[0]?.screenId });

    assert.ok(experience.pages.length >= context.screens.length);
    assert.ok(experience.pages.every((page) => page.layers.length >= 1));
    assert.ok(plan.opportunities.length >= 1);
    assert.ok(experience.pages.some((page) => page.codegen.target === "react"));
    assert.ok(experience.pages.some((page) => page.codegen.target === "react-native"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeMultiTargetFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "motion-mcp-state-machine-"));
  await mkdir(path.join(root, "apps", "web", "app"), { recursive: true });
  await mkdir(path.join(root, "examples", "next-app", "app"), { recursive: true });
  await mkdir(path.join(root, "examples", "next-app", "public"), { recursive: true });
  await mkdir(path.join(root, "examples", "expo-app", "app"), { recursive: true });
  await mkdir(path.join(root, "examples", "flutter-app", "lib"), { recursive: true });
  await mkdir(path.join(root, "examples", "unity-app", "Assets", "Scripts"), { recursive: true });

  await writeJson(path.join(root, "package.json"), {
    devDependencies: {
      typescript: "^5.7.2"
    }
  });
  await writeJson(path.join(root, "apps", "web", "package.json"), {
    dependencies: {
      next: "^15.1.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "framer-motion": "^11.15.0"
    }
  });
  await writeJson(path.join(root, "examples", "next-app", "package.json"), {
    dependencies: {
      next: "^15.1.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "framer-motion": "^11.15.0"
    }
  });
  await writeJson(path.join(root, "examples", "expo-app", "package.json"), {
    dependencies: {
      expo: "^52.0.0",
      "react-native": "^0.76.0",
      react: "^18.3.1",
      "react-native-svg": "^15.8.0"
    }
  });

  await writeFile(
    path.join(root, "apps", "web", "app", "layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "apps", "web", "app", "page.tsx"),
    `export default function Page() {
  const tools = ["research_app_motion", "research_state_machine_experience", "generate_animation"];
  return <main><section aria-label="Motion MCP pipeline">app motion map simple or premium svg state machine</section><section>{tools.map((tool) => <article key={tool}>{tool}</article>)}</section><section>Credit model billing reserving committed refund error</section></main>;
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "examples", "next-app", "app", "page.tsx"),
    `import Image from "next/image";
import logo from "../public/logo.svg";
export default function Page() {
  return <main><nav><Image src={logo} alt="PulseForge" /><span>PulseForge</span></nav><h1>Fitness coaching that reacts with you.</h1><button>Start today</button><div className="pricing-card"><strong>Pro</strong><span>$20/mo</span></div></main>;
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "examples", "next-app", "public", "logo.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path id="logo-mark" d="M16 2l14 28H2L16 2z"/></svg>\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "examples", "expo-app", "app", "index.tsx"),
    `import { Pressable, Text, View } from "react-native";
import { Heart } from "@expo/vector-icons/Feather";
export default function HomeScreen() {
  return <View><Text>Daily Streak</Text><Text>17</Text><Pressable><Heart size={32} color="#E84A7A" /></Pressable></View>;
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "examples", "flutter-app", "lib", "main.dart"),
    `import 'package:flutter/material.dart';
void main() { runApp(const MotionExampleApp()); }
class MotionExampleApp extends StatelessWidget {
  const MotionExampleApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(home: Scaffold(body: Center(child: ElevatedButton(onPressed: () {}, child: const Text('Send payment')))));
  }
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "examples", "unity-app", "Assets", "Scripts", "MenuButton.cs"),
    `using UnityEngine;
public sealed class MenuButton : MonoBehaviour {
  public void Play() { Debug.Log("Play pressed"); }
}
`,
    "utf8"
  );
  return root;
}

async function writeJson(file: string, payload: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
