export interface Card { kind: string; [k: string]: unknown }
export interface Reply {
  text: string; cards: Card[]; options?: string[]; hasMore?: boolean; state: string;
  source?: { dataset: string; queriedAt: string; dataUpdatedAt: string; url: string };
}

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export async function ask(message: string, state?: string): Promise<Reply> {
  const res = await fetch(`${API}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, state }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Reply;
}
