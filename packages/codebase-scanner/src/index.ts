import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type AnimationRuntime,
  type CodebaseScanResult,
  type ComponentFile,
  type DependencyMap,
  type FrameworkKind,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".expo",
  ".turbo",
  ".dart_tool",
  "Pods",
  "Library",
  "Temp",
  "obj"
]);

const COMPONENT_EXTENSIONS = new Set([
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".dart",
  ".cs",
  ".uxml"
]);

const ANIMATION_DEPS: Record<string, AnimationRuntime> = {
  "framer-motion": "framer-motion",
  motion: "framer-motion",
  gsap: "gsap",
  "@gsap/react": "gsap",
  "react-native-reanimated": "reanimated",
  moti: "moti",
  "react-native-svg": "react-native-svg",
  "lottie-react-native": "lottie",
  "lottie-web": "lottie",
  "@lottiefiles/dotlottie-react": "lottie",
  "@rive-app/react-canvas": "rive",
  "@rive-app/react-native": "rive",
  rive: "rive",
  flutter_svg: "flutter-animation",
  lottie: "lottie",
  "simple_animations": "flutter-animation",
  "flutter_animate": "flutter-animation",
  DOTween: "dotween"
};

export async function scanCodebase(rootPath: string): Promise<CodebaseScanResult> {
  const root = path.resolve(rootPath);
  const warnings: string[] = [];
  const deps = await readDependencies(root, warnings);
  const allDeps = {
    ...deps.dependencies,
    ...deps.devDependencies,
    ...deps.peerDependencies
  };
  const files = await walk(root);
  const frameworks = detectFrameworks(root, files, allDeps);
  const framework = choosePrimaryFramework(frameworks);
  const componentFiles = await Promise.all(
    files
      .filter((file) => COMPONENT_EXTENSIONS.has(path.extname(file)))
      .map((file) => analyzeComponentFile(root, file, framework))
  );

  const animationLibsPresent = Array.from(
    new Set(
      Object.keys(allDeps)
        .map((dep) => ANIMATION_DEPS[dep])
        .filter((runtime): runtime is AnimationRuntime => Boolean(runtime))
    )
  );

  const entryPoints = detectEntryPoints(root, files);

  const result: CodebaseScanResult = {
    rootPath: root,
    framework,
    frameworks,
    deps,
    animationLibsPresent,
    componentFiles: componentFiles.filter((file) => {
      return (
        file.exportedComponents.length > 0 ||
        file.localComponents.length > 0 ||
        file.usesSvg ||
        file.usesImage ||
        file.usesIconLibrary ||
        file.usesLottie ||
        file.usesRive
      );
    }),
    entryPoints,
    warnings,
    scannedAt: nowIso()
  };

  await writeMotionFile(root, "scan.json", result);
  return result;
}

async function readDependencies(root: string, warnings: string[]): Promise<DependencyMap> {
  const empty: DependencyMap = {
    dependencies: {},
    devDependencies: {},
    peerDependencies: {}
  };
  const packageJsonPath = path.join(root, "package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DependencyMap>;
    return {
      dependencies: parsed.dependencies ?? {},
      devDependencies: parsed.devDependencies ?? {},
      peerDependencies: parsed.peerDependencies ?? {}
    };
  } catch {
    const pubspecPath = path.join(root, "pubspec.yaml");
    try {
      const pubspec = await fs.readFile(pubspecPath, "utf8");
      return parsePubspecDependencies(pubspec);
    } catch {
      warnings.push("No package.json or pubspec.yaml found; dependency detection is limited.");
      return empty;
    }
  }
}

function parsePubspecDependencies(source: string): DependencyMap {
  const dependencies: Record<string, string> = {};
  let section: "dependencies" | "devDependencies" | null = null;
  for (const line of source.split(/\r?\n/)) {
    if (/^dependencies:\s*$/.test(line)) {
      section = "dependencies";
      continue;
    }
    if (/^dev_dependencies:\s*$/.test(line)) {
      section = "devDependencies";
      continue;
    }
    if (/^\S/.test(line)) {
      section = null;
    }
    const match = line.match(/^\s{2}([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (section && match) {
      dependencies[match[1] ?? ""] = match[2]?.trim() || "*";
    }
  }
  return {
    dependencies,
    devDependencies: {},
    peerDependencies: {}
  };
}

async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".storybook") {
        if (entry.name !== ".motion-mcp") {
          continue;
        }
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await visit(path.join(dir, entry.name));
        }
        continue;
      }
      output.push(path.join(dir, entry.name));
    }
  }
  await visit(root);
  return output;
}

