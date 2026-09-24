import { describe, expect, it } from 'vitest';
import { buildJevRequest, type JevRequest, type JevResponse, type ObservedAction, type PageState } from './engine';
import { compileJevWebActions, decodeJevWebAction, MAX_WEB_ACTION_CHOICES, WEB_ACTION_HEAD } from './jev-web-actions';

const page = (actions: ObservedAction[]): PageState => ({ url: 'https://fixture.test/report', title: 'Report', text: 'Report settings', w: 900, h: 650, actions, marker: [], page_key: [], guards: {} });
const actions: ObservedAction[] = [
  { id: 'click_1', node: 1, kind: 'click', label: 'Open report', role: 'link', href: 'https://fixture.test/report/view', context: 'Saved reports' },
  { id: 'fill_2', node: 2, kind: 'fill', label: 'Report title', role: 'textbox', value: 'Existing' },
  { id: 'select_3_1', node: 3, kind: 'select', label: 'Grouping → Monthly', role: 'combobox', value: 'month', current_value: 'Annual' },
  { id: 'select_3_2', node: 3, kind: 'select', label: 'Grouping → Weekly', role: 'combobox', value: 'week', current_value: 'Annual' },
  { id: 'press_2', node: 2, kind: 'press', key: 'Enter', label: 'Submit Report title', role: 'textbox', value: 'Existing' },
  { id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 560 },
  { id: 'wait', kind: 'wait', label: 'Wait for loading' },
  { id: 'go_back', kind: 'back', label: 'Go back to reports', historyEntryId: 4 },
];
function fixture() { return buildJevRequest(page(actions), 'Name this report "Revenue" and group it annually.', []); }
function response(keys: string[], selected: string, confidence = .83): JevResponse {
  return { model: 'fixture-model', answers: { [WEB_ACTION_HEAD]: {
    choice: selected, confidence, probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? .73 : .27 / (keys.length - 1)])),
  } } };
}

