import { validateChoice, type JevRequest, type JevResponse, type ObservedAction } from './engine';

// Choice limits and independent fan-out semantics:
// https://docs.typesafe.ai/api
// https://docs.typesafe.ai/patterns/fan-out
// Experimental only: selecting a complete action avoids conditioning a target
// head on an operation that another independent head has not selected yet.
export const WEB_ACTION_HEAD = 'web_action';
export const MAX_WEB_ACTION_CHOICES = 240;

export interface WebActionReference { readonly operation: string; readonly target?: string }
export interface CompiledWebActions {
  readonly body: JevRequest;
  /** Only pairs actually offered by the original request; useful for replay. */
  readonly choices: Readonly<Record<string, WebActionReference>>;
}
export interface WebActionSpace {
  targets: Record<string, Record<string, ObservedAction>>;
  controls: Record<string, ObservedAction>;
}
export interface WebActionDecision extends WebActionReference {
  action?: ObservedAction;
  /** Actual joint-head confidence, not an invented operation marginal. */
  confidence: number;
  /** Probability of the selected complete action in the actual distribution. */
  probability: number;
}

const TARGET_KINDS = { CLICK: 'click', TYPE_TEXT: 'fill', SELECT: 'select', PRESS_ENTER: 'press' } as const;
const CONTROL = /^(?:WAIT|GO_BACK|SCROLL_(?:UP|DOWN)(?:_\d+)?)$/;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Pure request transformation. Undefined retains the existing fan-out schema. */
export function compileJevWebActions(request: JevRequest, options: { game?: boolean } = {}): CompiledWebActions | undefined {
  const operationHead = request.questions.operation;
  if (options.game || own(request.state, 'game_key_inputs') || !operationHead ||
      operationHead.type !== 'choice' || request.questions.select_group ||
      Object.keys(request.questions).some(key => /^select_target_\d+$/.test(key))) return;
  const operations = Object.keys(operationHead.criteria);
  if (!operations.length || operations.some(operation => operation.startsWith('KEY_') || operation === 'POINT')) return;

  const elements = new Map<string, Record<string, unknown>>();
  if (Array.isArray(request.state.elements)) for (const raw of request.state.elements) {
    const element = record(raw);
    if (!element || typeof element.index !== 'string' || elements.has(element.index)) return;
    elements.set(element.index, element);
  }
  const choices: Record<string, WebActionReference> = {};
  const criteria: Record<string, unknown> = {};
  const removed = new Set(['operation']);
  const add = (id: string, reference: WebActionReference, evidence: unknown) => {
    choices[id] = Object.freeze(reference); criteria[id] = evidence;
    return Object.keys(choices).length <= MAX_WEB_ACTION_CHOICES;
  };
  for (const operation of operations) {
    if (own(TARGET_KINDS, operation)) {
      const headName = operation.toLowerCase() + '_target';
      const head = request.questions[headName];
      if (!head || head.type !== 'choice' || !Object.keys(head.criteria).length) return;
      removed.add(headName);
      for (const [target, raw] of Object.entries(head.criteria)) {
        if (!(operation === 'SELECT' ? /^\d+:\d+$/.test(target) : /^\d+$/.test(target))) return;
        const element = elements.get(target.split(':')[0]);
        if (!element || !Array.isArray(element.operations) || !element.operations.includes(operation)) return;
        const original = record(raw) || (typeof raw === 'string' ? { element: raw } : undefined);
        if (!original || typeof original.element !== 'string') return;
        // Native SELECT target heads omit current values in the existing schema.
        // Carry the observed current field value into every complete alternative.
        const evidence: Record<string, unknown> = { ...original, operation, target };
        if (!own(evidence, 'current_value')) evidence.current_value = element.value ?? '';
        for (const key of ['role', 'checked', 'selected', 'expanded', 'frame', 'href', 'popup']) {
          if (!own(evidence, key) && own(element, key)) evidence[key] = element[key];
        }
        if (!add(operation + ':' + target, { operation, target }, evidence)) return;
      }
    } else {
      if (!['DONE', 'BLOCKED'].includes(operation) && !CONTROL.test(operation)) return;
      if (!add(operation, { operation }, { operation, description: operationHead.criteria[operation] })) return;
    }
  }
  // Preserve literal heads verbatim. Unknown or partially transformed schemas
  // fall back; silently dropping a head could discard required task evidence.
  const retained = Object.entries(request.questions).filter(([name]) => !removed.has(name));
  if (retained.some(([name]) => !/^fill_value_\d+$/.test(name))) return;
  const operationInstructions = record(operationHead.instructions);
  const instructions = {
    ...(operationInstructions?.goal !== undefined ? { goal: operationInstructions.goal } : {}),
    rules: 'Choose exactly one complete next action for the current page. Each alternative already fixes both its operation and observed target. Follow actionPolicy, user constraints, field current values, and recent_actions in state. Do not repeat satisfied steps or change an already-correct field merely because another option is offered. Finish a relevant open popup or filter-operator step before choosing unrelated background links. DONE requires all requested outcomes; selecting DONE does not itself verify success.',
  };
  return Object.freeze({
    body: { ...request, questions: { [WEB_ACTION_HEAD]: { type: 'choice' as const, criteria, instructions }, ...Object.fromEntries(retained) } },
    choices: Object.freeze(choices),
  });
}

/** Decode only the selected joint head against the same observed action space.
 * Freshness checks and input execution remain the caller's responsibility.
 * Unselected legacy/literal heads are neither read nor validated here.
 */
export function decodeJevWebAction(response: JevResponse, compiled: CompiledWebActions, space: WebActionSpace): WebActionDecision {
  const answer = validateChoice(response.answers?.[WEB_ACTION_HEAD], Object.keys(compiled.choices));
  const reference = compiled.choices[answer.choice];
  const { operation, target } = reference;
  let action: ObservedAction | undefined;
  if (target !== undefined) {
    const candidates = own(space.targets, operation) ? space.targets[operation] : undefined;
    action = candidates && own(candidates, target) ? candidates[target] : undefined;
    if (!action || action.kind !== TARGET_KINDS[operation as keyof typeof TARGET_KINDS] ||
        !Number.isSafeInteger(action.node) || action.node! < 1 || !action.id ||
        operation === 'PRESS_ENTER' && action.key !== 'Enter' || operation === 'SELECT' && typeof action.value !== 'string') {
      throw new Error('Selected complete action has no matching observed target. No action executed.');
    }
  } else if (!['DONE', 'BLOCKED'].includes(operation)) {
    action = own(space.controls, operation) ? space.controls[operation] : undefined;
    const expectedKind = operation === 'WAIT' ? 'wait' : operation === 'GO_BACK' ? 'back' : 'scroll';
    if (!action || action.kind !== expectedKind || action.id.toUpperCase() !== operation) {
      throw new Error('Selected complete action has no matching observed control. No action executed.');
    }
  }
  return { ...reference, action, confidence: answer.confidence, probability: answer.probabilities[answer.choice] };
}
