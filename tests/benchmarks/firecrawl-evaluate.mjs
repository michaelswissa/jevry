/** Shared outcome checks; no model implementation knowledge or provider calls. */
export function citedUrlsFromText(text) {
  return [...new Set((String(text || '').match(/https?:\/\/[^\s<>()[\]]+/g) || []).map(url => url.replace(/[.,;:!?]+$/, '')))];
}

export function citedUrlsFromResearch(research, answer = '') {
  if (!research) return citedUrlsFromText(answer);
  const text = [answer, research.summary, ...(research.findings || []).map(item => item.text)].filter(Boolean).join('\n');
  const ids = new Set([...text.matchAll(/\[(S\d+)\]/g)].map(match => match[1]));
  for (const finding of research.findings || []) for (const id of finding.sourceIds || []) ids.add(id);
  return [...new Set([...citedUrlsFromText(text), ...(research.sources || []).filter(source => ids.has(source.id)).map(source => source.url)])];
}

function sourceSections(text) {
  const clean = text.replace(/https?:\/\/[^\s<>()[\]]+/g, '').replace(/[*_`]/g, '');
  const matches = [...clean.matchAll(/\b(Cedar(?:\s+Stays)?|Orbit(?:\s+Rooms)?)\b/gi)];
  const result = { cedar: [], orbit: [], clean };
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1].toLowerCase().startsWith('cedar') ? 'cedar' : 'orbit';
    result[name].push(clean.slice(matches[i].index, matches[i + 1]?.index ?? clean.length));
  }
  return result;
}

export function evaluateSharedTask({ id, answer = '', status = 'complete', browserState = {}, atomicActions = 0, citedUrls = [], readUrls = [], base }) {
  const criteria = { completed: status === 'complete' };
  const count = Array.isArray(atomicActions) ? atomicActions.length : atomicActions;
  const correctReceipt = (receipt, destination) => receipt?.destination === destination && receipt?.guests === '2';
  const finalLondon = () => browserState.destination === 'London' && browserState.guests === '2' && browserState.result === 'Stays in London for 2 guests';
  const priorReceipts = browserState.receipts;
  let manualReviewRequired = false;
  if (id === 'paris-two' || id === 'london-same') {
    const destination = id === 'paris-two' ? 'Paris' : 'London';
    criteria.fields = browserState.destination === destination && browserState.guests === '2';
    criteria.result = browserState.result === `Stays in ${destination} for 2 guests`;
    criteria.receipts = Array.isArray(priorReceipts) && priorReceipts.length === (id === 'paris-two' ? 1 : 2) && correctReceipt(priorReceipts[0], 'Paris') && (id === 'paris-two' || correctReceipt(priorReceipts[1], 'London'));
  } else if (id === 'result-question') {
    const plainAnswer = answer.replace(/[*_`]/g, '');
    criteria.answer = /\bLondon\b/i.test(plainAnswer) && /\b(?:2|two)\s+guests?\b|guest\s+count\s+(?:at\s+)?(?:2|two)\b/i.test(plainAnswer);
    criteria.noMutations = count === 0;
    criteria.finalState = finalLondon();
    criteria.receipts = priorReceipts?.length === 2 && correctReceipt(priorReceipts[0], 'Paris') && correctReceipt(priorReceipts[1], 'London');
  } else if (id === 'compare-policies' || id === 'research-followup') {
    manualReviewRequired = true;
    const sections = sourceSections(answer);
    const cedar = sections.cedar.join('\n'), orbit = sections.orbit.join('\n');
    criteria.cedarDeadline = /\b24\s*(?:hours?|h)\b/i.test(cedar) && /before\s+check[ -]?in/i.test(cedar);
    criteria.cedarCancellation = /free\s+cancell?ation|refundable|cancell?able\s+free/i.test(cedar);
    criteria.noWrongRecommendation = !/(?:pick|choose|recommend(?:ation)?(?:\s+is)?|refundable\s+(?:option|choice)(?:\s+is)?)\s*[:—-]?\s*Orbit/i.test(sections.clean);
    criteria.cedarRecommended = /(?:pick|choose|recommend(?:ation)?(?:\s+is)?|refundable\s+(?:option|choice)(?:\s+is)?)\s*[:—-]?\s*Cedar/i.test(sections.clean) || /(?:only|cheaper|refundable\s+(?:option|choice))/i.test(cedar);
    if (id === 'compare-policies') {
      criteria.cedarPrice = /\b120\b/.test(cedar);
      criteria.orbitPrice = /\b95\b/.test(orbit);
      criteria.orbitNonRefundable = /non[ -]?refundable|not\s+refundable|no\s+refund/i.test(orbit);
      const contains = (urls, path) => urls.some(url => { try { const parsed = new URL(url); return parsed.origin === base && parsed.pathname === path; } catch { return false; } });
      criteria.bothActuallyRead = contains(readUrls, '/cedar') && contains(readUrls, '/orbit');
      criteria.bothActuallyCited = contains(citedUrls, '/cedar') && contains(citedUrls, '/orbit');
    }
  } else throw new Error(`Unknown shared task: ${id}`);
  return { passed: Object.values(criteria).every(Boolean), criteria, manualReviewRequired,
    ...(manualReviewRequired ? { manualReviewNote: 'Automatic source-associated fact checks cannot prove arbitrary prose has no contradictions. Inspect recommendation, price attribution, deadline, and citation support against the fixed source pages.' } : {}) };
}
