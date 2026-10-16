import type { Card, Reply } from "./api";

const MAX = 5;
const el = (tag: string, text?: string, cls?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const s = (v: unknown): string => (v == null ? "" : String(v));

function cardText(c: Card): string {
  switch (c.kind) {
    case "contract": return [c.entity, c.contractor, c.object, c.value, c.signedAt, c.status].map(s).filter(Boolean).join(" · ");
    case "spend": return `${s(c.category)}: ${s(c.total)} (${s(c.count)} contratos)`;
    case "funding": return `${s(c.source)}: ${s(c.total)}`;
    case "top": return `${s(c.rank)}. ${s(c.name)}: ${s(c.value)}`;
    case "detail": return `Valor ${s(c.value)} · facturado ${s(c.invoiced)} · pagado ${s(c.paid)} · pendiente ${s(c.pending)}`;
    default: return "";
  }
}

function cardItem(c: Card): HTMLElement {
  const li = el("li");
  const box = el("div", cardText(c), "card card--static");
  const url = typeof c.url === "string" && /^https?:\/\//.test(c.url) ? c.url : "";
  if (url) {
    const a = el("a", " Ver contrato") as HTMLAnchorElement;
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    box.append(a);
  }
  li.append(box);
  return li;
}

export function renderError(): string {
  return "No pude consultar ahora; intenta de nuevo en un momento.";
}

export function renderReply(root: HTMLElement, r: Reply, onAsk: (q: string) => void): void {
  root.replaceChildren(el("p", r.text));
  if (r.cards?.length) {
    const ul = el("ul", undefined, "cards");
    r.cards.forEach((c, i) => { const li = cardItem(c); li.hidden = i >= MAX; ul.append(li); });
    root.append(ul);
    if (r.cards.length > MAX || r.hasMore) {
      const more = el("button", "Ver más", "btn btn--outline") as HTMLButtonElement;
      more.type = "button";
      more.addEventListener("click", () => { ul.querySelectorAll("li[hidden]").forEach((li) => ((li as HTMLElement).hidden = false)); more.remove(); });
      root.append(more);
    }
  }
  if (r.source) {
    const d = el("details");
    d.append(el("summary", "Ver detalle"), el("p", `Fuente: ${r.source.dataset}. Consultado ${r.source.queriedAt}; datos actualizados ${r.source.dataUpdatedAt}.`));
    root.append(d);
  }
  const sugg = r.options?.length ? r.options : ["¿Y el año pasado?", "¿Cuál fue el contrato más grande?"];
  const ul = el("ul", undefined, "chips");
  for (const t of sugg.slice(0, 3)) {
    const li = el("li"), b = el("button", t, "card") as HTMLButtonElement;
    b.type = "button"; b.addEventListener("click", () => onAsk(t));
    li.append(b); ul.append(li);
  }
  root.append(ul);
}
