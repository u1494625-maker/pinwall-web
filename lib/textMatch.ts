/**
 * Deterministic, lightweight fuzzy-matching layer shared by Search
 * (lib/search.ts) and Tag Feed (components/TagFeedPage.tsx, via
 * lib/search.ts's rankPostsByTag) — no embeddings, no external service.
 *
 * Deliberately separate from lib/textTokens.ts: that file's tokenize() is
 * also used by score.ts/diversify.ts/interestProfile.ts for Explore's own
 * ranking/personalization, which must stay completely unaffected by this.
 * This module only changes what counts as "the query token matches this
 * field" — never what a stored tag/title/caption/tokenize() itself IS.
 */

// Small, conservative English pluralization stripper — not a real stemming
// algorithm, just enough to unify club/clubs, post/posts, box/boxes,
// match/matches, company/companies, without mangling short words or
// genuine double-s endings (class, glass) into nonsense.
export function lightStem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (/[sxz]es$/.test(word) || /(ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// Small, hardcoded, campus-app-relevant related-term clusters — deliberately
// tiny and deterministic, not a general thesaurus. Grouped so every term in
// a group is treated as related to every other term in that same group.
const SYNONYM_GROUPS: string[][] = [
  ["club", "org", "organization", "society"],
  ["cafe", "coffee", "coffeeshop"],
  ["gym", "fitness"],
  ["food", "eats", "restaurant"],
  ["study", "library"],
];

const SYNONYMS_BY_TERM = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYMS_BY_TERM.set(
      term,
      group.filter((other) => other !== term),
    );
  }
}

export type MatchTier = "exact" | "related";

/** Every distinct string worth testing against field text for one query
 *  token, tagged by tier: "exact" is the SAME word (the raw token or its
 *  stem — just a different inflection), "related" is a DIFFERENT but
 *  synonym-linked word. Synonyms are looked up by stem so "clubs" (plural)
 *  still finds "club"'s related terms. */
export function expandTermForMatching(token: string): { term: string; tier: MatchTier }[] {
  const stem = lightStem(token);
  const exactTerms = Array.from(new Set([token, stem]));
  const variants: { term: string; tier: MatchTier }[] = exactTerms.map((term) => ({ term, tier: "exact" }));

  const related = SYNONYMS_BY_TERM.get(stem) ?? [];
  for (const term of related) {
    if (!exactTerms.includes(term)) variants.push({ term, tier: "related" });
  }

  return variants;
}

/** A synonym-only hit counts for half a field's weight — enough to surface
 *  related posts, never enough to outrank a real exact/stemmed match in the
 *  same field. */
const RELATED_MATCH_MULTIPLIER = 0.5;

/** 1 for an exact/stemmed hit, RELATED_MATCH_MULTIPLIER for a synonym-only
 *  hit, 0 for no match — multiply by a field's weight to score it. Matching
 *  itself is still plain substring containment against the field's full
 *  text (unchanged from before), so a compound field like the tags string
 *  "sports club" already contains "club" as a literal substring — no
 *  separate word-tokenization of field text is needed for that to work. */
export function matchScore(fieldText: string, token: string): number {
  if (!token) return 0;
  let best = 0;
  for (const { term, tier } of expandTermForMatching(token)) {
    if (!term || !fieldText.includes(term)) continue;
    const score = tier === "exact" ? 1 : RELATED_MATCH_MULTIPLIER;
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}
