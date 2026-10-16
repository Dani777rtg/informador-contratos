import { warmup } from "./warmup";
import { ask, type Reply } from "./api";
import { loadState, saveState } from "./session";
import { renderWhatsappForm } from "./whatsapp";
import { renderReply, renderError } from "./render";
import { initVoice, type VoiceState } from "./voice";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = $<HTMLInputElement>("q");
const status = $("status");
const answer = $("answer");

const KEY = "privacy-accepted";
const accepted = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const privacy = $("privacy");
privacy.hidden = accepted();
$("accept").addEventListener("click", () => {
  try { localStorage.setItem(KEY, "1"); } catch { /* sin almacenamiento: se vuelve a mostrar */ }
  privacy.hidden = true;
  q.focus();
});
$("privacy-link").addEventListener("click", (e) => { e.preventDefault(); privacy.hidden = false; });

let state = loadState();
async function send(message: string): Promise<void> {
  const text = message.trim();
  if (!text) return;
  if (voice.sendText(text)) return; // voz activa: misma conversación del Voice Agent
  status.className = "status";
  status.textContent = "Buscando en SECOP…";
  answer.replaceChildren();
  try {
    const r: Reply = await ask(text, state);
    state = r.state;
    saveState(state);
    status.textContent = "";
    $("examples").hidden = true;
    renderReply(answer, r, (t) => void send(t));
    if (state && r.cards?.some((k) => k.kind === "contract")) { const h = document.createElement("div"); answer.append(h); renderWhatsappForm(h, () => state); }
  } catch {
    status.className = "status error";
    status.textContent = renderError();
  }
}

$("ask").addEventListener("submit", (e) => { e.preventDefault(); void send(q.value); q.value = ""; });
$("examples").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (b) void send(b.textContent ?? "");
});

// Voz: subtítulos y respuestas van al mismo historial (#answer) que el chat de texto.
const LABEL: Record<VoiceState, string> = { off: "", listening: "Escuchando…", processing: "Procesando…", speaking: "Hablando…", paused: "En pausa" };
const mic = $<HTMLButtonElement>("mic");
const stop = $<HTMLButtonElement>("stop");
const subs = $("subtitles");
const level = $<HTMLMeterElement>("level");
const voice = initVoice({
  onUser: (t) => { subs.textContent = `Tú: ${t}`; const p = document.createElement("p"); p.className = "sub"; p.textContent = `Tú: ${t}`; answer.append(p); },
  onAgent: (t, cards) => { subs.textContent = `Agente: ${t}`; $("examples").hidden = true; renderReply(answer, { text: t, cards, state: state ?? "" }, (q) => void send(q)); },
  onState: (s) => {
    mic.dataset.state = s;
    mic.setAttribute("aria-pressed", String(s !== "off"));
    stop.hidden = s === "off";
    stop.textContent = s === "speaking" || s === "processing" ? "Interrumpir" : s === "paused" ? "Reanudar micrófono" : "Silenciar";
    status.className = "status";
    status.textContent = LABEL[s];
  },
  onLevel: (l) => { level.value = Math.min(1, l * 4); },
  onNotice: (t) => { status.className = "status error"; status.textContent = t; },
});
mic.addEventListener("click", () => {
  const on = mic.getAttribute("aria-pressed") !== "true";
  voice.toggle(on);
  document.dispatchEvent(new CustomEvent("mic-toggle", { detail: on }));
});
stop.addEventListener("click", () => voice.interruptOrMute());

warmup();
document.addEventListener("mic-toggle", () => warmup());
