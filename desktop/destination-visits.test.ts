import { describe, expect, it } from 'vitest';
import { DestinationVisits } from './destination-visits';
import { buildJevRequest, type JevRequest, type PageState } from './engine';
import { compileJevWebActions } from './jev-web-actions';
import { completionRequest } from './task-completion';

const origin = 'https://example.test';
function request(urls: string[]) {
  return { model: 'fixture', state: { page: { url: origin + '/list', text: 'Observed website text' } }, questions: {
    click_target: { type: 'choice', criteria: Object.fromEntries(urls.map((href, i) => [String(i + 1), { element: 'Link ' + i, href }])) },
  } } as JevRequest;
}
function hint(visits: DestinationVisits, url: string) {
  const body = request([url]); visits.annotate(body);
  return (body.questions.click_target.criteria['1'] as Record<string, unknown>).prior_observation;
}

describe('per-turn destination observations', () => {
  it('counts only observed URL transitions while repeated observations refresh recency', () => {
    const visits = new DestinationVisits();
    visits.observe(origin + '/a', 0); visits.observe(origin + '/a', 0); visits.observe(origin + '/a', 2);
    expect(hint(visits, origin + '/a')).toEqual({ last_observed_step: 2, visit_count: 1 });
    visits.observe(origin + '/b', 3); visits.observe(origin + '/a', 4); visits.observe(origin + '/a', 4);
    expect(hint(visits, origin + '/a')).toEqual({ last_observed_step: 4, visit_count: 2 });
    expect(hint(visits, origin + '/b')).toEqual({ last_observed_step: 3, visit_count: 1 });
  });

  it('preserves the exact query, fragment, path and URL spelling', () => {
    const visits = new DestinationVisits(), observed = origin + '/items?p=2&sort=date#comments';
    visits.observe(observed, 1);
    expect(hint(visits, observed)).toEqual({ last_observed_step: 1, visit_count: 1 });
    for (const other of [origin + '/items?p=1&sort=date#comments', origin + '/items?sort=date&p=2#comments', origin + '/items?p=2&sort=date', origin + '/items/?p=2&sort=date#comments', '/items?p=2&sort=date#comments']) {
      expect(hint(visits, other)).toBeUndefined();
    }
  });

  it('keeps at most 128 URLs without discarding counts for retained destinations', () => {
    const visits = new DestinationVisits();
    for (let i = 0; i < 150; i++) visits.observe(origin + '/' + i, i);
    const body = request(Array.from({ length: 150 }, (_, i) => origin + '/' + i)); visits.annotate(body);
    expect(Object.values(body.questions.click_target.criteria).filter(value => (value as Record<string, unknown>).prior_observation)).toHaveLength(128);
    expect(hint(visits, origin + '/128')).toBeUndefined();
    visits.observe(origin + '/0', 151);
    expect(hint(visits, origin + '/0')).toEqual({ last_observed_step: 151, visit_count: 2 });
    expect(body.state.destinationObservationPolicy).toContain('absent hints do not mean unvisited');
  });

  it('does not annotate unseen links, non-HTTP pages or invalid observation steps', () => {
    const visits = new DestinationVisits();
    visits.observe('about:blank', 0); visits.observe('broken URL', 1); visits.observe(origin, -1); visits.observe(origin, NaN);
    const body = request(['about:blank', 'broken URL', origin, origin + '/unseen']), before = structuredClone(body);
    visits.annotate(body);
    expect(body).toEqual(before);
  });

  it('keeps hints outside page evidence and preserves every alternative in fan-out and combined schemas', () => {
    const visits = new DestinationVisits(), url = origin + '/read'; visits.observe(url, 4);
    const page: PageState = { url: origin + '/list', title: 'List', text: 'Actual website text', w: 900, h: 700, marker: [], page_key: [], guards: {}, actions: [
      { id: 'e1', node: 1, kind: 'click', label: 'Read page', href: url },
      { id: 'e2', node: 2, kind: 'click', label: 'Unread page', href: origin + '/unread' },
      { id: 'e3', node: 3, kind: 'fill', label: 'Search', value: '' },
    ] };
    const before = structuredClone(page), built = buildJevRequest(page, 'Read the pages', []), originalHeads = Object.keys(built.body.questions);
    const originalChoices = Object.keys(built.body.questions.click_target.criteria);
    visits.annotate(built.body);
    expect(page).toEqual(before);
    expect(built.body.state.page).toMatchObject({ text: page.text });
    expect(JSON.stringify(built.body.state.page)).not.toContain('prior_observation');
    expect(Object.keys(built.body.questions)).toEqual(originalHeads);
    expect(Object.keys(built.body.questions.click_target.criteria)).toEqual(originalChoices);
    expect(built.body.questions.click_target.criteria['1']).toMatchObject({ prior_observation: { last_observed_step: 4, visit_count: 1 } });
    expect(built.body.questions.click_target.criteria['2']).not.toHaveProperty('prior_observation');
    const combined = compileJevWebActions(built.body)!;
    expect(combined.body.questions.web_action.criteria['CLICK:1']).toMatchObject({ prior_observation: { last_observed_step: 4, visit_count: 1 } });
    expect(combined.choices).toHaveProperty('CLICK:2');
    expect(combined.choices).toHaveProperty('TYPE_TEXT:3');
    const completion = completionRequest({ success: ['Read the requested pages'], constraints: [], progressOnly: [] }, page, 'Read the pages', 'fixture');
    expect(JSON.stringify(completion)).not.toContain('prior_observation');
    expect(built.body.state.destinationObservationPolicy).toContain('not proof of task completion');
    expect(built.body.state.destinationObservationPolicy).toContain('Reinspection is allowed');
  });

  it('copies hint values so a later observation cannot rewrite an already dispatched request', () => {
    const visits = new DestinationVisits(); visits.observe(origin + '/a', 0);
    const body = request([origin + '/a']); visits.annotate(body);
    visits.observe(origin + '/b', 1); visits.observe(origin + '/a', 2);
    expect(body.questions.click_target.criteria['1']).toMatchObject({ prior_observation: { last_observed_step: 0, visit_count: 1 } });
    expect(hint(new DestinationVisits(), origin + '/a')).toBeUndefined();
  });
});