function detectFrameworks(
  root: string,
  files: string[],
  deps: Record<string, string>
): FrameworkKind[] {
  const frameworks = new Set<FrameworkKind>();
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  if (has("next") || files.some((file) => /(?:^|\/)(app|pages)\/.+\.(tsx|jsx)$/.test(rel(root, file)))) {
    frameworks.add("next");
  }
  if (has("expo")) {
    frameworks.add("expo");
  }
  if (has("react-native")) {
    frameworks.add("react-native");
  }
  if (has("react")) {
    frameworks.add("react");
  }
  if (files.some((file) => rel(root, file) === "pubspec.yaml" || rel(root, file).endsWith(".dart"))) {
    frameworks.add("flutter");
  }
  if (
    files.some((file) => rel(root, file).startsWith("Assets/")) ||
    files.some((file) => rel(root, file).startsWith("ProjectSettings/"))
  ) {
    frameworks.add("unity");
  }
  if (frameworks.size === 0) {
    frameworks.add("unknown");
  }
  return Array.from(frameworks);
}

function choosePrimaryFramework(frameworks: FrameworkKind[]): FrameworkKind {
  for (const candidate of ["expo", "react-native", "next", "react", "flutter", "unity"] as const) {
    if (frameworks.includes(candidate)) {
      return candidate;
    }
  }
  return frameworks[0] ?? "unknown";
}

async function analyzeComponentFile(
  root: string,
  file: string,
  fallbackFramework: FrameworkKind
): Promise<ComponentFile> {
  const source = await fs.readFile(file, "utf8").catch(() => "");
  const relativePath = rel(root, file);
  const ext = path.extname(file);
  const framework = frameworkForFile(ext, fallbackFramework);
  const imports = Array.from(source.matchAll(/import\s+.*?from\s+["']([^"']+)["']/g)).map(
    (match) => match[1] ?? ""
  );

  const exportedComponents = unique([
    ...Array.from(source.matchAll(/export\s+function\s+([A-Z][A-Za-z0-9_]*)/g)).map((m) => m[1] ?? ""),
    ...Array.from(source.matchAll(/export\s+const\s+([A-Z][A-Za-z0-9_]*)/g)).map((m) => m[1] ?? ""),
    ...Array.from(source.matchAll(/export\s+class\s+([A-Z][A-Za-z0-9_]*)/g)).map((m) => m[1] ?? ""),
    ...Array.from(source.matchAll(/class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+(?:StatelessWidget|StatefulWidget|MonoBehaviour)/g)).map(
      (m) => m[1] ?? ""
    )
  ]).filter(Boolean);

  const localComponents = unique([
    ...Array.from(source.matchAll(/(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g)).map((m) => m[1] ?? ""),
    ...Array.from(source.matchAll(/class\s+([A-Z][A-Za-z0-9_]*)/g)).map((m) => m[1] ?? "")
  ]).filter(Boolean);

  const detectedElements = unique(
    Array.from(source.matchAll(/<([A-Z][A-Za-z0-9_.]*|svg|path|button|Pressable|TouchableOpacity|Animated\.View)/g))
      .map((match) => match[1] ?? "")
      .filter(Boolean)
  );

  return {
    id: stableId("component", relativePath),
    path: relativePath,
    framework,
    exportedComponents,
    localComponents,
    usesSvg: /<svg[\s>]|<Svg[\s>]|react-native-svg|\.svg["']/.test(source),
    usesImage: /<Image[\s>]|next\/image|\.png["']|\.jpe?g["']|\.webp["']/.test(source),
    usesLottie: /lottie|dotLottie|\.json["']/.test(source),
    usesRive: /rive|\.riv["']/.test(source),
    usesIconLibrary: /lucide-react|react-icons|@expo\/vector-icons|phosphor|heroicons/.test(source),
    detectedElements,
    imports
  };
}

function frameworkForFile(ext: string, fallback: FrameworkKind): FrameworkKind {
  if (ext === ".dart") {
    return "flutter";
  }
  if (ext === ".cs" || ext === ".uxml") {
    return "unity";
  }
  return fallback;
}

function detectEntryPoints(root: string, files: string[]): string[] {
  const known = new Set([
    "src/main.tsx",
    "src/index.tsx",
    "app/page.tsx",
    "pages/index.tsx",
    "App.tsx",
    "app.json",
    "lib/main.dart",
    "Assets/Scripts",
    "ProjectSettings/ProjectSettings.asset"
  ]);
  return files
    .map((file) => rel(root, file))
    .filter((file) => known.has(file) || /(?:^|\/)(main|index|App)\.(tsx|jsx|dart|cs)$/.test(file));
}

async function writeMotionFile(root: string, filename: string, payload: unknown): Promise<void> {
  const dir = path.join(root, ".motion-mcp");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
