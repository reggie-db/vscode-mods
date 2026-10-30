#!/usr/bin/env bun

import { stat } from "node:fs/promises";
import path from "node:path";
import packageJson from "../package.json" with { type: "json" };
import {
  createLogger,
  defaultExtensionRoots,
  defaultSettingsFiles,
  defaultStateRoot,
  runMods,
} from "./core.mjs";

const VERSION = packageJson.version;
const COMMANDS = new Set(["apply", "restore", "list"]);

function usage() {
  return `vscode-mods ${VERSION}

Usage:
  vscode-mods [apply|restore|list] [mod-id ...] [options]

Options:
  --mods-dir PATH        Use a custom mods directory
  --extensions-dir PATH  Add a VS Code extensions directory (repeatable)
  --settings-file PATH   Add a VS Code user settings file (repeatable)
  --state-dir PATH       Store logs and restore state in PATH
  --dry-run              Validate and report without changing files
  --strict               Exit non-zero when any mod fails
  --help                 Show this help
  --version              Show the version

Without a command, all mod folders are applied. Failures are logged and the
default exit code remains zero so this tool cannot prevent VS Code startup.
`;
}

function parseArguments(argv) {
  const options = {
    action: "apply",
    selectedIds: [],
    extensionRoots: [],
    settingsFiles: [],
    modsRoot: undefined,
    stateRoot: undefined,
    dryRun: false,
    strict: false,
  };
  let commandSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--version") {
      options.version = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--strict") {
      options.strict = true;
    } else if (argument === "--mods-dir") {
      options.modsRoot = requireValue(argv, ++index, argument);
    } else if (argument === "--extensions-dir") {
      options.extensionRoots.push(requireValue(argv, ++index, argument));
    } else if (argument === "--settings-file") {
      options.settingsFiles.push(requireValue(argv, ++index, argument));
    } else if (argument === "--state-dir") {
      options.stateRoot = requireValue(argv, ++index, argument);
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!commandSeen && COMMANDS.has(argument)) {
      options.action = argument;
      commandSeen = true;
    } else {
      options.selectedIds.push(argument);
    }
  }

  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

async function directoryExists(value) {
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveModsRoot(explicit) {
  if (explicit) {
    return path.resolve(explicit);
  }
  if (process.env.VSCODE_MODS_DIR) {
    return path.resolve(process.env.VSCODE_MODS_DIR);
  }

  const executableDirectory = path.dirname(process.execPath);
  const candidates = [
    path.join(executableDirectory, "mods"),
    path.join(executableDirectory, "..", "mods"),
    path.resolve(import.meta.dirname, "..", "mods"),
  ];
  for (const candidate of candidates) {
    if (await directoryExists(candidate)) {
      return candidate;
    }
  }
  return candidates.at(-1);
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`[vscode-mods] ${error.message}`);
    console.log(usage());
    return 0;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.version) {
    console.log(VERSION);
    return 0;
  }

  const stateRoot = path.resolve(options.stateRoot ?? defaultStateRoot());
  const logger = createLogger(path.join(stateRoot, "vscode-mods.log"));
  try {
    const result = await runMods({
      action: options.action,
      modsRoot: await resolveModsRoot(options.modsRoot),
      extensionRoots:
        options.extensionRoots.length > 0
          ? options.extensionRoots.map((root) => path.resolve(root))
          : defaultExtensionRoots(),
      settingsFiles:
        options.settingsFiles.length > 0
          ? options.settingsFiles.map((file) => path.resolve(file))
          : defaultSettingsFiles(),
      stateRoot,
      selectedIds: options.selectedIds,
      dryRun: options.dryRun,
      logger,
    });
    return options.strict && result.failures > 0 ? 1 : 0;
  } catch (error) {
    logger.error(`Unexpected failure: ${error.message}`);
    return options.strict ? 1 : 0;
  }
}

process.exitCode = await main();
