#!/usr/bin/env node
// Creates a symlink from <Foundry Data>/modules/tidy-renown to ./dist for local development.
// Data path: FOUNDRY_DATA env var, or "dataPath" in foundryconfig.json (see foundryconfig.example.json).
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const MODULE_ID = "tidy-renown";
const root = resolve(import.meta.dirname, "..");
const configPath = join(root, "foundryconfig.json");

let dataPath = process.env.FOUNDRY_DATA;
if (!dataPath && existsSync(configPath)) {
  dataPath = JSON.parse(readFileSync(configPath, "utf8")).dataPath;
}
if (!dataPath) {
  console.error('Set FOUNDRY_DATA or create foundryconfig.json with { "dataPath": "..." }.');
  process.exit(1);
}

const modulesDir = join(dataPath, "modules");
const target = join(modulesDir, MODULE_ID);
const source = join(root, "dist");

mkdirSync(modulesDir, { recursive: true });
mkdirSync(source, { recursive: true });

if (existsSync(target) || isBrokenLink(target)) {
  if (!lstatSync(target).isSymbolicLink()) {
    console.error(`${target} exists and is not a symlink. Remove it manually first.`);
    process.exit(1);
  }
  rmSync(target);
}

symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
console.log(`Linked ${target} -> ${source}`);

function isBrokenLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
