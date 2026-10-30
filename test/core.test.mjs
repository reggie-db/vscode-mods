import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMods } from "../src/core.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const modsRoot = path.join(repositoryRoot, "mods");
const temporaryRoots = [];
const originalBundle = [
  "localConversation.hookItem.summary.ariaLabel",
  "localConversation.hookItem.eventName.preToolUse",
  "localConversation.hookItem.eventName.postToolUse",
  "function k6(e){let t=(0,Q.c)(36),{item:n}=e,r=Ai(),[i,a]=(0,Z.useState)(!1),o,s,c,l,u,d,f,p;t[0]!==r;}",
].join(";");

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

function memoryLogger() {
  const entries = [];
  return {
    entries,
    info(message) {
      entries.push({ level: "info", message });
    },
    warn(message) {
      entries.push({ level: "warn", message });
    },
    error(message) {
      entries.push({ level: "error", message });
    },
  };
}

async function fixture(bundle = originalBundle) {
  const root = await mkdtemp(path.join(tmpdir(), "vscode-mods-test-"));
  temporaryRoots.push(root);
  const extensionsRoot = path.join(root, "extensions");
  const extensionRoot = path.join(extensionsRoot, "openai.chatgpt-1.2.3");
  const bundlePath = path.join(
    extensionRoot,
    "webview",
    "assets",
    "index-fixture.js",
  );
  const stateRoot = path.join(root, "state");
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, bundle, "utf8");
  return { extensionsRoot, bundlePath, stateRoot };
}

async function customMods(mutator) {
  const root = await mkdtemp(path.join(tmpdir(), "vscode-mods-manifest-"));
  temporaryRoots.push(root);
  const manifest = JSON.parse(
    await readFile(
      path.join(modsRoot, "hide-codex-tool-hook-rows", "mod.json"),
      "utf8",
    ),
  );
  mutator(manifest);
  const directory = path.join(root, manifest.id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "mod.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return root;
}

describe("folder-based mod application", () => {
  test("applies every discovered mod and is idempotent", async () => {
    const paths = await fixture();
    const logger = memoryLogger();
    const first = await runMods({
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(first).toEqual({
      applied: 1,
      restored: 0,
      unchanged: 0,
      failures: 0,
    });
    expect(await readFile(paths.bundlePath, "utf8")).toContain(
      "/* vscode-mods:hide-codex-tool-hook-rows */",
    );

    const second = await runMods({
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(second.failures).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  test("restores only the exact file it patched", async () => {
    const paths = await fixture();
    const logger = memoryLogger();
    await runMods({
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });

    const restored = await runMods({
      action: "restore",
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(restored).toEqual({
      applied: 0,
      restored: 1,
      unchanged: 0,
      failures: 0,
    });
    expect(await readFile(paths.bundlePath, "utf8")).toBe(originalBundle);
  });

  test("logs a mismatch and leaves the extension untouched", async () => {
    const mismatched = originalBundle.replace(".useState", ".changedStateHook");
    const paths = await fixture(mismatched);
    const logger = memoryLogger();
    const result = await runMods({
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(result.failures).toBe(1);
    expect(await readFile(paths.bundlePath, "utf8")).toBe(mismatched);
    expect(logger.entries.some((entry) => entry.level === "error")).toBe(true);
  });

  test("refuses to restore a file changed after patching", async () => {
    const paths = await fixture();
    const logger = memoryLogger();
    await runMods({
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    await writeFile(paths.bundlePath, "updated by someone else", "utf8");

    const result = await runMods({
      action: "restore",
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(result.failures).toBe(1);
    expect(await readFile(paths.bundlePath, "utf8")).toBe(
      "updated by someone else",
    );
  });

  test("validates every operation before writing any file", async () => {
    const paths = await fixture();
    const logger = memoryLogger();
    const transactionalModsRoot = await customMods((manifest) => {
      manifest.operations.push({
        ...manifest.operations[0],
        fileGlob: "webview/assets/missing-*.js",
      });
    });

    const result = await runMods({
      modsRoot: transactionalModsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(result.failures).toBe(1);
    expect(await readFile(paths.bundlePath, "utf8")).toBe(originalBundle);
  });

  test("rejects syntactically invalid JavaScript before writing", async () => {
    const paths = await fixture();
    const logger = memoryLogger();
    const invalidModsRoot = await customMods((manifest) => {
      manifest.operations[0].regex.replacement =
        "$1/* vscode-mods:hide-codex-tool-hook-rows */if(";
    });

    const result = await runMods({
      modsRoot: invalidModsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(result.failures).toBe(1);
    expect(await readFile(paths.bundlePath, "utf8")).toBe(originalBundle);
  });
});
