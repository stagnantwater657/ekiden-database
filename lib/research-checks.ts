// Shared offline primitives; never include user-supplied values in errors.
const fail = (path: string, reason: string): never => { throw new Error(`Research ${path}: ${reason}`); };
const obj = (value: unknown, keys: string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "expected object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) fail(path, "unknown field (do not store secrets or page dumps)");
  for (const key of keys) if (!(key in record)) fail(`${path}.${key}`, "required field");
  return record;
};
const str = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !value.trim()) return fail(path, "non-empty string required");
  if (/\b(?:Bearer\s+[\w.-]{8,}|gh[pousr]_[\w]{10,}|github_pat_[\w]{10,})/i.test(value)) fail(path, "possible credential");
  return value;
};
const arr = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) return fail(path, "array required");
  return value;
};
const date = (value: unknown, path: string): string => {
  const s = str(value, path);
  const timestamp = Date.parse(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== s)
    fail(path, "invalid calendar date");
  return s;
};
const oneOf = (value: unknown, choices: readonly unknown[], path: string) => {
  if (!choices.includes(value)) fail(path, "invalid enum");
};
// Named authentication parameters only: normal result IDs, years and pagination remain valid.
const credentialParameters = new Set([
  "token", "apikey", "api_key", "api-key", "password", "cookie", "authorization", "sig", "signature",
  "accesskeyid", "accesskeysecret", "awsaccesskeyid", "googleaccessid", "ossaccesskeyid", "key-pair-id", "policy",
]);
const isCredentialParameter = (key: string) => credentialParameters.has(key.toLowerCase()) ||
  /^(?:(?:access|refresh|id|security|session)[_-]?token|auth[_-]?(?:token|key))$/i.test(key) ||
  /^q-(?:signature|sign-algorithm|ak|key-time|sign-time|header-list|url-param-list)$/i.test(key) ||
  /^x-(?:amz|goog|oss|cos)-(?:signature|credential|security-token|algorithm|date|expires|signedheaders)$/i.test(key);
const url = (value: unknown, path: string): string => {
  const s = str(value, path);
  let u: URL;
  try { u = new URL(s); } catch { return fail(path, "invalid public source URL"); }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || !u.hostname.includes(".") ||
      /(^|\.)(?:localhost|example\.(?:com|org|net))$/.test(u.hostname) || /\.(?:invalid|test|local)$/.test(u.hostname) ||
      /^\[|^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ||
      [...u.searchParams.keys()].some(isCredentialParameter))
    fail(path, "invalid public source URL or credential parameter");
  // Fragments are locators, not a different source document.
  u.hash = "";
  return u.href;
};

export const researchChecks = { fail, obj, str, arr, date, oneOf, url };
