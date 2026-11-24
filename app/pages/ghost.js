'use strict';
(() => {
  const { h } = OW.ui;
  const DEFAULT_THRESHOLD = 0.3;
  const MAX_WORDS = 8;
  const LONG_PRESS_MS = 450;
  const MAX_HINTS = 3;

  const DEMO_CONTEXT = {
    workspace: 'Harbor',
    specs: [
      { title: 'Magic-link sign-in', aliases: ['magic-link sign-in'] },
      { title: 'Usage-based seat billing', aliases: ['seat billing', 'usage-based seat billing'] },
      { title: 'Audit log export', aliases: ['audit log export'] },
      { title: 'Project activity digest', aliases: ['project activity digest'] },
    ],
    tickets: [
      { number: 42, title: 'Usage-based seat billing' },
    ],
    grills: [
      {
        code: 'J1',
        spec: 'Usage-based seat billing',
        recs: ['At month end', 'Viewers free', '7 days'],
      },
    ],
    phrases: [
      { text: 'all recs', weight: 1.0 },
      { text: 'take all the recommended answers', weight: 0.72 },
      { text: 'merge that', weight: 0.65 },
      { text: 'ship it', weight: 0.65 },
    ],
  };

  function capWords(text, limit = MAX_WORDS) {
    const tokens = text.match(/\s*\S+/g);
    if (!tokens || tokens.length <= limit) return text;
    return tokens.slice(0, limit).join('');
  }

  function buildEntries(context) {
    const seen = new Map();
    const add = (text, weight) => {
      const clean = String(text || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      const prev = seen.get(key);
      if (!prev || weight > prev.weight) seen.set(key, { text: clean, lower: key, weight });
    };

    for (const grill of context.grills || []) {
      if (!grill.code) continue;
      add(`${grill.code} all recs`, 1.0);
    }
    for (const ticket of context.tickets || []) {
      if (ticket.number == null) continue;
      add(`approve #${ticket.number} and merge`, 0.98);
      add(`merge #${ticket.number}`, 0.74);
      add(`ship #${ticket.number}`, 0.7);
    }
    for (const spec of context.specs || []) {
      const names = spec.aliases && spec.aliases.length ? spec.aliases : [spec.title];
      for (const name of names) {
        add(`ship ${name}`, 0.94);
        add(`the ${name} spec`, 0.94);
      }
    }
    for (const phrase of context.phrases || []) {
      if (typeof phrase === 'string') add(phrase, 0.8);
      else add(phrase.text, phrase.weight ?? 0.8);
    }
    return [...seen.values()];
  }

  function buildTrie(entries) {
    const root = { children: Object.create(null), items: [] };
    for (const entry of entries) {
      let node = root;
      for (const ch of entry.lower) {
        if (!node.children[ch]) node.children[ch] = { children: Object.create(null), items: [] };
        node = node.children[ch];
        node.items.push(entry);
      }
    }
    return root;
  }

  function createRecall(context = DEMO_CONTEXT, options = {}) {
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const entries = buildEntries(context);
    const trie = buildTrie(entries);
    let seq = 0;

    function lookup(fragment) {
      if (fragment.length < 2) return null;
      let node = trie;
      const lower = fragment.toLowerCase();
      for (const ch of lower) {
        node = node.children[ch];
        if (!node) return null;
      }
      let best = null;
      for (const entry of node.items) {
        if (entry.text.length <= fragment.length) continue;
        const suffix = capWords(entry.text.slice(fragment.length));
        if (!suffix) continue;
        const ratio = fragment.length / entry.text.length;
        const confidence = Number((entry.weight * (0.45 + 0.55 * ratio)).toFixed(4));
        if (confidence < threshold) continue;
        if (!best || confidence > best.confidence || (confidence === best.confidence && entry.text.length < best.entryLen)) {
          best = { suffix, confidence, entryLen: entry.text.length };
        }
      }
      return best;
    }

    return {
      complete(prefix) {
        if (typeof prefix !== 'string' || !prefix.trim()) return null;
        // Try full prefix first, then trailing word-boundary fragments.
        const starts = [0];
        for (let i = 1; i < prefix.length; i++) {
          if (/\s/.test(prefix[i - 1]) && !/\s/.test(prefix[i])) starts.push(i);
        }
        for (const start of starts) {
          const fragment = prefix.slice(start);
          const match = lookup(fragment);
          if (match) {
            return {
              id: `recall-${++seq}`,
              tier: 'recall',
              text: prefix + match.suffix,
              suffix: match.suffix,
              confidence: match.confidence,
            };
          }
        }
        return null;
      },
    };
  }

  function nextWordChunk(suffix) {
    const m = suffix.match(/^(\s*\S+)/);
    return m ? m[1] : suffix;
  }

  function attach(textarea, options = {}) {
    if (!textarea || textarea.dataset.ghostReady === '1') return null;
    let recall = options.recall || createRecall(DEMO_CONTEXT);
    const onEvent = options.onEvent || null;
    const onSubmit = options.onSubmit || null;
    const onInput = options.onInput || null;

    const prefixEl = h('span', { class: 'v2-ghost-prefix' });
    const suffixEl = h('span', { class: 'v2-ghost-suffix' });
    const hintEl = h('span', { class: 'v2-ghost-hint', hidden: true }, 'Tab');
    const mirror = h('div', { class: 'v2-ghost-mirror', 'aria-hidden': 'true' }, prefixEl, suffixEl, hintEl);
    const field = h('div', { class: 'v2-ghost-field' }, mirror);

    textarea.parentNode.insertBefore(field, textarea);
    field.append(textarea);
    textarea.dataset.ghostReady = '1';

    let current = null;
    let lastValue = textarea.value;
    let composing = false;
    let dismissed = false;
    let hintCount = 0;
    let hintActive = false;
    let asyncController = null;
    let asyncTimer = null;

    function autoGrow() {
      textarea.style.height = 'auto';
      const max = 144;
      const next = Math.min(max, Math.max(44, textarea.scrollHeight));
      textarea.style.height = `${next}px`;
      textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
      mirror.scrollTop = textarea.scrollTop;
    }

    function render() {
      prefixEl.textContent = textarea.value;
      const suffix = current?.suffix || '';
      suffixEl.textContent = suffix;
      hintEl.hidden = !(suffix && hintActive);
      mirror.scrollTop = textarea.scrollTop;
    }

    function cancelAsync() {
      clearTimeout(asyncTimer);
      asyncTimer = null;
      if (asyncController) {
        asyncController.abort();
        asyncController = null;
      }
    }

    function clearGhost() {
      cancelAsync();
      current = null;
      hintActive = false;
      render();
    }

    function showSuggestion(suggestion) {
      const hadGhost = Boolean(current && current.suffix);
      current = suggestion && suggestion.suffix ? { ...suggestion } : null;
      if (current && !hadGhost) {
        hintCount += 1;
        hintActive = hintCount <= MAX_HINTS;
        onEvent?.({ type: 'shown', id: current.id, tier: current.tier });
      } else if (!current) {
        hintActive = false;
      }
      render();
    }

    function caretAtEnd() {
      return textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length;
    }

    function evaluate() {
      cancelAsync();
      const value = textarea.value;
      if (composing || dismissed || !caretAtEnd()) {
        current = null;
        hintActive = false;
        render();
        return;
      }
      const suggestion = recall ? recall.complete(value) : null;
      showSuggestion(suggestion);

      // Seam for WS2 live engine tier (30 ms idle, abort on next keystroke, drop stale replies).
      if (typeof options.complete === 'function' && value.trim()) {
        const snapshot = value;
        asyncTimer = setTimeout(async () => {
          const controller = new AbortController();
          asyncController = controller;
          try {
            const remote = await options.complete(snapshot, controller.signal);
            if (controller.signal.aborted || textarea.value !== snapshot || composing || dismissed || !caretAtEnd()) return;
            if (!current && remote && remote.suffix) showSuggestion(remote);
          } catch {
            // Engine unavailable or aborted: keep in-page recall silently.
          }
        }, 30);
      }
    }

    function acceptAll() {
      if (!current || !current.suffix) return false;
      const accepted = current;
      const next = textarea.value + accepted.suffix;
      textarea.value = next;
      textarea.setSelectionRange(next.length, next.length);
      lastValue = next;
      current = null;
      hintActive = false;
      dismissed = false;
      autoGrow();
      render();
      onEvent?.({ type: 'accepted', id: accepted.id, tier: accepted.tier });
      onInput?.(next);
      return true;
    }

    function acceptWord() {
      if (!current || !current.suffix) return false;
      const chunk = nextWordChunk(current.suffix);
      const next = textarea.value + chunk;
      const remaining = current.suffix.slice(chunk.length);
      const id = current.id;
      const tier = current.tier;
      textarea.value = next;
      textarea.setSelectionRange(next.length, next.length);
      lastValue = next;
      if (remaining) {
        current = { ...current, suffix: remaining, text: next + remaining };
      } else {
        current = null;
        hintActive = false;
      }
      autoGrow();
      render();
      onEvent?.({ type: 'accepted_word', id, tier, chunk });
      onInput?.(next);
      return true;
    }

    function handleInput() {
      autoGrow();
      const value = textarea.value;
      onInput?.(value);
      if (composing) {
        lastValue = value;
        clearGhost();
        return;
      }
      if (!caretAtEnd()) {
        lastValue = value;
        clearGhost();
        return;
      }
      if (dismissed) {
        if (!value) {
          dismissed = false;
        } else if (value.startsWith(lastValue) && /\s/.test(value.slice(lastValue.length))) {
          dismissed = false;
        } else if (value.length < lastValue.length && /\s$/.test(value)) {
          dismissed = false;
        } else {
          lastValue = value;
          render();
          return;
        }
      }
      if (current && current.suffix && value.startsWith(lastValue) && value.length > lastValue.length) {
        const typed = value.slice(lastValue.length);
        if (current.suffix.startsWith(typed)) {
          const remaining = current.suffix.slice(typed.length);
          const id = current.id;
          const tier = current.tier;
          lastValue = value;
          onEvent?.({ type: 'typed_through', id, tier, typed });
          if (remaining) {
            current = { ...current, suffix: remaining };
            render();
            return;
          }
          clearGhost();
          return;
        }
        onEvent?.({ type: 'typed_over', id: current.id, tier: current.tier });
        current = null;
        hintActive = false;
      }
      lastValue = value;
      evaluate();
    }

    function handleKeydown(event) {
      if (composing || event.isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        onSubmit?.();
        return;
      }
      if (!current || !current.suffix) return;
      if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        acceptAll();
        return;
      }
      if (event.key === 'ArrowRight' && !event.shiftKey && !event.metaKey) {
        if (event.ctrlKey || event.altKey || caretAtEnd()) {
          event.preventDefault();
          acceptWord();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        const dismissedId = current.id;
        const dismissedTier = current.tier;
        dismissed = true;
        clearGhost();
        onEvent?.({ type: 'dismissed', id: dismissedId, tier: dismissedTier });
      }
    }

    function handleSelection() {
      if (!composing && current && !caretAtEnd()) clearGhost();
    }

    // Touch on ghost text: short tap accepts next word, long-press accepts all.
    let touchTimer = null;
    let touchLongFired = false;
    let touchStartPt = null;

    function cancelTouch() {
      clearTimeout(touchTimer);
      touchTimer = null;
      touchStartPt = null;
    }

    suffixEl.addEventListener('pointerdown', event => {
      if (!current || !current.suffix) return;
      if (event.pointerType === 'mouse') {
        event.preventDefault();
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        return;
      }
      event.preventDefault();
      touchLongFired = false;
      touchStartPt = { x: event.clientX, y: event.clientY };
      touchTimer = setTimeout(() => {
        touchTimer = null;
        touchLongFired = true;
        acceptAll();
        textarea.focus({ preventScroll: true });
      }, LONG_PRESS_MS);
    });

    suffixEl.addEventListener('pointermove', event => {
      if (!touchStartPt) return;
      if (Math.hypot(event.clientX - touchStartPt.x, event.clientY - touchStartPt.y) > 12) cancelTouch();
    });

    suffixEl.addEventListener('pointerup', event => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      const hadPending = touchTimer !== null;
      cancelTouch();
      if (!touchLongFired && hadPending) {
        acceptWord();
        textarea.focus({ preventScroll: true });
      }
    });

    suffixEl.addEventListener('pointercancel', cancelTouch);

    textarea.addEventListener('input', handleInput);
    textarea.addEventListener('keydown', handleKeydown);
    textarea.addEventListener('scroll', () => { mirror.scrollTop = textarea.scrollTop; });
    textarea.addEventListener('click', handleSelection);
    textarea.addEventListener('keyup', handleSelection);
    textarea.addEventListener('compositionstart', () => { composing = true; clearGhost(); });
    textarea.addEventListener('compositionend', () => { composing = false; lastValue = textarea.value; evaluate(); });

    autoGrow();
    render();

    return {
      sync() {
        lastValue = textarea.value;
        autoGrow();
        evaluate();
      },
      clear() {
        dismissed = false;
        lastValue = textarea.value;
        autoGrow();
        clearGhost();
      },
      setValue(value) {
        textarea.value = value;
        textarea.setSelectionRange(value.length, value.length);
        lastValue = value;
        dismissed = false;
        autoGrow();
        clearGhost();
        onInput?.(value);
      },
      setRecall(nextRecall) {
        recall = nextRecall;
        evaluate();
      },
      destroy() {
        cancelAsync();
        cancelTouch();
      },
    };
  }

  OW.ghost = { DEMO_CONTEXT, createRecall, attach };
})();
