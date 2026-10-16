import { startCapture, type Capture } from "./capture";
import { createPlayer } from "./player";
import type { Card } from "../api";

export type VoiceState = "off" | "listening" | "processing" | "speaking" | "paused";
export interface VoiceUi {
  /** Lo dicho o escrito por el usuario -> historial del chat. */
  onUser(text: string): void;
  /** Respuesta del agente (subtítulo del audio) y las tarjetas que llegaron antes -> historial del chat. */
  onAgent(text: string, cards: Card[]): void;
  onState(s: VoiceState): void;
  onLevel(l: number): void;
  onNotice(text: string): void;
}

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const FAIL = "No pude activar la voz; seguimos por texto.";
const EARLY_FRAMES = 50; // 4 s de 80 ms: lo dicho mientras conecta no se pierde
const KEEPALIVE_MS = 10_000;

export function initVoice(ui: VoiceUi) {
  let ws: WebSocket | null = null;
  let cap: Capture | null = null;
  let keep: ReturnType<typeof setInterval> | undefined;
  let paused = false;
  let state: VoiceState = "off";
  let eotAt = 0; // fin de turno visto por el cliente: base de la latencia percibida
  let cards: Card[] = [];
  const asked = new Set<string>(); // lo escrito aquí: el eco ConversationText del agente no se repite
  const set = (s: VoiceState) => { if (s !== state) { state = s; ui.onState(s); } };
  const idle = () => { if (state !== "off") set(paused ? "paused" : "listening"); };
  const player = createPlayer(idle);

  function stopAll(notice?: string) {
    clearInterval(keep);
    cap?.stop(); cap = null;
    ws?.close(); ws = null;
    player.close();
    cards = []; asked.clear();
    paused = false; set("off"); ui.onLevel(0);
    if (notice) ui.onNotice(notice);
  }

  function onJson(raw: string) {
    let m: { type?: string; role?: string; content?: string; text?: string; cards?: Card[] };
    try { m = JSON.parse(raw) as typeof m; } catch { return; }
    switch (m.type) {
      case "ConversationText":
        if (!m.content) break;
        if (m.role === "user") {
          if (asked.delete(m.content)) break;
          eotAt = performance.now(); ui.onUser(m.content); set("processing");
        } else { ui.onAgent(m.content, cards); cards = []; }
        break;
      case "ToolResult": if (Array.isArray(m.cards)) cards.push(...m.cards); break;
      case "UserStartedSpeaking": player.flush(); idle(); break; // barge-in: se vacía el audio en cola
      case "AgentThinking": set("processing"); break;
      case "AgentStartedSpeaking": set("speaking"); break;
      case "AgentAudioDone": if (!player.playing()) idle(); break;
      case "Notice": if (m.text) ui.onNotice(m.text); break;
    }
  }

  async function start() {
    try {
      const early: ArrayBuffer[] = [];
      let sock: WebSocket | null = null;
      // El micrófono se abre primero (permiso) y es continuo; mientras conecta se guarda el audio.
      cap = await startCapture((pcm) => {
        if (sock?.readyState === WebSocket.OPEN) sock.send(pcm);
        else if (early.length < EARLY_FRAMES) early.push(pcm);
      }, ui.onLevel);
      const r = await fetch(`${API}/session`, { method: "POST" });
      if (!r.ok) throw new Error();
      const { token } = (await r.json()) as { token: string };
      const base = API ? API.replace(/^http/, "ws") : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
      const s = new WebSocket(`${base}/voice?token=${encodeURIComponent(token)}`);
      s.binaryType = "arraybuffer";
      sock = ws = s;
      s.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
        if (typeof e.data === "string") return onJson(e.data);
        if (eotAt) {
          document.dispatchEvent(new CustomEvent("voice-latency", { detail: Math.round(performance.now() - eotAt) }));
          eotAt = 0;
        }
        set("speaking"); player.push(e.data);
      };
      s.onclose = () => { if (ws === s) stopAll(FAIL); };
      await new Promise<void>((ok, fail) => { s.onopen = () => ok(); s.onerror = () => fail(new Error()); });
      for (const f of early.splice(0)) s.send(f);
      keep = setInterval(() => { if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: "KeepAlive" })); }, KEEPALIVE_MS);
      paused = false; set("listening");
    } catch {
      stopAll(FAIL);
    }
  }

  return {
    toggle(on: boolean): void { if (on) void start(); else stopAll(); },
    /** Botón Silenciar/Interrumpir: calla al agente si habla; si no, pausa o reanuda el micrófono. */
    interruptOrMute(): void {
      if (state === "speaking" || state === "processing") { player.flush(); return; }
      if (state === "off") return;
      paused = !paused; cap?.setPaused(paused); idle();
    },
    /** Con la voz activa, lo escrito entra a la misma conversación (AskText -> InjectUserMessage). */
    sendText(text: string): boolean {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      const t = text.slice(0, 500);
      ws.send(JSON.stringify({ type: "AskText", text: t }));
      asked.add(t.trim());
      eotAt = performance.now(); ui.onUser(t); set("processing");
      return true;
    },
  };
}
