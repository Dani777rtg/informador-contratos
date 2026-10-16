export const MAX_AVG_TOKENS = 1500;

/** Tracks average LLM tokens per question (cache hits count as 0). */
export function createTokenBudget(max = MAX_AVG_TOKENS) {
  let total = 0, n = 0;
  return {
    add(tokens: number) { total += tokens; n++; },
    avg: () => (n ? total / n : 0),
    ok: () => (n ? total / n : 0) <= max,
  };
}
