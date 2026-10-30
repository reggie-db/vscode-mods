import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  constants as fsConstants,
  mkdirSync,
} from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const STATE_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 1;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createLogger(logFile, output = console) {
  const write = (level, message) => {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
    output[method](line);

    if (logFile) {
      try {
        mkdirSync(path.dirname(logFile), { recursive: true });
        appendFileSync(logFile, `${line}\n`, "utf8");
      } catch {}
    }
  };

  return {
    info(message) {
      write("info", message);
    },
    warn(message) {
      write("warn", message);
    },
    error(message) {
      write("error", message);
    },
  };
}

export function defaultStateRoot({
  environment = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  if (environment.VSCODE_MODS_STATE_DIR) {
    return path.resolve(environment.VSCODE_MODS_STATE_DIR);
  }

  if (platform === "win32") {
    return path.join(
      environment.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "vscode-mods",
    );
  }

  return path.join(
    environment.XDG_STATE_HOME || path.join(home, ".local", "state"),
    "vscode-mods",
  );
}

export function defaultExtensionRoots({
  environment = process.env,
  home = homedir(),
} = {}) {
  const configured = [
    environment.VSCODE_EXTENSIONS_DIR,
    environment.VSCODE_INSIDERS_EXTENSIONS_DIR,
  ].filter(Boolean);
  const portable = environment.VSCODE_PORTABLE
    ? [path.join(environment.VSCODE_PORTABLE, "data", "extensions")]
    : [];

  return uniquePaths([
    ...configured,
    ...portable,
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".vscode-insiders", "extensions"),
  ]);
}

function uniquePaths(values) {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function assertString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function validateManifest(value, directoryName) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("mod.json must contain an object.");
  }
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}.`);
  }
  assertString(value.id, "id");
  assertString(value.name, "name");
  assertString(value.description, "description");
  if (value.id !== directoryName) {
    throw new Error(`id must match its folder name (${directoryName}).`);
  }
  if (value.extension == null || typeof value.extension !== "object") {
    throw new Error("extension must be an object.");
  }
  assertString(value.extension.id, "extension.id");
  assertString(value.extension.directoryPrefix, "extension.directoryPrefix");
  if (!Array.isArray(value.operations) || value.operations.length === 0) {
    throw new Error("operations must be a non-empty array.");
  }

  for (const [index, operation] of value.operations.entries()) {
    const prefix = `operations[${index}]`;
    if (operation == null || typeof operation !== "object") {
      throw new Error(`${prefix} must be an object.`);
    }
    assertString(operation.fileGlob, `${prefix}.fileGlob`);
    if (
      operation.syntax != null &&
      operation.syntax !== "javascript"
    ) {
      throw new Error(`${prefix}.syntax must be "javascript" when provided.`);
    }
    if (
      !Array.isArray(operation.requiredContains) ||
      !operation.requiredContains.every((entry) => typeof entry === "string")
    ) {
      throw new Error(`${prefix}.requiredContains must be an array of strings.`);
    }
    assertString(operation.alreadyAppliedMarker, `${prefix}.alreadyAppliedMarker`);
    if (operation.regex == null || typeof operation.regex !== "object") {
      throw new Error(`${prefix}.regex must be an object.`);
    }
    assertString(operation.regex.pattern, `${prefix}.regex.pattern`);
    if (typeof operation.regex.replacement !== "string") {
      throw new Error(`${prefix}.regex.replacement must be a string.`);
    }
    if (!Number.isInteger(operation.regex.expectedMatches)) {
      throw new Error(`${prefix}.regex.expectedMatches must be an integer.`);
    }
    if (
      operation.regex.flags != null &&
      !/^[imsu]*$/.test(operation.regex.flags)
    ) {
      throw new Error(`${prefix}.regex.flags contains unsupported flags.`);
    }
  }

  return value;
}

export async function discoverMods(modsRoot, logger) {
  let entries;
  try {
    entries = await readdir(modsRoot, { withFileTypes: true });
  } catch (error) {
    logger.error(`Cannot read mods directory ${modsRoot}: ${error.message}`);
    return { mods: [], failures: 1 };
  }

  const mods = [];
  let failures = 0;
  const directories = entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of directories) {
    const manifestPath = path.join(modsRoot, entry.name, "mod.json");
    try {
      const manifest = validateManifest(
        JSON.parse(await readFile(manifestPath, "utf8")),
        entry.name,
      );
      mods.push({ directory: path.dirname(manifestPath), manifest });
    } catch (error) {
      failures += 1;
      logger.error(`Skipping mod ${entry.name}: ${error.message}`);
    }
  }

  return { mods, failures };
}

function versionParts(directoryName, prefix) {
  return directoryName
    .slice(prefix.length)
    .split(/\D+/)
    .filter(Boolean)
    .map(Number);
}

function compareExtensionVersions(left, right, prefix) {
  const leftParts = versionParts(left, prefix);
  const rightParts = versionParts(right, prefix);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return right.localeCompare(left);
}

export async function findExtensionDirectories(manifest, extensionRoots) {
  const directories = [];
  for (const root of uniquePaths(extensionRoots)) {
    if (!(await isDirectory(root))) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const matching = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(manifest.extension.directoryPrefix),
      )
      .map((entry) => entry.name)
      .sort((left, right) =>
        compareExtensionVersions(
          left,
          right,
          manifest.extension.directoryPrefix,
        ),
      );
    if (matching[0]) {
      directories.push(path.join(root, matching[0]));
    }
  }
  return directories;
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*").replaceAll("?", ".")}$`);
}

