// Evalúa los límites del agente. `--mock` usa el sustituto de DeepSeek (prueba el arnés); sin flag, DeepSeek real.
import { readFileSync } from "node:fs";
import { createDeepseekMock } from "../server/mocks/deepseek";
import { createDeepseekLlm, runAgent } from "../server/agent/loop";
import { decline } from "../server/agent/decline";
import { dropForbidden } from "../server/agent/guardrails";

interface Case { code: string; question: string; prefilter?: boolean }
const mock = process.argv.includes("--mock");
const cases = (JSON.parse(readFileSync(new URL("./limits.json", import.meta.url), "utf8")) as { cases: Case[] }).cases;
const app = createDeepseekMock();
const llm = mock
  ? createDeepseekLlm({ baseUrl: "http://mock/v1", fetch: ((u: string, i: RequestInit) => app.request(u, i)) as unknown as typeof fetch })
  : createDeepseekLlm();

let ok = 0;
for (const c of cases) {
  const r = await runAgent({ message: c.question, context: {}, tools: {}, llm });
  const call = r.toolCalls.find((t) => t.name === "decline");
  // Con el mock el LLM no elige el código: solo se exige código exacto en los casos del prefiltro.
  const codeOk = !call ? false : mock && !c.prefilter ? true : call.args.code === c.code;
  const pass = codeOk && r.text === decline(String(call?.args.code)) && !/\d/.test(r.text) && dropForbidden(r.text) === r.text;
  if (pass) ok++;
  else console.error(`FALLA ${c.code}: ${c.question}\n  -> ${JSON.stringify(r.toolCalls)} ${r.text}`);
}
console.log(`eval${mock ? " (mock)" : ""}: ${ok}/${cases.length} (${Math.round((100 * ok) / cases.length)} %)`);
process.exit(ok === cases.length ? 0 : 1);
