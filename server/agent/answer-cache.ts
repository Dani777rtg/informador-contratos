export interface Answer { text: string; tokens: number }
export interface Asked extends Answer { cached: boolean }

/** Same question (case/accents/punctuation-insensitive) in the same context => same key. */
export const cacheKey = (q: string, context = "") =>
  q.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim() + "|" + context;

export function createAnswerCache(llm: (q: string, context?: string) => Promise<Answer>) {
  const store = new Map<string, Answer>();
  // ponytail: unbounded, no TTL; add LRU/TTL if data can change between asks.
  return {
    async ask(q: string, context = ""): Promise<Asked> {
      const k = cacheKey(q, context);
      const hit = store.get(k);
      if (hit) return { text: hit.text, tokens: 0, cached: true };
      const a = await llm(q, context);
      store.set(k, a);
      return { ...a, cached: false };
    },
  };
}
