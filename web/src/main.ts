import { ask, type Reply } from "./api";
import { loadState, saveState } from "./session";
import { renderWhatsappForm } from "./whatsapp";
import { renderReply, renderError } from "./render";

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

// La voz (web/src/voice) escucha este evento; aquí solo se refleja el estado.
$("mic").addEventListener("click", (e) => {
  const mic = e.currentTarget as HTMLButtonElement;
  const on = mic.getAttribute("aria-pressed") !== "true";
  mic.setAttribute("aria-pressed", String(on));
  status.textContent = on ? "Escuchando…" : "";
  document.dispatchEvent(new CustomEvent("mic-toggle", { detail: on }));
});
