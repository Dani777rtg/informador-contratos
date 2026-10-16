import { startCapture, type Capture } from "./capture";
import { createPlayer } from "./player";
import type { Card } from "../api";

export type VoiceState = "off" | "listening" | "processing" | "speaking" | "paused";
export interface VoiceUi {
  /** Texto dicho por el usuario (transcripción final) -> historial del chat. */
  onUser(text: string): void;
  /** Respuesta del agente (mismo contenido que se habla) -> historial del chat. */
  onAgent(text: string, cards: Card[]): void;
  onState(s: VoiceState): void;
  onLevel(l: number): void;
  onNotice(text: string): void;
}

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const FAIL = "No pude activar la voz; seguimos por texto.";

export function initVoice(ui: VoiceUi) {
  let ws: WebSocket | null = null;
  let cap: Capture | null = null;
  let paused = false;
  let state: VoiceState = "off";
  let eotAt = 0; // fin de turno visto por el cliente: base de la latencia percibida
  const set = (s: VoiceState) => { if (s !== state) { state = s; ui.onState(s); } };
  const idle = () => { if (state !== "off") set(paused ? "paused" : "listening"); };
  const player = createPlayer(idle);

  function stopAll(notice?: string) {
    cap?.stop(); cap = null;
    ws?.close(); ws = null;
    player.close();
    paused = false; set("off"); ui.onLevel(0);
    if (notice) ui.onNotice(notice);
  }

  function onJson(raw: string) {
    let m: { type?: string; text?: string; cards?: Card[] };
    try { m = JSON.parse(raw) as typeof m; } catch { return; }
    if (m.type === "transcript" && m.text) { eotAt = performance.now(); ui.onUser(m.text); set("processing"); }
    else if (m.type === "message" && m.text) ui.onAgent(m.text, m.cards ?? []);
    else if (m.type === "interrupt") { player.flush(); idle(); }
    else if (m.type === "notice" && m.text) { stopAll(m.text); }
  }

  async function start() {
    try {
      const r = await fetch(`${API}/session`, { method: "POST" });
      if (!r.ok) throw new Error();
      const { token } = (await r.json()) as { token: string };
      const base = API ? API.replace(/^http/, "ws") : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
      const sock = new WebSocket(`${base}/voice?token=${encodeURIComponent(token)}`);
      sock.binaryType = "arraybuffer";
      ws = sock;
      sock.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
        if (typeof e.data === "string") return onJson(e.data);
        if (eotAt) {
          document.dispatchEvent(new CustomEvent("voice-latency", { detail: Math.round(performance.now() - eotAt) }));
          eotAt = 0;
        }
        set("speaking"); player.push(e.data);
      };
      sock.onclose = () => { if (ws === sock) stopAll(FAIL); };
      await new Promise<void>((ok, fail) => { sock.onopen = () => ok(); sock.onerror = () => fail(new Error()); });
      cap = await startCapture((pcm) => { if (sock.readyState === WebSocket.OPEN) sock.send(pcm); }, ui.onLevel);
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
    sendText(text: string): boolean {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: "message", text }));
      return true;
    },
  };
}
