import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rewriteLock } from "../ops/npm-lock-registry.mjs";
const original = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
test("mirror every resolved tarball without changing versions or integrity", () => {
  const mirrored = rewriteLock(structuredClone(original), "https://registry.npmmirror.com");
  let count = 0;
  for (const [name, item] of Object.entries(mirrored.packages)) {
    assert.equal(item.version, original.packages[name].version);
    assert.equal(item.integrity, original.packages[name].integrity);
    if (item.resolved) {
      count++;
      assert.ok(item.resolved.startsWith("https://registry.npmmirror.com/"));
    }
  }
  assert.ok(count > 400);
});
test("official CI registry keeps every resolved URL unchanged", () => {
  assert.deepEqual(rewriteLock(structuredClone(original), "https://registry.npmjs.org"), original);
});
test("reject foreign URLs, credentials, links and missing integrity", () => {
  const key = Object.keys(original.packages).find(k => original.packages[k].resolved);
  for (const change of [
    { resolved: "https://github.com/other/package.tgz" },
    { resolved: "https://token@registry.npmjs.org/package.tgz" },
    { resolved: "http://registry.npmjs.org/package.tgz" },
    { resolved: "https://registry.npmjs.org/package.tgz?token=secret" },
    { link: true }, { integrity: "" },
  ]) {
    const lock = structuredClone(original);
    Object.assign(lock.packages[key], change);
    assert.throws(() => rewriteLock(lock, "https://registry.npmmirror.com"));
  }
});
