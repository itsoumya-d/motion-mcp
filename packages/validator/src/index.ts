import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  type FrameworkKind,
  type ValidationResult
} from "@motion-mcp/shared-types";

export async function validateProject(
  rootPath: string,
  framework: FrameworkKind
): Promise<ValidationResult> {
  const root = path.resolve(rootPath);
  const command = await chooseValidationCommand(root, framework);
  if (!command) {
    return {
      ok: true,
      skipped: true,
      reason: "No validation command was detected for this project."
    };
  }
  return run(command.cmd, command.args, root);
}

async function chooseValidationCommand(
  root: string,
  framework: FrameworkKind
): Promise<{ cmd: string; args: string[] } | null> {
  const packageJson = await readJson<{ scripts?: Record<string, string> }>(
    path.join(root, "package.json")
  );
  if (packageJson?.scripts?.typecheck) {
    const runner = await detectPackageRunner(root);
    return runner ? { cmd: runner, args: ["run", "typecheck"] } : null;
  }
  if (packageJson?.scripts?.build && (framework === "next" || framework === "react")) {
    const runner = await detectPackageRunner(root);
    return runner ? { cmd: runner, args: ["run", "build"] } : null;
  }
  if (await exists(path.join(root, "tsconfig.json"))) {
    return { cmd: "npx", args: ["tsc", "--noEmit"] };
  }
  if (framework === "flutter" && (await exists(path.join(root, "pubspec.yaml")))) {
    return { cmd: "flutter", args: ["analyze"] };
  }
  if (framework === "unity") {
    return {
      cmd: "dotnet",
      args: ["build", "--nologo"]
    };
  }
  return null;
}

async function detectPackageRunner(root: string): Promise<string | null> {
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(root, "yarn.lock"))) return "yarn";
  if (await exists(path.join(root, "bun.lockb"))) return "bun";
  if (await exists(path.join(root, "package-lock.json"))) return "npm";
  return "npm";
}

function run(cmd: string, args: string[], cwd: string): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        command: [cmd, ...args].join(" "),
        stdout,
        stderr,
        reason: "Validation timed out after 45 seconds."
      });
    }, 45_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        command: [cmd, ...args].join(" "),
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        reason: "Validation command failed to start."
      });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        command: [cmd, ...args].join(" "),
        stdout: stdout.slice(-8000),
        stderr: stderr.slice(-8000)
      });
    });
  });
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
