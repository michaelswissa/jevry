/**
 * Code finds verbatim candidates; Jev decides whether one fits the field.
 * https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook
 * These are possible values, never permission to type or evidence of relevance.
 */
export const JEV_LITERAL_NONE = 'NONE';
export const MAX_JEV_LITERALS = 24;
export const MAX_JEV_LITERAL_LENGTH = 2000;

export interface JevLiteralCandidate {
  id: string;
  value: string;
  kind: 'quoted' | 'url' | 'email' | 'number';
  /** UTF-16 offsets into the original user goal, excluding surrounding quotes. */
  start: number;
  end: number;
}

type Span = { start: number; end: number };
type Literal = Omit<JevLiteralCandidate, 'id'>;
const word = /[\p{L}\p{N}_]/u;
const closers: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' };

function quotedSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (let start = 0; start < text.length; start++) {
    const close = closers[text[start]];
    if (!close || (text[start] === "'" && word.test(text[start - 1] || ''))) continue;
    let closed = false;
    for (let end = start + 1; end < text.length; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] !== close || ((close === "'" || close === '’') && word.test(text[end - 1] || '') && word.test(text[end + 1] || ''))) continue;
      spans.push({ start, end: end + 1 });
      start = end;
      closed = true;
      break;
    }
    // An unmatched opening quote makes the remainder ambiguous. Do not repeatedly
    // scan it looking for other openers (quadratic on repeated unmatched quotes).
    if (!closed) break;
  }
  return spans;
}

function overlaps(span: Span, others: Span[]): boolean {
  return others.some(other => span.start < other.end && other.start < span.end);
}

function excludedSpans(goal: string, quotes: Span[]): Span[] {
  const excluded: Span[] = [];
  // Code examples and structured payloads need interpretation by the generator.
  // Do not promote their keys, enum examples, or schema constants into inputs.
  for (const match of goal.matchAll(/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g)) {
    excluded.push({ start: match.index!, end: match.index! + match[0].length });
  }
  const stack: { character: string; start: number }[] = [];
  let quoteIndex = 0;
  for (let i = 0; i < goal.length; i++) {
    while (quotes[quoteIndex] && quotes[quoteIndex].end <= i) quoteIndex++;
    if (quotes[quoteIndex]?.start === i) { i = quotes[quoteIndex].end - 1; continue; }
    if (goal[i] === '{' || goal[i] === '[') stack.push({ character: goal[i], start: i });
    else if (goal[i] === '}' || goal[i] === ']') {
      const open = stack.at(-1);
      if (open && ((open.character === '{' && goal[i] === '}') || (open.character === '[' && goal[i] === ']'))) {
        stack.pop();
        if (!stack.length) excluded.push({ start: open.start, end: i + 1 });
      }
    }
  }
  // An unfinished schema must not make its quoted keys look like user values.
  if (stack.length) excluded.push({ start: stack[0].start, end: goal.length });
  const formatDirective = /(?:^|[\n.!?]\s*|;\s*)(?:(?:final\s+)?(?:answer|response|output)\s+(?:format|schema)\s*:|(?:return|respond|reply|output|format)\b[^\n.!?]{0,90}\b(?:json|schema|structured\s+(?:object|output)|(?:these|the\s+following)\s+(?:fields|keys))\b)/gi;
  for (const match of goal.matchAll(formatDirective)) {
    const start = match.index! + match[0].search(/\S/);
    // A literal such as "Return JSON only" is still literal task data.
    if (!overlaps({ start, end: start + 1 }, quotes)) excluded.push({ start, end: goal.length });
  }
  return excluded;
}

function isFieldLabel(goal: string, span: Span): boolean {
  const before = goal.slice(Math.max(0, span.start - 65), span.start);
  const after = goal.slice(span.end, span.end + 40);
  return /^\s*:/.test(after) ||
    /\b(?:field|textbox|input|control|button|tab|menu|column|label|link)(?:\s+(?:named|called|labelled|labeled))?\s*$/i.test(before) ||
    /^\s+(?:field|textbox|input|control|button|tab|menu|column|label|link)\b/i.test(after);
}

/** Extracts only exact spans from the user goal. No page data or generated text. */
export function extractJevLiteralCandidates(goal: string): JevLiteralCandidate[] {
  goal = goal.slice(0, 64_000);
  const quotes = quotedSpans(goal);
  const excluded = excludedSpans(goal, quotes);
  const literals: Literal[] = [];
  const add = (start: number, end: number, kind: Literal['kind']) => {
    const value = goal.slice(start, end);
    if (!value.trim() || value.length > MAX_JEV_LITERAL_LENGTH || overlaps({ start, end }, excluded)) return;
    literals.push({ value, kind, start, end });
  };
  for (const span of quotes) {
    const value = goal.slice(span.start + 1, span.end - 1);
    if (isFieldLabel(goal, span) || /\\["'“”‘’]/.test(value)) continue;
    add(span.start + 1, span.end - 1, 'quoted');
  }
  const reserved = [...excluded, ...quotes];
  const patterns: [Literal['kind'], RegExp][] = [
    ['url', /https?:\/\/[^\s<>"'“”‘’`]+/gi],
    ['email', /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9](?:[A-Z0-9.-]{0,251}[A-Z0-9])?\.[A-Z]{2,63}/gi],
    ['number', /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?|[+$€£¥-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?%?/gi],
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of goal.matchAll(pattern)) {
      const start = match.index!;
      let end = start + match[0].length;
      if (kind === 'url') {
        while (/[.,!?;:]/.test(goal[end - 1] || '')) end--;
        while (goal[end - 1] === ')' && (goal.slice(start, end).match(/\)/g)?.length || 0) > (goal.slice(start, end).match(/\(/g)?.length || 0)) end--;
      }
      const span = { start, end };
      if (overlaps(span, reserved)) continue;
      if (kind !== 'url' && (word.test(goal[start - 1] || '') || word.test(goal[end] || ''))) continue;
      if (kind === 'number' && /[.+-]/.test(goal[start - 1] || '')) continue;
      add(start, end, kind);
      reserved.push(span);
    }
  }
  // Prefer explicit quoted values/addresses over incidental quantities when full.
  const seen = new Set<string>();
  return literals.filter(literal => !seen.has(literal.value) && !!seen.add(literal.value))
    .slice(0, MAX_JEV_LITERALS).sort((a, b) => a.start - b.start)
    .map((literal, index) => ({ id: `literal_${index + 1}`, ...literal }));
}

/** Caller must validate Jev's distribution/confidence before resolving its choice. */
export function resolveJevLiteralCandidate(candidates: readonly JevLiteralCandidate[], choice: unknown): string | undefined {
  if (choice === JEV_LITERAL_NONE) return undefined;
  const candidate = typeof choice === 'string' ? candidates.find(item => item.id === choice) : undefined;
  if (!candidate) throw new Error('Jev selected an unknown literal candidate. Nothing typed.');
  return candidate.value;
}

/** Skip speculative extraction when native field metadata gives no useful clue.
 * This only gates acceleration; the normal text generator remains available. */
export function literalsForField(candidates:readonly JevLiteralCandidate[],field:{input_type?:string;value?:string}):JevLiteralCandidate[] {
  const type=field.input_type?.toLowerCase();
  return candidates.filter(candidate=>candidate.value!==field.value&&(
    candidate.kind==='quoted'||candidate.kind==='email'&&type==='email'||candidate.kind==='url'&&type==='url'||
    candidate.kind==='number'&&['number','range','date','datetime-local','time','month','week','tel'].includes(type||'')
  ));
}
