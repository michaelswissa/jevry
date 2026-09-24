import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSharedTask, citedUrlsFromResearch } from './firecrawl-evaluate.mjs';
import { aggregateRuns, distribution } from '../../scripts/benchmark-matched.mjs';

const base = 'http://127.0.0.1:12345';
const validPolicy = 'Cedar Stays is the cheaper refundable option: EUR 120 per night, free cancellation until 24 hours before check-in. Orbit Rooms costs EUR 95 per night and is non-refundable.';
const policy = { id: 'compare-policies', answer: validPolicy, base, readUrls: [base + '/cedar', base + '/orbit'], citedUrls: [base + '/cedar', base + '/orbit'] };
const receipts = [{ destination: 'Paris', guests: '2' }, { destination: 'London', guests: '2' }];
const question = { id: 'result-question', answer: 'London; we kept **2** guests.', browserState: { destination: 'London', guests: '2', result: 'Stays in London for 2 guests', receipts }, atomicActions: 0 };

test('correct observed outcomes pass; research still requires semantic review', () => {
  assert.equal(evaluateSharedTask(policy).passed, true);
  assert.equal(evaluateSharedTask(policy).manualReviewRequired, true);
  assert.equal(evaluateSharedTask(question).passed, true);
});
test('swapped prices and wrong recommendation cannot pass on word presence', () => {
  assert.equal(evaluateSharedTask({ ...policy, answer: validPolicy.replace('120', '95').replace('costs EUR 95', 'costs EUR 120') }).passed, false);
  assert.equal(evaluateSharedTask({ ...policy, answer: validPolicy + ' Pick Orbit Rooms.' }).passed, false);
});
test('source metadata alone is not citation evidence; both pages must actually be read', () => {
  const research = { sources: [{ id: 'S7', url: base + '/cedar' }, { id: 'S3', url: base + '/orbit' }], findings: [] };
  assert.deepEqual(citedUrlsFromResearch(research, 'No citations.'), []);
  assert.deepEqual(citedUrlsFromResearch({ ...research, findings: [{ text: 'Observed', sourceIds: ['S3'] }] }, 'Cedar [S7].').sort(), [base + '/cedar', base + '/orbit'].sort());
  assert.equal(evaluateSharedTask({ ...policy, citedUrls: [] }).passed, false);
  assert.equal(evaluateSharedTask({ ...policy, readUrls: [base + '/sources', base + '/cedar'] }).passed, false);
});
test('a read-only answer must preserve fields and exact prior submit receipts', () => {
  assert.equal(evaluateSharedTask({ ...question, atomicActions: 1 }).passed, false);
  assert.equal(evaluateSharedTask({ ...question, browserState: { ...question.browserState, guests: '1' } }).passed, false);
  assert.equal(evaluateSharedTask({ ...question, browserState: { ...question.browserState, receipts: [{ destination: 'Paris', guests: '1' }, receipts[1]] } }).passed, false);
});
test('aggregation retains failed times and missing outcomes in the denominator', () => {
  const aggregate = aggregateRuns([
    { product: 'jevry', repetition: 1, report: { turns: [{ id: 'paris-two', passed: true, durationMs: 10 }] } },
    { product: 'jevry', repetition: 2, report: { turns: [{ id: 'paris-two', passed: false, durationMs: 90 }] } },
  ]);
  assert.equal(aggregate.jevry.expectedTurns, 15);
  assert.equal(aggregate.jevry.automaticPassed, 1);
  assert.equal(aggregate.jevry.failedOrMissing, 14);
  assert.deepEqual(aggregate.jevry.tasks['paris-two'].allRecordedAttemptMs.values, [10, 90]);
  assert.deepEqual(aggregate.jevry.tasks['paris-two'].automaticPassMs.values, [10]);
  assert.equal(aggregate['firecrawl-source'].failedOrMissing, 15);
  assert.equal(distribution([undefined, NaN]).median, null);
});