async function findOperationFiles(extensionRoot, fileGlob) {
  const normalized = fileGlob.replaceAll("\\", "/");
  const directory = path.join(
    extensionRoot,
    ...path.posix.dirname(normalized).split("/"),
  );
  const matcher = wildcardToRegExp(path.posix.basename(normalized));
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function createGlobalRegex(pattern, flags = "") {
  return new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
}

function createReplaceRegex(pattern, flags = "") {
  return new RegExp(pattern, flags);
}

function stateFilePath(stateRoot) {
  return path.join(stateRoot, "state.json");
}

async function readState(stateRoot, logger) {
  const statePath = stateFilePath(stateRoot);
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    if (
      parsed?.schemaVersion === STATE_SCHEMA_VERSION &&
      parsed.mods != null &&
      typeof parsed.mods === "object"
    ) {
      return parsed;
    }
    logger.warn(`Ignoring invalid state file ${statePath}.`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger.warn(`Ignoring unreadable state file ${statePath}: ${error.message}`);
    }
  }
  return { schemaVersion: STATE_SCHEMA_VERSION, mods: {} };
}

async function atomicWrite(targetPath, content, mode) {
  const temporaryPath = `${targetPath}.vscode-mods-${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, { mode });
  if (mode != null) {
    await chmod(temporaryPath, mode);
  }
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function writeState(stateRoot, state) {
  await mkdir(stateRoot, { recursive: true });
  await atomicWrite(
    stateFilePath(stateRoot),
    `${JSON.stringify(state, null, 2)}\n`,
    0o600,
  );
}

function rememberTarget(state, modId, record) {
  const mod = (state.mods[modId] ??= { targets: {} });
  mod.targets[record.file] = record;
}

async function ensureBackup(file, content, hash, modId, stateRoot) {
  const backupDirectory = path.join(
    stateRoot,
    "backups",
    modId,
    sha256(path.resolve(file)).slice(0, 16),
  );
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(file)}.${hash.slice(0, 12)}.bak`,
  );
  try {
    await copyFile(file, backupPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    const existingHash = sha256(await readFile(backupPath));
    if (existingHash !== hash) {
      throw new Error(`Existing backup does not match ${file}.`);
    }
  }
  if (sha256(await readFile(backupPath)) !== hash || sha256(content) !== hash) {
    throw new Error(`Backup verification failed for ${file}.`);
  }
  return backupPath;
}

