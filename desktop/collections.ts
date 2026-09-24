export interface ObservedCollection {
  label?: string;
  items: string[];
  /** One-based DOM order before hidden items are removed. */
  itemOrdinals: number[];
  totalItems: number;
  totalDomItems: number;
  truncated: boolean;
  partialItemOrdinals?: number[];
  source: { url: string; tag: string; role?: string; id?: string; collectionOrdinal: number; collectionCount: number };
}

/**
 * Prototype expression for READ_STATE: const collections = ${READ_RENDERED_COLLECTIONS}.
 * Requires its existing `elements`, CSS-visibility `visible`, and composed `closest`
 * helpers. Reads rendered DOM only. No mutations, application state, or actions.
 * Lists nested within an item remain part of that item. Nested articles are
 * emitted separately, with their text excluded from the containing article.
 */
export const READ_RENDERED_COLLECTIONS = String.raw`(() => {
  const LIMIT = 10000, MAX_ITEMS = 50, MAX_COLLECTIONS = 4;
  const LIST = 'ol,ul,[role="list"],[role="feed"]';
  const ARTICLE = 'article,[role="article"]';
  const ITEM = 'li,[role="listitem"],article,[role="article"]';
  const CHROME = 'nav,header,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"],[role="menu"],[role="menubar"],[role="listbox"]';
  const SKIP = 'nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"],[role="listbox"],script,style,noscript,template,textarea,input,select,button,[role="button"],[aria-hidden="true"],[hidden],[inert]';
  const CONTROL = 'a,button,input,select,[role="link"],[role="button"],[role="tab"],[role="menuitem"]';
  const clean = text => text.replace(/\s+/g, ' ').trim();
  const rendered = node => node?.isConnected && visible(node) && !closest(node, '[hidden],[aria-hidden="true"],[inert]');
  const rootOf = node => node.parentElement || node.getRootNode()?.host || null;
  // Some widgets nest the actual panels inside their tablist wrapper. The
  // nearest tab boundary determines chrome; a nested tablist starts chrome again.
  const tabChrome = node => closest(node, '[role="tablist"],[role="tabpanel"]')?.getAttribute('role') === 'tablist';
  const allowed = node => rendered(node) && !closest(node, CHROME) && !tabChrome(node);
  const contentClosest = (node, selector) => {
    for (let candidate = closest(node, selector); candidate; candidate = closest(rootOf(candidate), selector)) {
      if (!tabChrome(candidate)) return candidate;
    }
    return null;
  };
  const groups = [], articleGroups = new Map(), textCache = new Map();
  let scannedNodes = 0;

  // These are CSS-rendered items, even when their geometry is below the viewport.
  // Their DOM order is retained; no offviewport action IDs are created.
  for (const container of elements) {
    if (!container.matches(LIST) || !allowed(container)) continue;
    if (contentClosest(rootOf(container), LIST + ',' + ARTICLE)) continue;
    const all = [...container.querySelectorAll(ITEM)].filter(item =>
      !tabChrome(item) && contentClosest(rootOf(item), LIST) === container && !contentClosest(rootOf(item), ITEM));
    // A list may itself be inside an ordinary list item only if the outer list
    // was excluded; that is not a new independent document collection.
    if (!all.length) continue;
    groups.push({ container, all, kind: 'list' });
  }
  for (const article of elements) {
    if (!article.matches(ARTICLE) || closest(article, CHROME) || tabChrome(article) || contentClosest(rootOf(article), LIST)) continue;
    let outer = article, ancestor;
    while ((ancestor = closest(rootOf(outer), ARTICLE))) outer = ancestor;
    const container = rootOf(outer);
    if (!container || !rendered(container)) continue;
    let group = articleGroups.get(container);
    if (!group) {
      group = { container, all: [], kind: 'articles' };
      articleGroups.set(container, group); groups.push(group);
    }
    group.all.push(article);
  }
  const order = new Map(elements.map((element, i) => [element, i]));
  groups.sort((a, b) => (order.get(a.container) ?? 0) - (order.get(b.container) ?? 0));
  const separateArticles = new Set(groups.filter(group => group.kind === 'articles').flatMap(group => group.all));

  const readItem = item => {
    if (textCache.has(item)) return textCache.get(item);
    const walker = item.ownerDocument.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    const parts = []; let node, count = 0, chars = 0, clipped = false, outsideControls = false;
    while ((node = walker.nextNode())) {
      if (++scannedNodes > 30000 || ++count > 5000) { clipped = true; break; }
      const owner = node.parentElement || node.getRootNode()?.host;
      const text = clean(node.textContent || '');
      if (!text || !owner || !rendered(owner) || closest(owner, SKIP) || tabChrome(owner)) continue;
      const article = closest(owner, ARTICLE);
      if (item.matches(ARTICLE) && article !== item && separateArticles.has(article)) continue;
      // Article-local header/footer carries titles, authors and timestamps.
      // Only site chrome surrounding the collection is excluded above.
      parts.push(text); chars += text.length + 1;
      if (!closest(owner, CONTROL)) outsideControls = true;
      if (chars > 22000) { clipped = true; break; }
    }
    const result = { text: parts.join(' '), complete: !clipped, outsideControls };
    textCache.set(item, result); return result;
  };
  const distance = item => {
    const r = item.getBoundingClientRect(), height = item.ownerDocument.defaultView?.innerHeight || innerHeight;
    return r.bottom <= 0 ? -r.bottom : r.top >= height ? r.top - height : 0;
  };
  const labelOf = container => {
    const labelled = (container.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => container.getRootNode().getElementById?.(id) || container.ownerDocument.getElementById(id))
      .filter(node => node && rendered(node)).map(node => clean(node.innerText || '')).join(' ');
    const aria = clean(container.getAttribute('aria-label') || '');
    if (aria || labelled) return (aria || labelled).slice(0, 160);
    const inside = [...container.children].find(node => node.matches('h1,h2,h3,h4,h5,h6,[role="heading"]') && rendered(node));
    if (inside) return clean(inside.innerText || '').slice(0, 160);
    let preceding = container.previousElementSibling;
    for (let i = 0; preceding && i < 3; i++, preceding = preceding.previousElementSibling) {
      if (preceding.matches('h1,h2,h3,h4,h5,h6,[role="heading"]') && rendered(preceding)) return clean(preceding.innerText || '').slice(0, 160);
    }
  };
  const candidates = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const items = group.all.map((node, index) => ({ node, ordinal: index + 1 })).filter(item => rendered(item.node));
    if (!items.length) continue;
    // An unmarked list made entirely of links/buttons is a navigation candidate,
    // not sufficient evidence of a content collection. Articles retain their
    // semantic identity even when a heading is the only rendered content.
    if (group.kind === 'list' && items.every(item => {
      const data = readItem(item.node);
      return data.complete && !data.outsideControls;
    })) continue;
    let anchor = 0, nearest = Infinity;
    for (let n = 0; n < items.length; n++) {
      const current = distance(items[n].node);
      if (current < nearest) { nearest = current; anchor = n; }
    }
    candidates.push({ ...group, items, anchor, distance: nearest, ordinal: i + 1 });
  }
  // Nearest collections get the finite evidence budget. Source ordinals still
  // identify document order, so scrolling exposes a different contiguous window.
  candidates.forEach((candidate, index) => { candidate.ordinal = index + 1; });
  candidates.sort((a, b) => a.distance - b.distance || a.ordinal - b.ordinal);
  const output = []; let itemCount = 0;
  const fits = collection => JSON.stringify([...output, collection]).length <= LIMIT;
  for (const candidate of candidates) {
    if (output.length >= MAX_COLLECTIONS || itemCount >= MAX_ITEMS || scannedNodes >= 30000) break;
    const source = { url: candidate.container.ownerDocument.URL, tag: candidate.container.tagName.toLowerCase(),
      collectionOrdinal: candidate.ordinal, collectionCount: candidates.length };
    const role = candidate.container.getAttribute('role'), id = candidate.container.id;
    if (role) source.role = role;
    if (id) source.id = id;
    const collection = { label: labelOf(candidate.container), items: [], itemOrdinals: [],
      totalItems: candidate.items.length, totalDomItems: candidate.all.length, truncated: false, source };
    if (!collection.label) delete collection.label;
    if (!fits(collection)) continue;
    const available = MAX_ITEMS - itemCount;
    let full = candidate.items.length <= available;
    if (full) {
      for (const item of candidate.items) {
        const data = readItem(item.node);
        if (!data.text || !data.complete) { full = false; break; }
        collection.items.push(data.text); collection.itemOrdinals.push(item.ordinal);
        if (!fits(collection)) { full = false; break; }
      }
    }
    if (!full) {
      collection.items = []; collection.itemOrdinals = []; collection.truncated = true;
      // Start at the first item intersecting (or nearest to) the viewport. Every
      // returned item after it is contiguous in rendered document order.
      for (const item of candidate.items.slice(candidate.anchor)) {
        if (collection.items.length >= available) break;
        const data = readItem(item.node);
        if (!data.text) break;
        const trial = { ...collection, items: [...collection.items, data.text], itemOrdinals: [...collection.itemOrdinals, item.ordinal] };
        if (data.complete && fits(trial)) {
          collection.items.push(data.text); collection.itemOrdinals.push(item.ordinal); continue;
        }
        // Keep complete items whenever possible. If the first item alone is too
        // large, explicitly identify a partial excerpt rather than hiding loss.
        if (!collection.items.length) {
          let lo = 0, hi = data.text.length, accepted;
          while (lo <= hi) {
            const length = Math.floor((lo + hi) / 2);
            const text = data.text.slice(0, length);
            const partial = { ...collection, items: [text], itemOrdinals: [item.ordinal], partialItemOrdinals: [item.ordinal] };
            if (fits(partial)) { accepted = partial; lo = length + 1; } else hi = length - 1;
          }
          if (accepted?.items[0]) Object.assign(collection, accepted);
        }
        break;
      }
    }
    if (!collection.items.length) continue;
    itemCount += collection.items.length; output.push(collection);
  }
  return output;
})()`;
