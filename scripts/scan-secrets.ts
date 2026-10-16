import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RULES: [string, RegExp][] = [
  ["sk-key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["bearer", /\bBearer\s+[A-Za-z0-9._-]{20,}/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["env-secret", /^\s*[A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=[ \t]*["']?[A-Za-z0-9._-]{16,}/m],
];

export function scanText(text: string, _name?: string): { rule: string }[] {
  return RULES.filter(([, re]) => re.test(text)).map(([rule]) => ({ rule }));
}

const walk = (d: string): string[] =>
  !existsSync(d) ? [] : readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? (/^(node_modules|\.git|\.claude)$/.test(f) ? [] : walk(p)) : [p];
  });

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const files = [...["server", "scripts", "web", "docs", ".github"].flatMap(walk), ".env.example"]
    .filter((p) => existsSync(p) && /\.(ts|tsx|js|html|css|json|ya?ml|md|example)$/.test(p) && !p.endsWith("scan-secrets.ts"));
  let bad = 0;
  for (const f of files) for (const h of scanText(readFileSync(f, "utf8"), f)) { console.error(`${f}: ${h.rule}`); bad++; }
  process.exit(bad ? 1 : 0);
}