async function planOperations({ mod, extensionRoot }) {
  const stagedFiles = new Map();

  for (const operation of mod.operations) {
    const candidates = await findOperationFiles(
      extensionRoot,
      operation.fileGlob,
    );
    const matching = [];
    for (const candidate of candidates) {
      const staged = stagedFiles.get(candidate);
      const content = staged?.patched ?? await readFile(candidate, "utf8");
      if (operation.requiredContains.every((marker) => content.includes(marker))) {
        matching.push({ file: candidate, content });
      }
    }

    if (matching.length !== 1) {
      throw new Error(
        `${mod.id}: expected one matching ${operation.fileGlob} in ${extensionRoot}, found ${matching.length}.`,
      );
    }

    const { file, content } = matching[0];
    let staged = stagedFiles.get(file);
    if (!staged) {
      staged = {
        file,
        content,
        patched: content,
        fileMode: (await stat(file)).mode,
      };
      stagedFiles.set(file, staged);
    }

    if (content.includes(operation.alreadyAppliedMarker)) {
      continue;
    }

    const matchCount = [
      ...content.matchAll(
        createGlobalRegex(operation.regex.pattern, operation.regex.flags),
      ),
    ].length;
    if (matchCount !== operation.regex.expectedMatches) {
      throw new Error(
        `${mod.id}: expected ${operation.regex.expectedMatches} patch match(es) in ${file}, found ${matchCount}.`,
      );
    }

    const patched = content.replace(
      createReplaceRegex(operation.regex.pattern, operation.regex.flags),
      operation.regex.replacement,
    );
    if (
      patched === content ||
      !patched.includes(operation.alreadyAppliedMarker) ||
      patched.split(operation.alreadyAppliedMarker).length - 1 !== 1
    ) {
      throw new Error(`${mod.id}: patched output validation failed for ${file}.`);
    }
    if (operation.syntax === "javascript") {
      try {
        new Bun.Transpiler({ loader: "js" }).transformSync(patched);
      } catch (error) {
        throw new Error(`${mod.id}: JavaScript validation failed for ${file}: ${error.message}`);
      }
    }
    staged.patched = patched;
  }

  return [...stagedFiles.values()].map((plan) =>
    plan.patched === plan.content
      ? { kind: "unchanged", file: plan.file }
      : {
          kind: "patch",
          ...plan,
          originalHash: sha256(plan.content),
          patchedHash: sha256(plan.patched),
        },
  );
}

async function commitPlans({
  mod,
  plans,
  state,
  stateRoot,
  logger,
  dryRun,
}) {
  const patchPlans = plans.filter((plan) => plan.kind === "patch");
  const unchangedPlans = plans.filter((plan) => plan.kind === "unchanged");
  for (const plan of unchangedPlans) {
    logger.info(`${mod.id}: already applied to ${plan.file}`);
  }

  if (dryRun) {
    for (const plan of patchPlans) {
      logger.info(`${mod.id}: would patch ${plan.file}`);
    }
    return { applied: 0, unchanged: plans.length };
  }

  const committed = [];
  const previousRecords = new Map(
    patchPlans.map((plan) => [
      plan.file,
      state.mods[mod.id]?.targets?.[plan.file],
    ]),
  );
  try {
    for (const plan of patchPlans) {
      if (sha256(await readFile(plan.file)) !== plan.originalHash) {
        throw new Error(`${plan.file} changed after it was validated`);
      }

      const previous = previousRecords.get(plan.file);
      let backup;
      let stateOriginalHash;
      if (previous) {
        if (previous.patchedHash !== plan.originalHash) {
          throw new Error(
            `${plan.file} does not match the previously applied mod state`,
          );
        }
        const previousBackup = await readFile(previous.backup);
        if (sha256(previousBackup) !== previous.originalHash) {
          throw new Error(`Existing backup does not match ${plan.file}.`);
        }
        backup = previous.backup;
        stateOriginalHash = previous.originalHash;
      } else {
        backup = await ensureBackup(
          plan.file,
          plan.content,
          plan.originalHash,
          mod.id,
          stateRoot,
        );
        stateOriginalHash = plan.originalHash;
      }
      await atomicWrite(plan.file, plan.patched, plan.fileMode);
      if (sha256(await readFile(plan.file)) !== plan.patchedHash) {
        throw new Error(`post-write verification failed for ${plan.file}`);
      }
      committed.push({ ...plan, backup, stateOriginalHash });
    }

    for (const plan of committed) {
      rememberTarget(state, mod.id, {
        file: plan.file,
        backup: plan.backup,
        originalHash: plan.stateOriginalHash,
        patchedHash: plan.patchedHash,
        appliedAt: new Date().toISOString(),
      });
    }
    await writeState(stateRoot, state);
  } catch (error) {
    let rollbackFailed = false;
    for (const plan of committed.reverse()) {
      try {
        await atomicWrite(plan.file, plan.content, plan.fileMode);
      } catch (rollbackError) {
        rollbackFailed = true;
        logger.error(
          `${mod.id}: rollback failed for ${plan.file}: ${rollbackError.message}`,
        );
      }
    }
    for (const plan of committed) {
      const previous = previousRecords.get(plan.file);
      if (previous === undefined) {
        delete state.mods[mod.id]?.targets?.[plan.file];
      } else {
        state.mods[mod.id].targets[plan.file] = previous;
      }
    }
    throw new Error(
      `${mod.id}: apply failed and ${rollbackFailed ? "rollback was incomplete" : "all changes were rolled back"}: ${error.message}`,
    );
  }

  for (const plan of committed) {
    logger.info(`${mod.id}: patched ${plan.file}`);
  }
  return { applied: committed.length, unchanged: unchangedPlans.length };
}

