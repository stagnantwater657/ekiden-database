import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function rewriteLock(lock, registry) {
  if (!["https://registry.npmjs.org", "https://registry.npmmirror.com"].includes(registry)) {
    throw new Error("Unsupported npm registry");
  }
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error("Expected lockfile v3");
  for (const item of Object.values(lock.packages)) {
    if (item.link) throw new Error("Local linked dependencies are not allowed");
    if (item.resolved !== undefined) {
      const url = new URL(item.resolved);
      if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" ||
          url.port || url.username || url.password || url.search || url.hash ||
          !item.integrity || !/^sha(512|256|1)-[A-Za-z0-9+/=]+$/.test(item.integrity)) {
        throw new Error("Lockfile contains an unapproved URL or missing integrity");
      }
      item.resolved = registry + url.pathname;
    }
  }
  return lock;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  const result = rewriteLock(lock, process.argv[2]);
  fs.writeFileSync("package-lock.json", JSON.stringify(result, null, 2) + "\n");
}
