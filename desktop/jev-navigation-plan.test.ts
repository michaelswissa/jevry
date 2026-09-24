import { describe, expect, it, vi } from 'vitest';
import { tryJevNavigationPlan, type JevNavigationPage } from './jev-navigation-plan';
import type { JevInference, JevRequest, JevResponse } from './engine';

const page: JevNavigationPage = {
  url: 'https://example.test/projects', title: 'Projects', text: 'Projects My todos Profile',
  links: ['https://example.test/dashboard/todos', 'https://example.test/profile'],
  navigationLinks: [{ url: 'https://example.test/dashboard/todos', label: 'My todos' }, { url: 'https://example.test/profile', label: 'Profile' }],
};
const config = { apiKey: 'unused-offline-test-key' };
function confident(body: JevRequest, intent = 'SIMPLE_NAVIGATION', target = 'link_1'): JevResponse {
  return { answers: Object.fromEntries(Object.entries(body.questions).map(([name, head]) => {
    const choice = name === 'navigation_intent' ? intent : target;
    return [name, { choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(head.criteria).map(key => [key, Number(key === choice)])) }];
  })) };
}
const infer = () => vi.fn<JevInference>(async (_config, body) => confident(body));

describe('Jev observed navigation planner', () => {
  it('plans a single observed destination with one speculative call and retains the full request', async () => {
    const call = infer();
    const goal = 'Open my todos.\n\nRemain within this site. Do not switch accounts.';
    const result = await tryJevNavigationPlan({ goal, page, jevConfig: config }, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(Object.keys(call.mock.calls[0][1].questions)).toEqual(['navigation_intent', 'navigation_target']);
    expect(result).toMatchObject({ intent: 'act', goal, memory: '', startUrl: 'https://example.test/dashboard/todos' });
    expect(result?.contract?.success).toEqual(['The requested destination is open and visible: Open my todos.']);
    expect(result?.reply).not.toMatch(/opened|done|complete/i);
    expect(result?.responseFormat).toBeUndefined();
  });

  it('supports URL-only observed links without inventing a label or path', async () => {
    const call = infer();
    const result = await tryJevNavigationPlan({ goal: 'Go to my todos', page: { ...page, navigationLinks: undefined }, jevConfig: config }, call);
    expect(result?.startUrl).toBe(page.links![0]);
    expect(call.mock.calls[0][1].state.observedLinks).toEqual({ link_1: { url: page.links![0], label: 'dashboard todos' }, link_2: { url: page.links![1], label: 'profile' } });
  });

  it('preserves an explicit JSON format while keeping schema fields out of success', async () => {
    const goal = 'Open my todos.\n\nReturn the final answer as JSON with {"status":"SUCCESS","data":null}.';
    const result = await tryJevNavigationPlan({ goal, page, jevConfig: config }, infer());
    expect(result?.goal).toBe(goal);
    expect(result?.responseFormat).toBe('json');
    expect(result?.contract?.success.join(' ')).not.toContain('status');
    expect(result?.contract?.responseRequirements?.[0]).toContain('JSON');
    const inline = await tryJevNavigationPlan({ goal: 'Open my todos. Return JSON only.', page, jevConfig: config }, infer());
    expect(inline?.responseFormat).toBe('json');
  });

  it('does not infer a response format from the destination name', async () => {
    const result = await tryJevNavigationPlan({ goal: 'Open the JSON documentation', page, jevConfig: config }, infer());
    expect(result?.responseFormat).toBeUndefined();
  });

  it.each([
    'Hello!', 'Can you explain my todos?', 'Show me how the page works', 'Open it again',
    'Go back to those issues', 'Continue', 'Open the game and win', 'Open 2048',
    'Show the latest issues', 'Open issues with filters applied', 'Open todos then profile',
    'Show how many issues there are', 'Show my account and delete it', 'Open the logout link',
    'Open my profile and change my bio', 'Navigate to checkout', 'Open',
  ])('defers unsupported or ambiguous request without making a call: %s', async goal => {
    const call = infer();
    expect(await tryJevNavigationPlan({ goal, page, jevConfig: config }, call)).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
  });

  it('offers only safe observed same-origin destinations, excluding effects and credential URLs', async () => {
    const unsafe = [
      { url: 'https://other.test/todos', label: 'My todos' },
      { url: '/users/sign_out', label: 'Account' },
      { url: '/profile/%64elete', label: 'Profile' },
      { url: '/profile?do=delete', label: 'Profile' },
      { url: '/redirect?url=https://other.test', label: 'My todos' },
      { url: '/profile', label: 'Unsubscribe now' },
      { url: 'https://user:password@example.test/todos', label: 'Todos' },
      { url: 'javascript:alert(1)', label: 'Todos' },
      { url: '/orders/confirm', label: 'Orders' },
    ];
    const call = infer();
    expect(await tryJevNavigationPlan({ goal: 'Open my todos', page: { ...page, links: [], navigationLinks: unsafe }, jevConfig: config }, call)).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
  });

  it('does not permit the model to propose an unobserved path', async () => {
    const call = vi.fn<JevInference>(async (_config, body) => confident(body, 'SIMPLE_NAVIGATION', 'https://example.test/guessed'));
    expect(await tryJevNavigationPlan({ goal: 'Open my todos', page, jevConfig: config }, call)).toBeUndefined();
  });

  it('cannot reintroduce an unsafe labeled destination through its unlabeled URL duplicate', async () => {
    const call = infer();
    expect(await tryJevNavigationPlan({ goal: 'Open my account', page: { ...page, links: ['https://example.test/account'], navigationLinks: [{ url: 'https://example.test/account', label: 'Delete account' }] }, jevConfig: config }, call)).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
  });

  it('defers when either independent head is uncertain or requires more than navigation', async () => {
    for (const name of ['navigation_intent', 'navigation_target']) {
      for (const weak of ['confidence', 'probability']) {
        const call: JevInference = async (_config, body) => {
          const result = confident(body);
          const head = result.answers[name];
          if (weak === 'confidence') head.confidence = 0.94;
          else {
            head.probabilities[head.choice] = 0.97;
            head.probabilities[name === 'navigation_intent' ? 'OTHER' : 'NONE'] = 0.03;
          }
          return result;
        };
        expect(await tryJevNavigationPlan({ goal: 'Open my todos', page, jevConfig: config }, call)).toBeUndefined();
      }
    }
    for (const [intent, target] of [['OTHER', 'link_1'], ['SIMPLE_NAVIGATION', 'NONE']]) {
      expect(await tryJevNavigationPlan({ goal: 'Open my todos', page, jevConfig: config }, async (_config, body) => confident(body, intent, target))).toBeUndefined();
    }
  });

  it('sends all extra user requirements to both independent decisions', async () => {
    const goal = 'Open my todos.\n\nThen change my profile.';
    const call = vi.fn<JevInference>(async (_config, body) => {
      expect(body.state.userGoal).toBe(goal);
      return confident(body, 'OTHER');
    });
    expect(await tryJevNavigationPlan({ goal, page, jevConfig: config }, call)).toBeUndefined();
  });

  it('defers malformed provider answers and provider failures', async () => {
    for (const call of [async () => { throw new Error('offline'); }, async () => ({ answers: {} })]) {
      expect(await tryJevNavigationPlan({ goal: 'Open my todos', page, jevConfig: config }, call)).toBeUndefined();
    }
  });

  it('propagates user cancellation before or during inference', async () => {
    const controller = new AbortController();
    const call = infer();
    controller.abort(new Error('user stopped'));
    await expect(tryJevNavigationPlan({ goal: 'Open my todos', page, jevConfig: config, signal: controller.signal }, call)).rejects.toThrow('user stopped');
    expect(call).not.toHaveBeenCalled();
    const second = new AbortController();
    await expect(tryJevNavigationPlan({ goal: 'Open my todos', page, jevConfig: config, signal: second.signal }, async (_config, body) => {
      second.abort(new Error('stop now'));
      return confident(body);
    })).rejects.toThrow('stop now');
  });

  it('falls back at its deadline even when an inference transport ignores cancellation', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    try {
      let finish!: (result: JevResponse) => void;
      let body!: JevRequest;
      const call: JevInference = async (_config, request) => {
        body = request;
        return new Promise(resolve => { finish = resolve; });
      };
      const pending = tryJevNavigationPlan({ goal: 'Open my todos', page, jevConfig: config }, call);
      await Promise.resolve();
      deadline.abort(new Error('deadline'));
      expect(await pending).toBeUndefined();
      expect(timeout).toHaveBeenCalledWith(3000);
      finish(confident(body));
    } finally { timeout.mockRestore(); }
  });

  it('rejects unsupported pages, missing credentials and oversized goals without calling Jev', async () => {
    const call = infer();
    for (const input of [
      { goal: 'Open my todos', page: { ...page, url: 'about:blank' }, jevConfig: config },
      { goal: 'Open my todos', page, jevConfig: { apiKey: '' } },
      { goal: 'Open my todos\n\n' + 'constraint '.repeat(2000), page, jevConfig: config },
    ]) expect(await tryJevNavigationPlan(input, call)).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
  });
});
