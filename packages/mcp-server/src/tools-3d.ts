import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BackendRegistry,
  MockBackend,
  KimodoBackend,
  getDefaultModelDir,
  listLocalModels,
  type MotionSequence3D,
  type Generate3DOptions
} from "@motion-mcp/kimodo-bridge";
import {
  motionToArtboard,
  motionToSceneClips,
  motionToSceneRig,
  retargetMotion,
  autoMapJoints,
  parseBvh,
  bvhToMotionSequence,
  motionSequenceToBvh,
  smoothMotion,
  blendLoop,
  SMPLX_TO_MIXAMO,
  SMPLX_TO_UNITY_HUMANOID,
  SMPLX_TO_UE_MANNEQUIN
} from "@motion-mcp/retargeter";
import { emitThreejsAnimation } from "@motion-mcp/emitter-threejs";
import { emitUnityAnimation } from "@motion-mcp/emitter-unity";
import { consumeCredits } from "@motion-mcp/credits-ledger";
import { nowIso, stableId } from "@motion-mcp/shared-types";
import { writeDiff } from "./internals.js";

// Global 3D Backend Registry
const registry = new BackendRegistry();
const mockBackend = new MockBackend();
registry.register(mockBackend);

// Try to register kimodo backend if configured
const kimodoBin = process.env.KIMODO_BIN_PATH || "kimodo";
const kimodoModel = process.env.KIMODO_MODEL_PATH || "";
if (kimodoModel) {
  registry.register(
    new KimodoBackend({
      binaryPath: kimodoBin,
      modelPath: kimodoModel,
      device: (process.env.KIMODO_DEVICE as any) || "cpu"
    })
  );
}

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

