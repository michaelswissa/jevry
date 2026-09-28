import { describe, expect, it } from 'vitest';
import { buildJevRequest, type JevRequest, type PageState } from './engine';
import { compileJevWebActions, decodeJevWebAction, WEB_ACTION_HEAD } from './jev-web-actions';
import { shareJevActionContexts, SHARED_CONTEXT_RULE } from './jev-request-context';

const context = 'Report 12: 2026-09-28 / 164867 / 11457. '.repeat(40).slice(0, 1200);
function page(count: number): PageState {
  return { url: 'https://fixture.test/reports', title: 'Reports', text: context, w: 1600, h: 1000,
    marker: [], page_key: [], guards: {}, actions: Array.from({ length: count }, (_, i) => ({
      id: `click_${i}`, node: i + 1, kind: 'click', label: `Open report ${i}`, context,
    })),
  };
}

describe('shared observed web context', () => {
  it('preserves every dense-form choice and all original context while removing duplication', () => {
    const request = buildJevRequest(page(200), 'Open report 179.', []);
    const compiled = compileJevWebActions(request.body)!;
    const contexts = compiled.body.state.sharedActionContexts as Record<string, string>;
    expect(contexts).toEqual({ c1: context });
    expect(compiled.body.questions[WEB_ACTION_HEAD].instructions).toMatchObject({ sharedContextRule: SHARED_CONTEXT_RULE });
    const criteria = compiled.body.questions[WEB_ACTION_HEAD].criteria;
    expect(Object.keys(criteria)).toHaveLength(202);
    for (let i = 1; i <= 200; i++) {
      expect(criteria[`CLICK:${i}`]).toMatchObject({ element: `[${i}] Open report ${i - 1}`,
        nearby_text: { state_ref: 'sharedActionContexts.c1' }, operation: 'CLICK', target: String(i) });
    }
    const expanded = JSON.parse(JSON.stringify(compiled.body));
    delete expanded.state.sharedActionContexts;
    for (const option of Object.values(expanded.questions[WEB_ACTION_HEAD].criteria) as any[]) {
      if (option.nearby_text?.state_ref) option.nearby_text = context;
    }
    expect(JSON.stringify(compiled.body).length).toBeLessThan(JSON.stringify(expanded).length / 3);
    const choice = 'CLICK:180';
    const decision = decodeJevWebAction({ answers: { [WEB_ACTION_HEAD]: { choice, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(criteria).map(key => [key, key === choice ? 1 : 0])),
    } } }, compiled, request);
    expect(decision.action).toEqual(page(200).actions[179]);
  });

  it('preserves small requests and game requests without introducing shared references', () => {
    expect(buildJevRequest(page(2), 'Open a report.', []).body.state.sharedActionContexts).toBeUndefined();
    const game = buildJevRequest(page(200), 'Play the game.', [], 'jev-latest', true);
    expect(game.body.state.sharedActionContexts).toBeUndefined();
    expect(game.body.questions.click_target.criteria['1']).toMatchObject({ nearby_text: context });
  });

  it('supports fan-out beyond the joint-action limit without losing any target', () => {
    const request = buildJevRequest(page(250), 'Open report 249.', []);
    expect(compileJevWebActions(request.body)).toBeUndefined();
    expect(Object.keys(request.body.questions.click_target.criteria)).toHaveLength(250);
    expect(request.body.questions.click_target.instructions).toMatchObject({ sharedContextRule: SHARED_CONTEXT_RULE });
  });

  it('shares only exact duplicates and does not mutate or overwrite existing state', () => {
    const make = (text: string) => ({ nearby_text: text, current_value: 'Keep me', element: 'Observed control' });
    const original: JevRequest = { model: 'jev-latest', state: {}, questions: { target: {
      type: 'choice', instructions: { goal: 'Read the observed context.' }, criteria: {
        a: make(context), b: make(context), c: make(context), d: make(context + '!'),
        e: { element: 'Other', nearby_text: { custom: true } },
      },
    } } };
    const before = JSON.stringify(original), shared = shareJevActionContexts(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(shared.questions.target.criteria.d).toBe(original.questions.target.criteria.d);
    expect(shared.questions.target.criteria.e).toBe(original.questions.target.criteria.e);
    expect(shared.questions.target.criteria.a).toMatchObject({ current_value: 'Keep me', element: 'Observed control' });
    expect(shareJevActionContexts(shared)).toBe(shared);
    const reserved = { ...original, state: { sharedActionContexts: { existing: 'Keep this' } } };
    expect(shareJevActionContexts(reserved)).toBe(reserved);
  });
});
