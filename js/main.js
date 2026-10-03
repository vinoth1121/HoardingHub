/**
 * HoardingHub — the page entry point.
 *
 * index.html loads this one module and nothing else, so this file is the
 * bootstrap: it wires the four feature modules (theme, nav, estimator, booking
 * form) and owns the two things with no module of their own — the FAQ
 * accordion and the footer copyright year. Share-link copying stays inside
 * initEstimator and is deliberately not duplicated here.
 *
 * Motion policy: the ticker marquee (CSS), the estimator's number tween and
 * state changes, and nothing else — no scroll listeners, no reveal observers,
 * no counters, no carousels. The FAQ reveal is components.css's `hh-faq-open`
 * keyframe, keyed off `aria-expanded` and neutralised by base.css under
 * `prefers-reduced-motion: reduce`, so JS only flips attributes.
 *
 * Nothing runs at import time except the single bootstrap at the bottom.
 */

import { initTheme } from './theme.js';
import { initNav } from './nav.js';
import { initEstimator } from './estimator.js';
import { initBookingForm } from './form.js';

/** Arrow keys move between triggers; Enter and Space are the browser's job. */
const TRIGGER_KEYS = Object.freeze(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** TreeWalker node filter: text nodes only, so no element child is disturbed. */
const SHOW_TEXT = 4;

/** Returned when the markup a feature owns is not on the page. */
const NOOP = Object.freeze({ destroy() {} });

/**
 * Wire the FAQ accordion: `.faq-item` > `button.faq-trigger[aria-controls]` and
 * the panel it names. A click flips `aria-expanded`, the panel's `hidden` and
 * `.is-open` on the trigger. Panels are independent — opening one never closes
 * another — and focus is never trapped, because there is no dialog here.
 * @param {{ document?: Document }} [deps]
 * @returns {{ destroy: Function }} Arrow keys and Home/End walk the triggers and
 *   wrap at both ends; Enter and Space stay native. `destroy()` removes every
 *   listener and restores each panel's shipped `hidden` / expanded state.
 */
function initFaqAccordion(deps = {}) {
  const doc = deps.document ?? globalThis.document;
  if (!doc) return NOOP;

  const entries = [];
  for (const item of Array.from(doc.querySelectorAll('.faq-item'))) {
    const trigger = item.querySelector('button.faq-trigger');
    if (!trigger) continue;
    const panel = (trigger.getAttribute('aria-controls')
      ? doc.getElementById(trigger.getAttribute('aria-controls'))
      : null) ?? item.querySelector('.faq-panel');
    if (!panel) continue;
    // Defensive only: index.html already ships the role, id and labelling.
    if (!panel.id) panel.id = trigger.id;
    if (!panel.getAttribute('role')) panel.setAttribute('role', 'region');
    if (!panel.hasAttribute('aria-labelledby') && trigger.id) {
      panel.setAttribute('aria-labelledby', trigger.id);
    }
    entries.push({ trigger, panel });
  }
  if (entries.length === 0) return NOOP;

  const triggers = entries.map((entry) => entry.trigger);
  const teardown = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  };

  function setExpanded(entry, expanded) {
    entry.trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    entry.trigger.classList.toggle('is-open', expanded);
    entry.panel.hidden = !expanded;
  }

  function onClick(event) {
    const entry = entries.find((candidate) => candidate.trigger === event.currentTarget);
    if (entry) setExpanded(entry, entry.trigger.getAttribute('aria-expanded') !== 'true');
  }

  function onKeydown(event) {
    if (!TRIGGER_KEYS.includes(event.key)) return;
    const index = triggers.indexOf(event.currentTarget);
    if (index === -1) return;
    const last = triggers.length - 1;
    let next = index;
    if (event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else next = last;
    event.preventDefault();
    triggers[next]?.focus();
  }

  for (const entry of entries) {
    setExpanded(entry, entry.trigger.getAttribute('aria-expanded') === 'true');
    on(entry.trigger, 'click', onClick);
    on(entry.trigger, 'keydown', onKeydown);
  }

  return Object.freeze({
    destroy() {
      for (const off of teardown) off();
      teardown.length = 0;
      for (const entry of entries) setExpanded(entry, false);
    },
  });
}

/**
 * Rewrite only the four-digit year after the © sign, in place, inside its own
 * text node; nothing else in the line is touched. @returns {Object} `destroy()`
 * puts the text back.
 */
function initCopyrightYear(deps = {}) {
  const doc = deps.document ?? globalThis.document;
  if (!doc) return NOOP;

  const year = String(new Date().getFullYear());
  const patched = [];
  for (const node of Array.from(doc.querySelectorAll('.copyright'))) {
    const walker = typeof doc.createTreeWalker === 'function'
      ? doc.createTreeWalker(node, SHOW_TEXT)
      : null;
    if (!walker) continue;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const original = text.nodeValue ?? '';
      const sign = original.indexOf('©');
      if (sign === -1) continue;
      const match = /\d{4}/.exec(original.slice(sign));
      if (!match) continue;
      const start = sign + match.index;
      text.nodeValue = `${original.slice(0, start)}${year}${original.slice(start + 4)}`;
      patched.push([text, original]);
      break;
    }
  }
  if (patched.length === 0) return NOOP;

  return Object.freeze({
    year,
    destroy() {
      for (const [text, original] of patched) text.nodeValue = original;
      patched.length = 0;
    },
  });
}

/** The one permitted console call here, so a broken feature shows up in
 *  development instead of failing silently. It never fires on the happy path.
 *  @param {string} feature @param {unknown} error @returns {void} */
function reportFailure(feature, error) {
  globalThis.console?.error?.(`HoardingHub: ${feature} failed to start`, error);
}

/** Start every feature in its own try/catch, so one failure cannot take the
 *  page down with it. @returns {void} */
function bootstrap() {
  const features = [
    ['theme', () => initTheme()],
    ['nav', () => initNav()],
    ['estimator', () => initEstimator()],
    ['booking form', () => initBookingForm()],
    ['FAQ accordion', () => initFaqAccordion()],
    ['footer year', () => initCopyrightYear()],
  ];
  for (const [feature, start] of features) {
    try {
      start();
    } catch (error) {
      reportFailure(feature, error);
    }
  }
}

// The module script is deferred, so the DOM is normally already parsed; listen
// once only in the case where it is not.
const root = globalThis.document;
if (root) {
  try {
    if (root.readyState === 'loading') {
      root.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
      bootstrap();
    }
  } catch (error) {
    reportFailure('bootstrap', error);
  }
}