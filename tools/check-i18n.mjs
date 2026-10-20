#!/usr/bin/env node
// Verifies that every TIDY_RENOWN.* key used in src/ exists in every language
// file, that language files have identical key sets, and that Handlebars
// block helpers in templates are balanced.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "src");
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const langDir = join(src, "lang");
const langs = Object.fromEntries(
  readdirSync(langDir).map((f) => [
    f,
    new Set(flatten(JSON.parse(readFileSync(join(langDir, f), "utf8")))),
  ]),
);

const [base, ...others] = Object.keys(langs);
for (const other of others) {
  for (const k of langs[base]) if (!langs[other].has(k)) errors.push(`${other} missing ${k}`);
  for (const k of langs[other]) if (!langs[base].has(k)) errors.push(`${base} missing ${k}`);
}

const files = walk(src).filter((f) => /\.(ts|hbs)$/.test(f));
const used = new Set();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/["'`](TIDY_RENOWN\.[A-Za-z0-9_.]+?)(["'`]|\$\{)/g)) {
    const key = m[1];
    // Keys built at runtime (`TIDY_RENOWN.Faction.Kind.${kind}`) are checked by prefix.
    if (m[2] === "${") {
      const prefix = key;
      for (const [lang, keys] of Object.entries(langs)) {
        if (![...keys].some((k) => k.startsWith(prefix))) {
          errors.push(`${lang}: no keys for dynamic prefix ${prefix}`);
        }
      }
      continue;
    }
    used.add(key);
  }
}
for (const key of used) {
  for (const [lang, keys] of Object.entries(langs)) {
    if (!keys.has(key)) errors.push(`${lang}: key used in code but missing: ${key}`);
  }
}

for (const file of files.filter((f) => f.endsWith(".hbs"))) {
  const text = readFileSync(file, "utf8");
  const stack = [];
  for (const m of text.matchAll(/{{([#/])(\w+)[^}]*}}|{{else[^}]*}}/g)) {
    if (!m[1]) continue;
    if (m[1] === "#") stack.push(m[2]);
    else if (stack.pop() !== m[2]) errors.push(`${file}: unbalanced {{/${m[2]}}}`);
  }
  if (stack.length) errors.push(`${file}: unclosed blocks ${stack.join(", ")}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`i18n OK: ${used.size} keys used, ${Object.keys(langs).length} languages in sync.`);