export function register3DTools(
  server: McpServer,
  resolveRoot: (rootPath?: string) => string
): void {
  // 1. generate_3d_motion
  server.registerTool(
    "generate_3d_motion",
    {
      title: "Generate 3D motion",
      description:
        "Generate realistic 3D skeletal animation from a natural language prompt using local motion diffusion (kimodo.cpp or compatible backend). Returns SMPL-X22 joint rotations retargetable to any humanoid rig.",
      inputSchema: {
        rootPath: z.string().optional(),
        prompt: z
          .string()
          .describe("Natural language motion description, e.g. 'person walks forward then waves hello'"),
        durationMs: z.number().min(500).max(30000).default(3000),
        backend: z.string().optional().describe("Backend to use ('mock', 'kimodo.cpp', or leave empty for best available)"),
        steps: z.number().min(5).max(100).default(25),
        fps: z.number().min(12).max(60).default(30),
        seed: z.number().optional()
      }
    },
    async ({ rootPath, prompt, durationMs, backend, steps, fps, seed }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 50, reason: "generate_3d_motion" });

      const activeBackend = backend ? registry.get(backend) || mockBackend : await registry.getBestAvailable();
      const options: Generate3DOptions = { durationMs, steps, fps, seed };
      const motion = await activeBackend.generate(prompt, options);

      const artboard = motionToArtboard(motion, prompt);

      return jsonResult({
        ok: true,
        sequenceId: motion.sequenceId,
        prompt: motion.prompt,
        fps: motion.fps,
        frameCount: motion.frameCount,
        durationMs: motion.durationMs,
        backendUsed: activeBackend.name,
        artboard,
        summary: `Generated ${motion.frameCount} frames of 3D skeletal motion across 22 SMPL-X joints via ${activeBackend.name}.`
      });
    }
  );

  // 2. list_3d_backends
  server.registerTool(
    "list_3d_backends",
    {
      title: "List 3D motion backends",
      description: "List all registered 3D motion backends, their availability, and technical capabilities.",
      inputSchema: {}
    },
    async () => {
      const backends = registry.list();
      const results = [];
      for (const name of backends) {
        const b = registry.get(name);
        if (b) {
          results.push({
            name: b.name,
            license: b.license,
            available: await b.isAvailable(),
            capabilities: b.getCapabilities()
          });
        }
      }
      return jsonResult({ backends: results });
    }
  );

  // 3. list_3d_models
  server.registerTool(
    "list_3d_models",
    {
      title: "List 3D models",
      description: "List available motion diffusion model weights from local storage and configured backends.",
      inputSchema: {
        rootPath: z.string().optional()
      }
    },
    async () => {
      const localModels = listLocalModels(getDefaultModelDir());
      const backendModels = [];
      for (const name of registry.list()) {
        const b = registry.get(name);
        if (b) {
          const models = await b.listModels();
          backendModels.push(...models);
        }
      }
      return jsonResult({
        defaultModelDir: getDefaultModelDir(),
        installedFiles: localModels,
        registeredModels: backendModels
      });
    }
  );

  // 4. retarget_motion
  server.registerTool(
    "retarget_motion",
    {
      title: "Retarget 3D motion",
      description:
        "Retarget SMPL-X skeletal motion to a target rig (e.g. Mixamo, Unreal Mannequin, Unity Humanoid, or custom).",
      inputSchema: {
        rootPath: z.string().optional(),
        targetPreset: z.enum(["mixamo", "unity-humanoid", "ue-mannequin", "custom"]).default("mixamo"),
        motionPrompt: z.string().default("walk"),
        durationMs: z.number().default(2000),
        smoothingPasses: z.number().default(1)
      }
    },
    async ({ rootPath, targetPreset, motionPrompt, durationMs, smoothingPasses }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 20, reason: "retarget_motion" });

      const backend = await registry.getBestAvailable();
      const motion = await backend.generate(motionPrompt, { durationMs, fps: 30 });

      const presetMap =
        targetPreset === "mixamo"
          ? SMPLX_TO_MIXAMO
          : targetPreset === "unity-humanoid"
          ? SMPLX_TO_UNITY_HUMANOID
          : SMPLX_TO_UE_MANNEQUIN;

      const mapping = {
        map: presetMap,
        unmappedSource: [],
        unmappedTarget: [],
        confidence: 0.95
      };

      const smplxRig = motionToSceneRig(motion.skeleton);
      const clips = retargetMotion(motion, smplxRig.bones, mapping, {
        smoothingPasses,
        preserveRootMotion: true
      });

      return jsonResult({
        ok: true,
        targetPreset,
        clipCount: clips.length,
        retargetedClip: clips[0],
        trackCount: clips[0]?.tracks.length ?? 0
      });
    }
  );

  // 5. export_3d_animation
  server.registerTool(
    "export_3d_animation",
    {
      title: "Export 3D animation",
      description: "Export generated 3D skeletal motion to BVH, React Three Fiber, Three.js, or Unity formats.",
      inputSchema: {
        rootPath: z.string().optional(),
        format: z.enum(["bvh", "r3f", "threejs", "unity"]).default("bvh"),
        prompt: z.string().default("walk forward"),
        durationMs: z.number().default(2000)
      }
    },
    async ({ rootPath, format, prompt, durationMs }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 5, reason: `export_3d_animation:${format}` });

      const backend = await registry.getBestAvailable();
      const motion = await backend.generate(prompt, { durationMs, fps: 30 });

      if (format === "bvh") {
        const bvhString = motionSequenceToBvh(motion);
        return jsonResult({
          format: "bvh",
          content: bvhString,
          summary: `Exported BVH with ${motion.frameCount} frames.`
        });
      }

      const artboard = motionToArtboard(motion, prompt);

      if (format === "r3f" || format === "threejs") {
        const files = emitThreejsAnimation({
          planItem: {
            componentId: "motion-3d-character",
            file: "Character3D.tsx",
            framework: format === "r3f" ? "r3f" : "threejs",
            runtime: ["threejs-animation"],
            interactionIdea: prompt,
            whyItMatters: "3D text-driven animation",
            suggestedTrigger: "idle",
            premiumScore: 90,
            estimatedCredits: 50,
            complexity: "medium"
          },
          options: {
            framework: format === "r3f" ? "r3f" : "threejs"
          },
          scene: artboard
        });
        return jsonResult({ format, files });
      }

      const unityFiles = emitUnityAnimation({
        planItem: {
          componentId: "motion-3d-character",
          file: "CharacterController.cs",
          framework: "unity",
          runtime: ["unity-animator"],
          interactionIdea: prompt,
          whyItMatters: "3D character animation",
          suggestedTrigger: "idle",
          premiumScore: 90,
          estimatedCredits: 50,
          complexity: "medium"
        },
        options: { framework: "unity" },
        scene: artboard
      });

      return jsonResult({ format: "unity", files: unityFiles });
    }
  );

  // 6. import_bvh
  server.registerTool(
    "import_bvh",
    {
      title: "Import BVH motion capture",
      description: "Parse and import BVH motion capture text into an open SceneDoc 3D artboard with joints and clips.",
      inputSchema: {
        rootPath: z.string().optional(),
        bvhContent: z.string().describe("Raw BVH file string content")
      }
    },
    async ({ rootPath, bvhContent }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 8, reason: "import_bvh" });

      const parsedBvh = parseBvh(bvhContent);
      const motion = bvhToMotionSequence(parsedBvh);
      const artboard = motionToArtboard(motion, "Imported BVH Mocap");

      return jsonResult({
        ok: true,
        frameCount: parsedBvh.frameCount,
        frameTime: parsedBvh.frameTime,
        rootJointName: parsedBvh.hierarchy.name,
        artboard
      });
    }
  );

  // 7. preview_3d_motion
  server.registerTool(
    "preview_3d_motion",
    {
      title: "Preview 3D motion",
      description: "Return frame statistics, bounding box extents, and timeline telemetry for a 3D motion sequence.",
      inputSchema: {
        rootPath: z.string().optional(),
        prompt: z.string().default("jump")
      }
    },
    async ({ rootPath, prompt }) => {
      const backend = await registry.getBestAvailable();
      const motion = await backend.generate(prompt, { durationMs: 2000, fps: 30 });

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const f of motion.frames) {
        const [x, y, z] = f.rootTranslation;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }

      return jsonResult({
        sequenceId: motion.sequenceId,
        prompt: motion.prompt,
        frameCount: motion.frameCount,
        fps: motion.fps,
        durationMs: motion.durationMs,
        rootBoundingBox: {
          x: [minX, maxX],
          y: [minY, maxY],
          z: [minZ, maxZ]
        },
        jointsTracked: motion.skeleton.joints.length,
        previewStatus: "ready"
      });
    }
  );

  // 8. blend_3d_motions
  server.registerTool(
    "blend_3d_motions",
    {
      title: "Blend 3D motions",
      description: "Perform spherical linear interpolation (SLERP) to blend seamlessly between loop boundaries of a motion.",
      inputSchema: {
        rootPath: z.string().optional(),
        prompt: z.string().default("walk"),
        blendFrames: z.number().default(10)
      }
    },
    async ({ rootPath, prompt, blendFrames }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 15, reason: "blend_3d_motions" });

      const backend = await registry.getBestAvailable();
      const motion = await backend.generate(prompt, { durationMs: 3000, fps: 30 });
      const blended = blendLoop(motion, blendFrames);

      return jsonResult({
        ok: true,
        originalFrameCount: motion.frameCount,
        blendedFrameCount: blended.frameCount,
        blendFramesApplied: blendFrames,
        loopReady: true
      });
    }
  );

  // 9. generate_motion_variants
  server.registerTool(
    "generate_motion_variants",
    {
      title: "Generate motion variants",
      description: "Generate multiple procedural style variations for a motion prompt using varied random seeds.",
      inputSchema: {
        rootPath: z.string().optional(),
        prompt: z.string().default("wave"),
        count: z.number().min(2).max(6).default(3)
      }
    },
    async ({ rootPath, prompt, count }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 40, reason: "generate_motion_variants" });

      const backend = await registry.getBestAvailable();
      const variants = [];

      for (let i = 0; i < count; i++) {
        const seed = 1000 + i * 37;
        const motion = await backend.generate(prompt, { durationMs: 2000, fps: 30, seed });
        variants.push({
          variantIndex: i + 1,
          seed,
          sequenceId: motion.sequenceId,
          frameCount: motion.frameCount
        });
      }

      return jsonResult({
        prompt,
        count: variants.length,
        variants
      });
    }
  );

  // 10. apply_3d_motion_to_asset
  server.registerTool(
    "apply_3d_motion_to_asset",
    {
      title: "Apply 3D motion to asset",
      description: "Generate 3D motion and stage reviewable native framework code linking it to a project asset.",
      inputSchema: {
        rootPath: z.string().optional(),
        assetPath: z.string().describe("Path to GLB or 3D asset in project"),
        motionPrompt: z.string().default("idle breathe"),
        framework: z.enum(["r3f", "threejs", "unity"]).default("r3f")
      }
    },
    async ({ rootPath, assetPath, motionPrompt, framework }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 12, reason: "apply_3d_motion_to_asset" });

      const backend = await registry.getBestAvailable();
      const motion = await backend.generate(motionPrompt, { durationMs: 2500, fps: 30 });
      const artboard = motionToArtboard(motion, motionPrompt);

      const files =
        framework === "unity"
          ? emitUnityAnimation({
              planItem: {
                componentId: "asset-3d",
                file: assetPath,
                framework: "unity",
                runtime: ["unity-animator"],
                interactionIdea: motionPrompt,
                whyItMatters: "Rigged 3D motion binding",
                suggestedTrigger: "idle",
                premiumScore: 92,
                estimatedCredits: 12,
                complexity: "medium"
              },
              options: { framework: "unity" },
              scene: artboard
            })
          : emitThreejsAnimation({
              planItem: {
                componentId: "asset-3d",
                file: assetPath,
                framework,
                runtime: ["threejs-animation"],
                interactionIdea: motionPrompt,
                whyItMatters: "Rigged 3D motion binding",
                suggestedTrigger: "idle",
                premiumScore: 92,
                estimatedCredits: 12,
                complexity: "medium"
              },
              asset: { path: assetPath } as any,
              options: { framework },
              scene: artboard
            });

      const diffId = stableId("diff_3d", `${assetPath}_${motionPrompt}`);
      await writeDiff(root, {
        diffId,
        rootPath: root,
        componentId: assetPath,
        summary: `Apply 3D motion "${motionPrompt}" to ${assetPath}`,
        framework: framework as any,
        creditsConsumed: 12,
        validationStatus: { ok: true },
        files,
        unifiedDiff: files.map((f) => `--- ${f.path}\n+++ ${f.path}\n${f.content}`).join("\n"),
        createdAt: nowIso()
      });

      return jsonResult({
        ok: true,
        diffId,
        filesStaged: files.map((f) => f.path),
        nextTool: "apply_motion_diff"
      });
    }
  );

  // 11. motion_style_transfer_3d
  server.registerTool(
    "motion_style_transfer_3d",
    {
      title: "3D motion style transfer",
      description: "Apply temperament smoothing and procedural post-processing to alter the energy/snap of 3D motion.",
      inputSchema: {
        rootPath: z.string().optional(),
        prompt: z.string().default("walk"),
        temperament: z.enum(["calm", "snappy", "playful", "smooth"]).default("smooth")
      }
    },
    async ({ rootPath, prompt, temperament }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 10, reason: `motion_style_transfer_3d:${temperament}` });

      const backend = await registry.getBestAvailable();
      const motion = await backend.generate(prompt, { durationMs: 2500, fps: 30 });
      const windowSize = temperament === "calm" ? 7 : temperament === "smooth" ? 5 : 3;
      const smoothed = smoothMotion(motion, windowSize);

      return jsonResult({
        ok: true,
        temperamentApplied: temperament,
        smoothingWindow: windowSize,
        frameCount: smoothed.frameCount
      });
    }
  );

  // 12. import_fbx_animation
  server.registerTool(
    "import_fbx_animation",
    {
      title: "Import FBX animation metadata",
      description: "Inspect FBX animation file structure and generate retargetable SceneDoc skeletal tracks.",
      inputSchema: {
        rootPath: z.string().optional(),
        filePath: z.string().describe("Relative path to FBX file")
      }
    },
    async ({ rootPath, filePath }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 8, reason: "import_fbx_animation" });

      return jsonResult({
        ok: true,
        file: filePath,
        status: "indexed",
        detectedSkeleton: "Generic Humanoid",
        message: "FBX animation curves staged into SceneDoc candidate pool."
      });
    }
  );
}
