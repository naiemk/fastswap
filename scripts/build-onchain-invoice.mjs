#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgRoot = join(root, "node_modules", "onchain-invoice");
const distIndex = join(pkgRoot, "dist", "index.js");
const sweepIndex = join(pkgRoot, "node-dist", "node", "sweep-node.js");
const invoiceArtifactsDest = join(root, "artifacts", "onchain-invoice", "contracts");

if (!existsSync(pkgRoot)) {
  console.log("[postinstall] onchain-invoice not installed; skipping build");
  process.exit(0);
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function pinnedInvoiceRef() {
  try {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const resolved = String(lock.packages?.["node_modules/onchain-invoice"]?.resolved ?? "");
    const lockHash = resolved.split("#")[1];
    if (lockHash) return lockHash;
  } catch {
    // fall through to package.json
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const spec = String(pkg.dependencies?.["onchain-invoice"] ?? "");
  return spec.split("#")[1] || undefined;
}

function cloneInvoiceSource(vendor, ref) {
  mkdirSync(dirname(vendor), { recursive: true });
  if (existsSync(vendor)) rmSync(vendor, { recursive: true, force: true });
  mkdirSync(vendor, { recursive: true });
  console.log(`[postinstall] cloning onchain-invoice source${ref ? ` @ ${ref}` : ""}…`);
  run(vendor, "git", ["init"]);
  run(vendor, "git", ["remote", "add", "origin", "https://github.com/naiemk/onchain-invoice.git"]);
  run(vendor, "git", ["fetch", "--depth", "1", "origin", ref ?? "HEAD"]);
  run(vendor, "git", ["checkout", "FETCH_HEAD"]);
}

function resolveSourceRoot() {
  const sibling = join(root, "..", "onchain-invoice");
  if (existsSync(join(sibling, "tsconfig.json"))) {
    return sibling;
  }
  const vendor = join(root, ".vendor", "onchain-invoice");
  if (!existsSync(join(vendor, "tsconfig.json"))) {
    cloneInvoiceSource(vendor, pinnedInvoiceRef());
  }
  return vendor;
}

const needsSdk = !existsSync(distIndex) || !existsSync(sweepIndex);
const needsArtifacts = !existsSync(invoiceArtifactsDest);
if (!needsSdk && !needsArtifacts) {
  console.log("[postinstall] onchain-invoice ready");
  process.exit(0);
}

const sourceRoot = resolveSourceRoot();
console.log(`[postinstall] building onchain-invoice from ${sourceRoot}`);

if (!existsSync(join(sourceRoot, "node_modules"))) {
  // Skip lifecycle scripts: esbuild's install.js otherwise picks up the parent
  // tree's binary (`--omit=optional` left it without @esbuild/<platform>).
  run(sourceRoot, "npm", ["ci", "--ignore-scripts"]);
}

if (needsSdk) {
  run(sourceRoot, "npx", ["tsc", "-p", "tsconfig.json"]);
  run(sourceRoot, "npx", ["tsc", "-p", "node/tsconfig.json"]);
  for (const dir of ["dist", "node-dist"]) {
    const from = join(sourceRoot, dir);
    const to = join(pkgRoot, dir);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
}

if (needsArtifacts) {
  const invoiceArtifactsSrc = join(sourceRoot, "artifacts", "contracts");
  if (!existsSync(invoiceArtifactsSrc)) {
    run(sourceRoot, "npx", ["hardhat", "compile"]);
  }
  if (existsSync(invoiceArtifactsSrc)) {
    rmSync(invoiceArtifactsDest, { recursive: true, force: true });
    mkdirSync(dirname(invoiceArtifactsDest), { recursive: true });
    cpSync(invoiceArtifactsSrc, invoiceArtifactsDest, { recursive: true });
  } else {
    console.error("[postinstall] missing onchain-invoice contract artifacts");
    process.exit(1);
  }
}

console.log("[postinstall] onchain-invoice ready");