async function restoreMod({ mod, state, stateRoot, logger, dryRun }) {
  const records = Object.values(state.mods[mod.id]?.targets ?? {});
  if (records.length === 0) {
    logger.info(`${mod.id}: no recorded patches to restore`);
    return { restored: 0, unchanged: 1, failures: 0 };
  }

  let restored = 0;
  let unchanged = 0;
  let failures = 0;
  for (const record of records) {
    try {
      if (!(await isFile(record.file)) || !(await isFile(record.backup))) {
        throw new Error("target or backup is missing");
      }
      const current = await readFile(record.file);
      if (sha256(current) !== record.patchedHash) {
        throw new Error(
          "target changed after the mod was applied; refusing to overwrite it",
        );
      }
      const backup = await readFile(record.backup);
      if (sha256(backup) !== record.originalHash) {
        throw new Error("backup checksum does not match the recorded original");
      }
      if (dryRun) {
        logger.info(`${mod.id}: would restore ${record.file}`);
        unchanged += 1;
        continue;
      }
      await atomicWrite(record.file, backup, (await stat(record.file)).mode);
      if (sha256(await readFile(record.file)) !== record.originalHash) {
        throw new Error("restored file failed checksum verification");
      }
      delete state.mods[mod.id].targets[record.file];
      restored += 1;
      logger.info(`${mod.id}: restored ${record.file}`);
    } catch (error) {
      failures += 1;
      logger.error(`${mod.id}: could not restore ${record.file}: ${error.message}`);
    }
  }

  if (!dryRun) {
    try {
      await writeState(stateRoot, state);
    } catch (error) {
      logger.warn(`${mod.id}: restore state could not be saved: ${error.message}`);
    }
  }
  return { restored, unchanged, failures };
}

export async function runMods({
  action = "apply",
  modsRoot,
  extensionRoots = defaultExtensionRoots(),
  stateRoot = defaultStateRoot(),
  selectedIds = [],
  dryRun = false,
  logger = createLogger(path.join(stateRoot, "vscode-mods.log")),
} = {}) {
  const discovered = await discoverMods(modsRoot, logger);
  const selected = new Set(selectedIds);
  const mods =
    selected.size === 0
      ? discovered.mods
      : discovered.mods.filter(({ manifest }) => selected.has(manifest.id));
  let failures = discovered.failures;

  for (const id of selected) {
    if (!mods.some(({ manifest }) => manifest.id === id)) {
      failures += 1;
      logger.error(`Requested mod ${id} was not found.`);
    }
  }

  if (action === "list") {
    for (const { manifest } of mods) {
      logger.info(`${manifest.id}: ${manifest.description}`);
    }
    return { applied: 0, restored: 0, unchanged: mods.length, failures };
  }

  const state = await readState(stateRoot, logger);
  let applied = 0;
  let restored = 0;
  let unchanged = 0;

  for (const { manifest: mod } of mods) {
    if (action === "restore") {
      const result = await restoreMod({
        mod,
        state,
        stateRoot,
        logger,
        dryRun,
      });
      restored += result.restored;
      unchanged += result.unchanged;
      failures += result.failures;
      continue;
    }

    const extensionDirectories = await findExtensionDirectories(
      mod,
      extensionRoots,
    );
    if (extensionDirectories.length === 0) {
      failures += 1;
      logger.error(
        `${mod.id}: ${mod.extension.id} was not found in ${extensionRoots.join(", ")}`,
      );
      continue;
    }

    for (const extensionRoot of extensionDirectories) {
      try {
        const plans = await planOperations({ mod, extensionRoot });
        const result = await commitPlans({
          mod,
          plans,
          state,
          stateRoot,
          logger,
          dryRun,
        });
        applied += result.applied;
        unchanged += result.unchanged;
      } catch (error) {
        failures += 1;
        logger.error(error.message);
      }
    }
  }

  logger.info(
    `Summary: ${applied} applied, ${restored} restored, ${unchanged} unchanged, ${failures} failed.`,
  );
  return { applied, restored, unchanged, failures };
}
