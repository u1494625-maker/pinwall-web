import type { ReactNode } from "react";

/** Matches an http(s) URL up to the next whitespace — deliberately greedy
 *  (may over-match trailing sentence punctuation), which trimTrailingPunctuation
 *  below then corrects. Not applied to any other text; no HTML is parsed or
 *  injected — this only ever produces React elements from the plain-text
 *  caption already stored in the database. */
const URL_PATTERN = /https?:\/\/[^\s]+/g;

/** Sentence punctuation that commonly follows a URL but was never part of
 *  it — a period ending the sentence, a comma before the next clause, etc.
 *  Stripped one character at a time so something like "...my site!!" or
 *  "(see https://x.com)." loses every trailing mark, not just the last one. */
const TRAILING_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":", "'", '"']);

/**
 * Splits a trailing run of sentence punctuation off the end of a matched URL
 * candidate. A trailing ")" is only ever treated as punctuation (not part of
 * the URL) when it's unbalanced within the candidate — i.e. there are more
 * ")" than "(" — so a URL that legitimately ends in a parenthetical, like a
 * Wikipedia link (".../wiki/Foo_(bar)"), is left intact.
 */
function trimTrailingPunctuation(candidate: string): { url: string; trailing: string } {
  let url = candidate;
  let trailing = "";

  while (url.length > 0) {
    const lastChar = url[url.length - 1];

    if (lastChar === ")") {
      const opens = (url.match(/\(/g) ?? []).length;
      const closes = (url.match(/\)/g) ?? []).length;
      if (closes <= opens) break;
      url = url.slice(0, -1);
      trailing = lastChar + trailing;
      continue;
    }

    if (TRAILING_PUNCTUATION.has(lastChar)) {
      url = url.slice(0, -1);
      trailing = lastChar + trailing;
      continue;
    }

    break;
  }

  return { url, trailing };
}

type LinkifiedTextProps = {
  /** Plain text, e.g. a post caption — never HTML. Rendered as React
   *  elements/text nodes only; nothing here ever touches innerHTML. */
  text: string;
};

/**
 * Renders `text` verbatim, except any http(s) URL becomes a real, clickable
 * `<a>` — the smallest possible change to plain-text rendering, meant to
 * drop directly into an existing text container (e.g. PostDetail's own
 * `whitespace-pre-wrap` caption `<p>`) without altering that container's own
 * className or wrapping markup, so surrounding text, line breaks, and
 * whitespace behavior are exactly what they already were.
 *
 * Deliberately renders a Fragment, not its own wrapping element — the
 * caller's own container is what actually owns the text styling/whitespace
 * behavior; duplicating that here would either fight it or require this
 * component to know about every caller's layout.
 */
export default function LinkifiedText({ text }: LinkifiedTextProps) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index;
    const { url, trailing } = trimTrailingPunctuation(raw);

    // Nothing survived trimming (a pathological run of only punctuation
    // after "https://") — leave the original text alone rather than render
    // a link to a URL with (almost) nothing in it.
    if (url.length <= "https://".length) continue;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    nodes.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        // A card/detail page this text is embedded in may itself be (or sit
        // inside) a click target that navigates elsewhere — this keeps a tap
        // on the link from also triggering that outer navigation.
        onClick={(event) => event.stopPropagation()}
        className="break-all text-kavanaka-aqua underline underline-offset-2"
      >
        {url}
      </a>,
    );

    if (trailing) nodes.push(trailing);
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return <>{nodes}</>;
}
