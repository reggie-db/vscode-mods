#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";

const targets = [
  ["bun-darwin-arm64", "vscode-mods-darwin-arm64"],
  ["bun-darwin-x64", "vscode-mods-darwin-x64"],
  ["bun-linux-arm64", "vscode-mods-linux-arm64"],
  ["bun-linux-x64", "vscode-mods-linux-x64"],
  ["bun-windows-arm64", "vscode-mods-windows-arm64.exe"],
  ["bun-windows-x64", "vscode-mods-windows-x64.exe"],
];

const outputDirectory = path.resolve("dist", "release-bin");
await mkdir(outputDirectory, { recursive: true });

for (const [target, filename] of targets) {
  const process = Bun.spawn(
    [
      "bun",
      "build",
      "--compile",
      `--target=${target}`,
      "src/cli.mjs",
      `--outfile=${path.join(outputDirectory, filename)}`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to build ${target}.`);
  }
}

