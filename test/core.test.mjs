import { afterEach, describe, expect, test } from "bun:test";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMods, sha256 } from "../src/core.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const modsRoot = path.join(repositoryRoot, "mods");
const temporaryRoots = [];
const originalBundle = [
  "`localConversation.hookItem.summary.ariaLabel`;",
  "`localConversation.hookItem.eventName.preToolUse`;",
  "`localConversation.hookItem.eventName.postToolUse`;",
  "`localConversation.hookItem.eventName.userPromptSubmit`;",
  "function k6(e){let t=(0,Q.c)(36),{item:n}=e,r=Ai(),[i,a]=(0,Z.useState)(!1),o,s,c,l,u,d,f,p;t[0]!==r;}",
  "function g5(a){let u=a.type===`hook`?(0,$.jsx)(k6,{item:a}):a.type===`reasoning`?null:p5({item:a});return u}",
  "function render(x,F,_e,t){for(let e of x)_e(`pre-user-${e.id}`,(0,$.jsx)(k6,{item:e}));for(let e of F)_e(`post-assistant-${e.id}`,e.type===`hook`?(0,$.jsx)(k6,{item:e}):p5({item:e,conversationId:t}))}",
].join("");

const projectHistoryMainBundle = [
  "`local conversation has invalid createdAt or updatedAt`;",
  "`header.recentTasks.seeAll`;",
  "`codex.recentTasksMenu.count`;",
  "`open-recent-tasks-menu`;",
  "`h as Hm`;",
  "function Yy(e,t,n){let r=gy(),i=Pt(xl),a=em(),o=zl(),s=(0,Z.useRef)(new Map);return(0,Z.useMemo)(()=>{let c=Zy(Xy({tasks:e,localConversations:t,pendingWorktrees:r,envForFilter:n,threadSortKey:i,isBackgroundSubagentsEnabled:a,windowType:o}),s.current);return s.current=new Map(c.map(e=>[e.key,e])),c},[e,n,a,t,r,i,o])}",
  "function xCe(){let e=[],i,a,r,n,o,s,f={};let p=Si(f),m=(p.data??[]).filter(CCe),h;e[3]!==i||e[4]!==a?(h=e=>Jy({conversation:e,isBackgroundSubagentsEnabled:i,windowType:a}),e[3]=i,e[4]=a,e[5]=h):h=e[5];let g=(r??[]).filter(h).filter(SCe),_=m.length+g.length,v=1;return _+v}",
].join("");

const projectHistoryGroupsBundle = [
  'import{s as oe}from"./thread-context-inputs-fixture.js";',
  "`THREAD_WORKSPACE_ROOT_HINTS`;",
  "`No cwd found for local task`;",
  "function we(){let {data:w,isLoading:T}=h(oe),{data:re,isLoading:E}=F(),D=1;return [w,T,re,E,D]}",
].join("");

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

async function projectHistoryFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vscode-mods-history-test-"));
  temporaryRoots.push(root);
  const extensionsRoot = path.join(root, "extensions");
  const assetsRoot = path.join(
    extensionsRoot,
    "openai.chatgpt-26.5409.20454",
    "webview",
    "assets",
  );
  const mainBundlePath = path.join(assetsRoot, "index-fixture.js");
  const groupsBundlePath = path.join(
    assetsRoot,
    "local-environment-action-icon-options-fixture.js",
  );
  const stateRoot = path.join(root, "state");
  await mkdir(assetsRoot, { recursive: true });
  await writeFile(mainBundlePath, projectHistoryMainBundle, "utf8");
  await writeFile(groupsBundlePath, projectHistoryGroupsBundle, "utf8");
  return {
    extensionsRoot,
    groupsBundlePath,
    mainBundlePath,
    stateRoot,
  };
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

