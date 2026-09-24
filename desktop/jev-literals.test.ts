import { describe, expect, it } from 'vitest';
import { extractJevLiteralCandidates, literalsForField, JEV_LITERAL_NONE, MAX_JEV_LITERALS, resolveJevLiteralCandidate } from './jev-literals';

it('limits speculative literal heads to plausible native fields while preserving explicit quoted text',()=>{
 const candidates=extractJevLiteralCandidates('Use 2022, https://example.test, a@example.test, or "exact text".');
 const values=(input_type:string,value='')=>literalsForField(candidates,{input_type,value}).map(c=>c.value);
 expect(values('text')).toEqual(['exact text']);
 expect(values('number')).toEqual(['2022','exact text']);
 expect(values('url')).toEqual(['https://example.test','exact text']);
 expect(values('email')).toEqual(['a@example.test','exact text']);
 expect(values('text','exact text')).toEqual([]);
});

describe('user-goal literal candidates', () => {
  it('preserves exact values, whitespace and unicode with source offsets', () => {
    const goal = 'Set my bio to “  שלום 🌍 — café  ” and my tagline to \'Keep going\'.';
    const candidates = extractJevLiteralCandidates(goal);
    expect(candidates.map(item => item.value)).toEqual(['  שלום 🌍 — café  ', 'Keep going']);
    for (const item of candidates) expect(goal.slice(item.start, item.end)).toBe(item.value);
  });

  it('does not mistake apostrophes in prose for quoted values', () => {
    expect(extractJevLiteralCandidates('Don\'t change Michael\'s profile.')).toEqual([]);
    expect(extractJevLiteralCandidates('Set bio to “Michael’s profile”.')[0].value).toBe('Michael’s profile');
    expect(extractJevLiteralCandidates("Set bio to 'Don't panic'.")[0].value).toBe("Don't panic");
  });

  it('finds explicit URLs, emails, dates, times and numeric literals without normalization', () => {
    const goal = 'Use https://example.test/a_(b)?q=one and me@example.test by 2026-09-23 at 09:30 AM with -12.50, $1,200.50 and 20%.';
    const candidates = extractJevLiteralCandidates(goal);
    expect(candidates.map(item => item.value)).toEqual(['https://example.test/a_(b)?q=one', 'me@example.test', '2026-09-23', '09:30 AM', '-12.50', '$1,200.50', '20%']);
    for (const item of candidates) expect(goal.slice(item.start, item.end)).toBe(item.value);
  });

  it('does not turn prose, identifiers or URL components into guessed text', () => {
    const goal = 'Search for warm winter gloves, product sku123 and revision v2.8 at https://example.test/item/42.';
    expect(extractJevLiteralCandidates(goal).map(item => item.value)).toEqual(['https://example.test/item/42']);
  });

  it('offers the requested value while excluding clearly named control labels', () => {
    const goal = 'Fill the field "Biography" with "I am a robot". Click the "Save" button.';
    expect(extractJevLiteralCandidates(goal).map(item => item.value)).toEqual(['I am a robot']);
    expect(extractJevLiteralCandidates('Set "Nickname": "Little Robot".').map(item => item.value)).toEqual(['Little Robot']);
  });

  it('does not offer output-schema keys, enum values or examples as field data', () => {
    const goal = 'Set my bio to "I am a robot".\n\nReturn the final answer as a JSON object with these fields:\n{"task_type":"RETRIEVE|MUTATE|NAVIGATE","retrieved_data":null,"count":100}\nUse status "SUCCESS" on completion.';
    expect(extractJevLiteralCandidates(goal).map(item => item.value)).toEqual(['I am a robot']);
    expect(extractJevLiteralCandidates('Search for "winter"; response format: "status", "url", 200.').map(item => item.value)).toEqual(['winter']);
  });

  it('excludes schema and code regions without removing preceding and following natural request values', () => {
    const goal = 'Set bio to "before".\n```json\n{"label":"example","enum":["A","B"],"min":8}\n```\nSet title to "after".';
    expect(extractJevLiteralCandidates(goal).map(item => item.value)).toEqual(['before', 'after']);
    expect(extractJevLiteralCandidates('Use {"type":"object","properties":{"name":{"type":"string"}}} and enter "robot".').map(item => item.value)).toEqual(['robot']);
    expect(extractJevLiteralCandidates('Schema: {"type":"object", "field": "unfinished')).toEqual([]);
  });

  it('keeps formatting-looking text when it is explicitly the quoted field value', () => {
    expect(extractJevLiteralCandidates('Set the bio to "Return JSON only".').map(item => item.value)).toEqual(['Return JSON only']);
  });

  it('falls back for escaped quotes instead of silently decoding or typing their escapes', () => {
    expect(extractJevLiteralCandidates('Set bio to "He said \\"hello\\"".')).toEqual([]);
  });

  it('deduplicates values, bounds candidates and never truncates a value into different text', () => {
    expect(extractJevLiteralCandidates('Use "robot" then "robot" and "other".').map(item => item.value)).toEqual(['robot', 'other']);
    expect(extractJevLiteralCandidates('Set bio to "' + 'a'.repeat(2001) + '".')).toEqual([]);
    expect(extractJevLiteralCandidates(' '.repeat(20) + '"  "')).toEqual([]);
    const candidates = extractJevLiteralCandidates(Array.from({ length: 50 }, (_, i) => `"value ${i}"`).join(' '));
    expect(candidates).toHaveLength(MAX_JEV_LITERALS);
    expect(new Set(candidates.map(item => item.id)).size).toBe(MAX_JEV_LITERALS);
  });

  it('resolves only a offered exact value, with NONE reserved for the text generator', () => {
    const candidates = extractJevLiteralCandidates('Enter "NONE".');
    expect(resolveJevLiteralCandidate(candidates, candidates[0].id)).toBe('NONE');
    expect(resolveJevLiteralCandidate(candidates, JEV_LITERAL_NONE)).toBeUndefined();
    for (const choice of ['invented', '', null, undefined, {}]) expect(() => resolveJevLiteralCandidate(candidates, choice)).toThrow('unknown literal');
  });

  it('bounds scanning of malformed or oversized requests', () => {
    expect(extractJevLiteralCandidates('“'.repeat(100_000))).toEqual([]);
    expect(extractJevLiteralCandidates('a'.repeat(64_001) + ' "outside the candidate budget"')).toEqual([]);
  });
});
