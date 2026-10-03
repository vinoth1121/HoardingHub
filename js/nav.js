/**
 * HoardingHub — sticky header and the mobile nav drawer.
 *
 * Owns the scroll state on #site-header plus the off-canvas sheet: scrim,
 * focus trap, Esc, inert-when-closed and the desktop reset at 64rem. Nothing
 * runs at import time and no transition is added in JS.
 */

const DESKTOP_QUERY = '(min-width: 64rem)';
const SCROLL_PX = 8;
const FOCUSABLE = 'a[href], button, [tabindex]:not([tabindex="-1"])';
const SUPPORTS_INERT = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;

/** Returned when the drawer markup is not on the page. */
const NOOP = Object.freeze({ open() {}, close() {}, toggle() {}, destroy() {}, isOpen: () => false });

/**
 * Wire the sticky header and the mobile drawer. Without `#site-nav` the no-op
 * comes back, and nothing throws whatever else is missing from the markup.
 *
 * @param {{ document?: Document, window?: Window }} [deps]
 * @returns {{ open: Function, close: Function, toggle: Function, destroy: Function, isOpen: Function }}
 *   The drawer is described entirely by `is-open`, `nav-open`, `hidden` and the
 *   aria surface, so CSS owns every transition. `close({ restoreFocus })`
 *   restores focus to the toggle unless it is false. `destroy` removes every
 *   listener, the scrim and the header state.
 */
export function initNav(deps = {}) {
  const doc = deps.document ?? globalThis.document;
  const win = deps.window ?? globalThis.window;
  if (!doc || !win) return NOOP;

  const nav = doc.getElementById('site-nav');
  if (!nav) return NOOP;

  const header = doc.getElementById('site-header');
  const toggle = doc.getElementById('nav-toggle');
  const body = doc.body;
  const state = { open: false };
  let scrim = null;
  let muted = new Set();
  let frame = null;
  let desktop = null;

  try {
    desktop = typeof win.matchMedia === 'function' ? win.matchMedia(DESKTOP_QUERY) : null;
  } catch {
    desktop = null;
  }
  const isDesktop = () => desktop?.matches === true;

  /** The toggle first, then everything focusable inside the drawer, in order. */
  function focusables() {
    const items = [];
    if (toggle) items.push(toggle);
    for (const el of nav.querySelectorAll(FOCUSABLE)) {
      if (!el.disabled && el.getAttribute('aria-hidden') !== 'true') items.push(el);
    }
    return items;
  }

  /**
   * Off-canvas or closed means unreachable: `inert` where it exists, and
   * aria-hidden plus tabindex="-1" where it does not.
   */
  function syncHiddenState() {
    const reachable = state.open || isDesktop();
    if (SUPPORTS_INERT) {
      if (reachable) nav.removeAttribute('inert');
      else nav.setAttribute('inert', '');
      return;
    }
    if (reachable) {
      nav.removeAttribute('aria-hidden');
      for (const el of muted) el.removeAttribute('tabindex');
      muted = new Set();
      return;
    }
    nav.setAttribute('aria-hidden', 'true');
    for (const el of focusables()) {
      if (el === toggle || el.hasAttribute('tabindex')) continue;
      el.setAttribute('tabindex', '-1');
      muted.add(el);
    }
  }

  /** Create the scrim once, then raise or drop it; `hidden` unhooks it. */
  function setScrim(visible) {
    if (!scrim && body && visible) {
      scrim = doc.createElement('div');
      scrim.className = 'nav-scrim';
      scrim.hidden = true;
      scrim.addEventListener('click', onScrimClick);
      body.appendChild(scrim);
    }
    if (!scrim) return;
    scrim.hidden = !visible;
    scrim.classList.toggle('is-visible', visible);
  }

  /** Esc closes; Tab and Shift+Tab wrap around both ends of the list. */
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    const first = items[0] ?? null;
    const last = items[items.length - 1] ?? null;
    const active = doc.activeElement;
    const inside = items.includes(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last?.focus();
      }
      return;
    }
    if (!inside || active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  /** Any in-drawer link closes the sheet but leaves focus with the anchor. */
  function onNavClick(event) {
    const origin = event.target;
    const link = typeof origin?.closest === 'function' ? origin.closest('a[href]') : null;
    if (link && nav.contains(link)) close({ restoreFocus: false });
  }

  function onToggleClick() {
    if (state.open) close();
    else open();
  }

  function onScrimClick() {
    close();
  }

  /** Past 8px the header gains its solid backing; CSS owns that transition. */
  function onScroll() {
    if (frame !== null) return;
    const paint = () => {
      frame = null;
      header?.classList.toggle('is-scrolled', (win.scrollY || 0) > SCROLL_PX);
    };
    if (typeof win.requestAnimationFrame === 'function') frame = win.requestAnimationFrame(paint);
    else paint();
  }

  /** >= 64rem resets the drawer in CSS, so the JS state has to reset too. */
  function onViewportChange(event) {
    if (event.matches) close({ restoreFocus: false });
    syncHiddenState();
  }

  /** The button's whole aria surface in one place: expanded state plus label. */
  function setToggleState(expanded) {
    toggle?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle?.setAttribute('aria-label', expanded ? 'Close menu' : 'Open menu');
  }

  /**
   * Open: reveal the sheet, lock scroll, flip the aria surface, raise the
   * scrim, make the links reachable and move focus onto the first one.
   */
  function open() {
    if (state.open) return;
    state.open = true;
    nav.classList.add('is-open');
    body?.classList.add('nav-open');
    setToggleState(true);
    setScrim(true);
    syncHiddenState();
    doc.addEventListener('keydown', onKeydown);
    const items = focusables();
    (items[1] ?? items[0])?.focus();
  }

  /**
   * Close and undo every open-time change. Focus returns to the toggle unless
   * `restoreFocus` is false: a link click must leave focus on the anchor, and a
   * viewport change must not yank it off the page.
   */
  function close(options = {}) {
    const wasOpen = state.open;
    state.open = false;
    nav.classList.remove('is-open');
    body?.classList.remove('nav-open');
    setToggleState(false);
    setScrim(false);
    doc.removeEventListener('keydown', onKeydown);
    syncHiddenState();
    if (wasOpen && options.restoreFocus !== false && typeof toggle?.focus === 'function') {
      toggle.focus();
    }
  }

  toggle?.addEventListener('click', onToggleClick);
  nav.addEventListener('click', onNavClick);
  win.addEventListener('scroll', onScroll, { passive: true });
  if (desktop && typeof desktop.addEventListener === 'function') {
    desktop.addEventListener('change', onViewportChange);
  }
  syncHiddenState();
  onScroll();

  return Object.freeze({
    open,
    close,
    toggle() {
      if (state.open) close();
      else open();
      return state.open;
    },
    destroy() {
      close({ restoreFocus: false });
      toggle?.removeEventListener('click', onToggleClick);
      nav.removeEventListener('click', onNavClick);
      scrim?.removeEventListener('click', onScrimClick);
      win.removeEventListener('scroll', onScroll);
      if (desktop && typeof desktop.removeEventListener === 'function') {
        desktop.removeEventListener('change', onViewportChange);
      }
      if (frame !== null && typeof win.cancelAnimationFrame === 'function') {
        win.cancelAnimationFrame(frame);
      }
      frame = null;
      for (const el of muted) el.removeAttribute('tabindex');
      muted = new Set();
      nav.removeAttribute('inert');
      nav.removeAttribute('aria-hidden');
      header?.classList.remove('is-scrolled');
      scrim?.remove();
      scrim = null;
    },
    isOpen() {
      return state.open;
    },
  });
}