async function installPreviousVersion(paths) {
  const component =
    "function k6(e){let t=(0,Q.c)(36),{item:n}=e,r=Ai(),[i,a]=(0,Z.useState)(!1),o,s,c,l,u,d,f,p;";
  const unit =
    "a.type===`hook`?(0,$.jsx)(k6,{item:a}):a.type===`reasoning`?null";
  const preUser =
    "for(let e of x)_e(`pre-user-${e.id}`,(0,$.jsx)(k6,{item:e}));";
  const postAssistant =
    "e.type===`hook`?(0,$.jsx)(k6,{item:e}):p5({item:e,conversationId:";
  const hidden = (item) =>
    `${item}.run.eventName===\`preToolUse\`||${item}.run.eventName===\`postToolUse\``;
  const previousBundle = originalBundle
    .replace(
      component,
      `${component}/* vscode-mods:hide-codex-tool-hook-rows */if(${hidden("n")})return null;`,
    )
    .replace(
      unit,
      `a.type===\`hook\`?/* vscode-mods:hide-codex-tool-hook-unit */(${hidden("a")}?null:(0,$.jsx)(k6,{item:a})):a.type===\`reasoning\`?null`,
    )
    .replace(
      preUser,
      `for(let e of x){/* vscode-mods:hide-codex-pre-user-hook-row */if(${hidden("e")})continue;_e(\`pre-user-${"${e.id}"}\`,(0,$.jsx)(k6,{item:e}));}`,
    )
    .replace(
      postAssistant,
      `e.type===\`hook\`?/* vscode-mods:hide-codex-post-assistant-hook-row */(${hidden("e")}?null:(0,$.jsx)(k6,{item:e})):p5({item:e,conversationId:`,
    );
  const backup = path.join(paths.stateRoot, "previous-original.bak");
  await mkdir(paths.stateRoot, { recursive: true });
  await writeFile(paths.bundlePath, previousBundle, "utf8");
  await writeFile(backup, originalBundle, "utf8");
  await writeFile(
    path.join(paths.stateRoot, "state.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      mods: {
        "hide-codex-tool-hook-rows": {
          targets: {
            [paths.bundlePath]: {
              file: paths.bundlePath,
              backup,
              originalHash: sha256(originalBundle),
              patchedHash: sha256(previousBundle),
              appliedAt: new Date().toISOString(),
            },
          },
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  return previousBundle;
}

describe("folder-based mod application", () => {
  test("applies every discovered mod and is idempotent", async () => {
    const paths = await fixture();
    const logger = memoryLogger();
    const first = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
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
    const patched = await readFile(paths.bundlePath, "utf8");
    expect(patched).toContain("/* vscode-mods:hidden-hook-types */");
    expect(patched).toContain(
      "new Set([`preToolUse`,`postToolUse`,`userPromptSubmit`])",
    );
    expect(patched).toContain(
      "/* vscode-mods:hide-codex-tool-hook-unit-v2 */",
    );
    expect(patched).toContain(
      "/* vscode-mods:hide-codex-pre-user-hook-row-v2 */",
    );
    expect(patched).toContain(
      "/* vscode-mods:hide-codex-post-assistant-hook-row-v2 */",
    );

    const second = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
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
      selectedIds: ["hide-codex-tool-hook-rows"],
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });

    const restored = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
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

  test("upgrades an applied mod while preserving the original backup", async () => {
    const paths = await fixture();
    const logger = memoryLogger();
    const previousVersion = await installPreviousVersion(paths);
    expect(previousVersion).toContain(
      "/* vscode-mods:hide-codex-tool-hook-rows */",
    );
    expect(previousVersion).toContain(
      "/* vscode-mods:hide-codex-tool-hook-unit */",
    );

    const upgraded = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(upgraded).toEqual({
      applied: 1,
      restored: 0,
      unchanged: 0,
      failures: 0,
    });
    const upgradedBundle = await readFile(paths.bundlePath, "utf8");
    expect(upgradedBundle).toContain(
      "new Set([`preToolUse`,`postToolUse`,`userPromptSubmit`])",
    );
    expect(upgradedBundle).not.toContain(
      "/* vscode-mods:hide-codex-tool-hook-rows */",
    );

    const restored = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
      action: "restore",
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(restored.failures).toBe(0);
    expect(await readFile(paths.bundlePath, "utf8")).toBe(originalBundle);
  });

  test("logs a mismatch and leaves the extension untouched", async () => {
    const mismatched = originalBundle.replace(".useState", ".changedStateHook");
    const paths = await fixture(mismatched);
    const logger = memoryLogger();
    const result = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
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
      selectedIds: ["hide-codex-tool-hook-rows"],
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    await writeFile(paths.bundlePath, "updated by someone else", "utf8");

    const result = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
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
      selectedIds: ["hide-codex-tool-hook-rows"],
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
        "/* vscode-mods:hidden-hook-types */if(";
    });

    const result = await runMods({
      selectedIds: ["hide-codex-tool-hook-rows"],
      modsRoot: invalidModsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(result.failures).toBe(1);
    expect(await readFile(paths.bundlePath, "utf8")).toBe(originalBundle);
  });
});

describe("project-scoped history mod", () => {
  test("patches both history bundles, is idempotent, and restores exactly", async () => {
    const paths = await projectHistoryFixture();
    const logger = memoryLogger();
    const first = await runMods({
      selectedIds: ["scope-codex-history-to-project"],
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(first).toEqual({
      applied: 2,
      restored: 0,
      unchanged: 0,
      failures: 0,
    });

    const patchedMain = await readFile(paths.mainBundlePath, "utf8");
    const patchedGroups = await readFile(paths.groupsBundlePath, "utf8");
    expect(patchedMain).toContain(
      "/* vscode-mods:project-scoped-merged-history */",
    );
    expect(patchedMain).toContain(
      "/* vscode-mods:project-scoped-running-count */",
    );
    expect(patchedGroups).toContain(
      "/* vscode-mods:active-project-workspace-roots */",
    );

    const second = await runMods({
      selectedIds: ["scope-codex-history-to-project"],
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(second.failures).toBe(0);
    expect(second.unchanged).toBe(2);

    const restored = await runMods({
      selectedIds: ["scope-codex-history-to-project"],
      action: "restore",
      modsRoot,
      extensionRoots: [paths.extensionsRoot],
      stateRoot: paths.stateRoot,
      logger,
    });
    expect(restored.failures).toBe(0);
    expect(restored.restored).toBe(2);
    expect(await readFile(paths.mainBundlePath, "utf8")).toBe(
      projectHistoryMainBundle,
    );
    expect(await readFile(paths.groupsBundlePath, "utf8")).toBe(
      projectHistoryGroupsBundle,
    );
  });
});

describe("VS Code user settings mods", () => {
  test("preserves JSONC comments and restores the exact settings file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vscode-mods-settings-test-"));
    temporaryRoots.push(root);
    const settingsFile = path.join(root, "User", "settings.json");
    const stateRoot = path.join(root, "state");
    const original = [
      "{",
      "  // Keep this comment.",
      '  "editor.fontSize": 14,',
      '  "chat.disableAIFeatures": false, // Keep this setting comment.',
      "}",
      "",
    ].join("\n");
    await mkdir(path.dirname(settingsFile), { recursive: true });
    await writeFile(settingsFile, original, "utf8");
    const logger = memoryLogger();

    const applied = await runMods({
      selectedIds: ["disable-vscode-native-chat"],
      modsRoot,
      settingsFiles: [settingsFile],
      stateRoot,
      logger,
    });
    expect(applied.failures).toBe(0);
    expect(applied.applied).toBe(1);
    const patched = await readFile(settingsFile, "utf8");
    expect(patched).toContain("// Keep this comment.");
    expect(patched).toContain("// Keep this setting comment.");
    expect(Bun.JSONC.parse(patched)["chat.disableAIFeatures"]).toBe(true);

    const restored = await runMods({
      selectedIds: ["disable-vscode-native-chat"],
      action: "restore",
      modsRoot,
      settingsFiles: [settingsFile],
      stateRoot,
      logger,
    });
    expect(restored.failures).toBe(0);
    expect(await readFile(settingsFile, "utf8")).toBe(original);
  });

  test("creates and removes a missing settings file safely", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vscode-mods-settings-new-"));
    temporaryRoots.push(root);
    const settingsFile = path.join(root, "User", "settings.json");
    const stateRoot = path.join(root, "state");
    const logger = memoryLogger();

    const applied = await runMods({
      selectedIds: ["disable-vscode-native-chat"],
      modsRoot,
      settingsFiles: [settingsFile],
      stateRoot,
      logger,
    });
    expect(applied.failures).toBe(0);
    expect(Bun.JSONC.parse(await readFile(settingsFile, "utf8"))).toEqual({
      "chat.disableAIFeatures": true,
    });

    const restored = await runMods({
      selectedIds: ["disable-vscode-native-chat"],
      action: "restore",
      modsRoot,
      settingsFiles: [settingsFile],
      stateRoot,
      logger,
    });
    expect(restored.failures).toBe(0);
    await expect(access(settingsFile)).rejects.toThrow();
  });
});
