/**
 * The one place randomness enters Recommendation V1's ranking. Every other
 * function in lib/recommendation/* is a pure function of its explicit
 * arguments — no hidden Math.random() calls scattered through scoring or
 * jitter logic. Ranking always takes randomness as an injected seeded
 * source, so the same seed + same candidates + same signals always produces
 * the same output (deterministic and testable), while a real refresh simply
 * picks a fresh seed to get a genuinely different — but still bounded —
 * ordering.
 */

/**
 * A small, deterministic seeded pseudo-random generator (mulberry32). Given
 * the same seed, the returned function always produces the exact same
 * sequence of numbers in [0, 1) on repeated calls.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function random(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks a fresh ranking-generation seed — the one sanctioned Math.random()
 * call site in the whole recommendation module. Called once per ranking
 * generation (initial Explore load, and again whenever the user refreshes —
 * see useExploreFeed's refresh()), never per-post and never inside score.ts
 * or jitter.ts themselves.
 */
export function pickRankingSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
