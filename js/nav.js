/**
 * HoardingHub — sticky header and the mobile nav drawer.
 *
 * Owns the scroll state on #site-header plus the off-canvas sheet: scrim,
 * focus trap, Esc, inert-when-closed and the desktop reset at 64rem. Focus
 * moves into the sheet only once the sheet can take it, because visibility
 * transitions in CSS and a visibility:hidden subtree refuses focus.
 * Nothing runs at import time and no transition is added in JS.
 */

const DESKTOP_QUERY = '(min-width: 64rem)';
const SCROLL_PX = 8;
const FOCUSABLE = 'a[href], button, [tabindex]:not([tabindex="-1"])';
const SUPPORTS_INERT = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;

/** --dur in css/layout.css is 220ms. This outlasts it, so the safety net still
 *  lands when reduced motion skips the transition entirely. */
const FOCUS_FALLBACK_MS = 260;

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
  let destroyed = false;
  let navHadTabindex = false;
  // Deferred focus: the handles to cancel, plus the token that says whether a
  // scheduled focus still belongs to the drawer that is open right now.
  let focusFrame = null;
  let focusTimer = null;
  let focusOnEnd = null;
  let focusTicket = 0;

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

  /** Release the deferred-focus handles without invalidating the token. */
  function clearFocusHandles() {
    if (focusFrame !== null && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(focusFrame);
    focusFrame = null;
    if (focusTimer !== null) win.clearTimeout(focusTimer);
    focusTimer = null;
    if (focusOnEnd !== null) {
      nav.removeEventListener('transitionend', focusOnEnd);
      focusOnEnd = null;
    }
  }

  /**
   * Drop the focus still in flight and invalidate it. Every open and every
   * close bumps the token, so a deferral made for an earlier drawer can never
   * land on the page that has moved on: a fast Escape cannot have focus stolen
   * back out of the toggle it just restored focus to.
   */
  function cancelPendingFocus() {
    focusTicket += 1;
    clearFocusHandles();
  }

  /** True once the sheet can take focus at all: not hidden, not display:none. */
  function drawerIsFocusable() {
    if (typeof win.getComputedStyle !== 'function') return true;
    try {
      const style = win.getComputedStyle(nav);
      return style.visibility !== 'hidden' && style.display !== 'none';
    } catch {
      return true;
    }
  }

  /**
   * Put focus on the first link in the sheet, falling back to the sheet itself
   * so an open can never leave focus stranded outside the drawer. final forces
   * the attempt even if the sheet still reports itself hidden, which is the
   * timeout path rather than the transition one.
   */
  function attemptFocus(ticket, final) {
    if (ticket !== focusTicket || destroyed || !state.open) return;
    // Not focusable yet, so leave the timeout and the transitionend armed.
    if (!final && !drawerIsFocusable()) return;
    clearFocusHandles();
    const items = focusables();
    // items[0] is the toggle when there is one, so the first LINK is items[1];
    // without a toggle the list is links only and the first one is items[0].
    const target = (toggle ? items[1] : items[0]) ?? nav;
    if (typeof target?.focus === 'function') target.focus();
    if (!nav.contains(doc.activeElement) && typeof nav.focus === 'function') nav.focus();
  }

  /**
   * Focus has to wait for the sheet to be focusable. css/layout.css transitions
   * visibility over --dur, so in the same task that adds is-open the computed
   * value is still hidden and the browser discards a synchronous focus(). Three
   * paths race and the first one to find the sheet focusable wins: a double rAF
   * (one frame to start the transition, one for the style to resolve), the
   * visibility transition ending, and a timeout longer than the transition for
   * the reduced-motion case, where no transition runs at all.
   */
  function scheduleFocus() {
    cancelPendingFocus();
    const ticket = focusTicket;
    if (typeof win.setTimeout === 'function') {
      focusTimer = win.setTimeout(() => {
        focusTimer = null;
        attemptFocus(ticket, true);
      }, FOCUS_FALLBACK_MS);
    }
    focusOnEnd = (event) => {
      if (event.target !== nav || event.propertyName !== 'visibility') return;
      attemptFocus(ticket, false);
    };
    nav.addEventListener('transitionend', focusOnEnd);
    if (typeof win.requestAnimationFrame !== 'function') return;
    focusFrame = win.requestAnimationFrame(() => {
      focusFrame = win.requestAnimationFrame(() => attemptFocus(ticket, false));
    });
  }

  /**
   * Open: reveal the sheet, lock scroll, flip the aria surface, raise the
   * scrim, make the links reachable and schedule focus onto the first one.
   * The focus call is deferred rather than synchronous; see scheduleFocus.
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
    scheduleFocus();
  }

  /**
   * Close and undo every open-time change. Focus returns to the toggle unless
   * `restoreFocus` is false: a link click must leave focus on the anchor, and a
   * viewport change must not yank it off the page.
   */
  function close(options = {}) {
    const wasOpen = state.open;
    state.open = false;
    // A pending open-focus must never fire into a drawer that has just shut.
    cancelPendingFocus();
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
  // A programmatic focus target for the sheet itself, so an open can never
  // leave focus outside the drawer. destroy() takes it away again.
  navHadTabindex = nav.hasAttribute('tabindex');
  if (!navHadTabindex) nav.setAttribute('tabindex', '-1');
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
      destroyed = true;
      close({ restoreFocus: false });
      cancelPendingFocus();
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
      if (!navHadTabindex) nav.removeAttribute('tabindex');
      header?.classList.remove('is-scrolled');
      scrim?.remove();
      scrim = null;
    },
    isOpen() {
      return state.open;
    },
  });
}