describe('experimental complete web-action Choice', () => {
  it('compiles operation and target into one choice without changing state or literal heads', () => {
    const original = fixture(), before = JSON.stringify(original.body);
    const compiled = compileJevWebActions(original.body)!;
    expect(compiled).toBeDefined(); expect(compiled.body.state).toBe(original.body.state);
    expect(Object.keys(compiled.body.questions)).toEqual([WEB_ACTION_HEAD, 'fill_value_2']);
    expect(compiled.body.questions.fill_value_2).toBe(original.body.questions.fill_value_2);
    expect(compiled.body.questions[WEB_ACTION_HEAD].criteria['SELECT:3:1']).toMatchObject({ operation: 'SELECT', target: '3:1', element: '[3:1] Grouping → Monthly', current_value: 'Annual', role: 'combobox' });
    expect(compiled.body.questions[WEB_ACTION_HEAD].criteria['CLICK:1']).toMatchObject({ nearby_text: 'Saved reports', href: 'https://fixture.test/report/view' });
    expect(JSON.stringify(original.body)).toBe(before);
  });

  it('returns the actual atomic confidence and selected probability without consuming other heads', () => {
    const original = fixture(), compiled = compileJevWebActions(original.body)!;
    const result = response(Object.keys(compiled.choices), 'SELECT:3:1');
    result.answers.operation = { choice: 'TYPE_TEXT', confidence: NaN, probabilities: {} };
    result.answers.select_target = { choice: 'nonexistent', confidence: 1, probabilities: {} };
    result.answers.fill_value_2 = { choice: 'invented literal', confidence: NaN, probabilities: {} };
    expect(decodeJevWebAction(result, compiled, original)).toEqual({ operation: 'SELECT', target: '3:1', action: original.targets.SELECT['3:1'], confidence: .83, probability: .73 });
  });

  it('uses the globally selected complete action even when another operation has greater marginal mass', () => {
    const original = fixture(), compiled = compileJevWebActions(original.body)!;
    const probabilities = Object.fromEntries(Object.keys(compiled.choices).map(key => [key, 0]));
    Object.assign(probabilities, { 'CLICK:1': .4, 'SELECT:3:1': .31, 'SELECT:3:2': .29 });
    const result = { answers: { [WEB_ACTION_HEAD]: { choice: 'CLICK:1', confidence: .17, probabilities } } };
    expect(decodeJevWebAction(result, compiled, original)).toMatchObject({ operation: 'CLICK', target: '1', confidence: .17, probability: .4 });
  });

  it.each(['DONE', 'BLOCKED'])('decodes terminal %s without a target or completion claim', terminal => {
    const original = fixture(), compiled = compileJevWebActions(original.body)!;
    expect(decodeJevWebAction(response(Object.keys(compiled.choices), terminal), compiled, original)).toEqual({ operation: terminal, action: undefined, confidence: .83, probability: .73 });
  });

  it.each(['WAIT', 'GO_BACK', 'SCROLL_DOWN'])('resolves observed %s controls without manufacturing a target', operation => {
    const original = fixture(), compiled = compileJevWebActions(original.body)!;
    expect(decodeJevWebAction(response(Object.keys(compiled.choices), operation), compiled, original).action).toBe(original.controls[operation]);
  });

  it('preserves suppressed terminal choices', () => {
    const original = fixture(); delete original.body.questions.operation.criteria.DONE;
    expect(compileJevWebActions(original.body)!.choices).not.toHaveProperty('DONE');
  });

  it('rejects unknown choices, malformed distributions, missing targets, and missing controls', () => {
    const original = fixture(), compiled = compileJevWebActions(original.body)!, keys = Object.keys(compiled.choices);
    expect(() => decodeJevWebAction(response(keys, 'CLICK:invented'), compiled, original)).toThrow();
    const malformed = response(keys, 'CLICK:1'); malformed.answers[WEB_ACTION_HEAD].probabilities['CLICK:1'] = NaN;
    expect(() => decodeJevWebAction(malformed, compiled, original)).toThrow();
    expect(() => decodeJevWebAction(response(keys, 'CLICK:1'), compiled, { ...original, targets: {} })).toThrow(/matching observed target/);
    expect(() => decodeJevWebAction(response(keys, 'WAIT'), compiled, { ...original, controls: {} })).toThrow(/matching observed control/);
    const wrong = { ...original, targets: { ...original.targets, CLICK: { '1': actions[1] } } };
    expect(() => decodeJevWebAction(response(keys, 'CLICK:1'), compiled, wrong)).toThrow(/matching observed target/);
  });

  it('leaves game, keyboard and point schemas unchanged', () => {
    const original = fixture(); expect(compileJevWebActions(original.body, { game: true })).toBeUndefined();
    expect(compileJevWebActions(buildJevRequest(page(actions), 'Play the game', []).body)).toBeUndefined();
    for (const operation of ['KEY_LEFT', 'KEY_ENTER', 'POINT']) {
      const body = structuredClone(original.body); body.questions.operation.criteria[operation] = 'Game input';
      expect(compileJevWebActions(body)).toBeUndefined();
    }
  });

  it('falls back for more than 240 complete actions or grouped native dropdown choices', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i): ObservedAction => ({ id: 'click_' + (i + 1), node: i + 1, kind: 'click', label: 'Observed item ' + i }));
    expect(Object.keys(compileJevWebActions(buildJevRequest(page(many(MAX_WEB_ACTION_CHOICES - 2)), 'Open a result', []).body)!.choices)).toHaveLength(MAX_WEB_ACTION_CHOICES);
    expect(compileJevWebActions(buildJevRequest(page(many(MAX_WEB_ACTION_CHOICES - 1)), 'Open a result', []).body)).toBeUndefined();
    const large = Array.from({ length: 256 }, (_, i): ObservedAction => ({ id: 'select_' + i, node: 1, kind: 'select', label: 'Choice → ' + i, value: String(i), current_value: 'Previously selected' }));
    const original = buildJevRequest(page(large), 'Choose an item', []); expect(original.selectGroups.length).toBeGreaterThan(1);
    expect(compileJevWebActions(original.body)).toBeUndefined();
  });

  it('falls back if a target is not an observed element or a required head is unsupported', () => {
    for (const mutate of [
      (body: JevRequest) => { body.questions.click_target.criteria['999'] = { element: 'Invented' }; },
      (body: JevRequest) => { delete body.questions.type_text_target; },
      (body: JevRequest) => { body.questions.arbitrary = { type: 'choice', criteria: { YES: 'Unrelated question' } }; },
      (body: JevRequest) => { body.questions.operation.criteria.SEND_MESSAGE = 'Unobserved operation'; },
    ]) {
      const body = structuredClone(fixture().body); mutate(body); expect(compileJevWebActions(body)).toBeUndefined();
    }
  });
});
