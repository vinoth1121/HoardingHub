/**
 * HoardingHub — night-billboard theme.
 *
 * index.html's inline bootstrap already resolved `data-theme` from localStorage
 * before first paint, so this module owns the control, its aria surface and the
 * OS-preference subscription. Nothing here runs at import time.
 */

/** localStorage key. Must match the inline bootstrap in index.html exactly. */
export const THEME_KEY = 'hh-theme';

const LIGHT = 'light';
const DARK = 'dark';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Browser-chrome surfaces, kept beside the tokens they mirror. */
const SURFACE = Object.freeze({ light: '#F4EFE3', dark: '#0A0A0A' });

/** Label and visible word both announce the ACTION you can take next. */
const ACTION = Object.freeze({
  light: { label: 'Switch to night billboard mode', word: 'Night' },
  dark: { label: 'Switch to day mode', word: 'Day' },
});

/** Glyph paths for the icon span; `sun` shows once night is on. */
const GLYPHS = Object.freeze({
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 1.5v2.6M12 19.9v2.6M1.5 12h2.6M19.9 12h2.6M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8',
});

/** Until the visitor toggles, the OS owns the choice. */
let followsSystem = true;

/** The `<meta name="theme-color" data-js>` tag this module owns, if it made one. */
let jsMeta = null;

/** Returned when there is no document to act on. */
const NOOP = Object.freeze({
  getTheme: () => LIGHT,
  setTheme: () => LIGHT,
  toggle: () => LIGHT,
  destroy() {},
});

/** Only the two values the design system accepts. */
function isTheme(value) {
  return value === LIGHT || value === DARK;
}

/** The stored choice, or null when absent, junk, or storage is unavailable. */
function readStored(win) {
  try {
    const stored = win?.localStorage?.getItem(THEME_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** OS preference, or false when matchMedia is missing or throws. */
function prefersDark(win) {
  try {
    return typeof win?.matchMedia === 'function' && win.matchMedia(DARK_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * Keep one unconditioned `<meta name="theme-color">` in step with the theme —
 * index.html ships only the two `prefers-color-scheme`-conditioned tags, so an
 * explicit override would otherwise leave the browser chrome on the OS colour.
 * That markup belongs to another change, so the tag is created here instead.
 */
function paintThemeColor(doc, theme) {
  if (!doc?.head) return;
  let meta = doc.head.querySelector('meta[name="theme-color"][data-js]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('data-js', '');
    doc.head.appendChild(meta);
    jsMeta = meta;
  }
  meta.setAttribute('content', SURFACE[theme]);
}

/** Rebuild `.theme-toggle-icon` with createElementNS, so no markup is parsed. */
function paintIcon(host, theme) {
  const doc = host.ownerDocument;
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', GLYPHS[theme === DARK ? 'sun' : 'moon']);
  for (const name of ['fill', 'stroke']) path.setAttribute(name, 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('stroke-width', '2');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');
  svg.appendChild(path);
  while (host.firstChild) host.removeChild(host.firstChild);
  host.appendChild(svg);
}

/** Paint the pressed state, action label, visible word, glyph and `.is-night`. */
function paintToggle(button, theme) {
  const dark = theme === DARK;
  button.setAttribute('aria-pressed', dark ? 'true' : 'false');
  button.setAttribute('aria-label', ACTION[theme].label);
  button.classList.toggle('is-night', dark);
  const word = button.querySelector('.theme-toggle-text');
  if (word) word.textContent = ACTION[theme].word;
  const icon = button.querySelector('.theme-toggle-icon');
  if (icon) paintIcon(icon, theme);
}

/** Shared core: a valid stored choice, else what the document carries. */
function readTheme(win, doc) {
  const stored = readStored(win);
  if (isTheme(stored)) return stored;
  const applied = doc?.documentElement?.dataset?.theme;
  return isTheme(applied) ? applied : LIGHT;
}

/** Shared core: apply, paint the chrome colour, and optionally persist. */
function writeTheme(win, doc, theme, persist) {
  const value = isTheme(theme) ? theme : readTheme(win, doc);
  if (doc?.documentElement) doc.documentElement.dataset.theme = value;
  paintThemeColor(doc, value);
  if (persist) {
    followsSystem = false;
    try {
      win?.localStorage?.setItem(THEME_KEY, value);
    } catch {
      // Private mode or blocked storage: the theme still applies for this page.
    }
  }
  return value;
}

/** Shared core: flip day/night and persist it as an explicit choice. */
function flipTheme(win, doc) {
  return writeTheme(win, doc, readTheme(win, doc) === DARK ? LIGHT : DARK, true);
}

/**
 * The theme in force on this page: stored choice, else the applied value, else
 * light. Total — never throws.
 *
 * @returns {'light' | 'dark'}
 */
export function getTheme() {
  return readTheme(globalThis.window, globalThis.document);
}

/**
 * Apply a theme and paint the browser-chrome colour; invalid values are ignored
 * and the current theme comes back. Persisting is the signal that the visitor
 * chose for themselves, which stops the OS being followed from then on.
 *
 * @param {'light' | 'dark'} theme
 * @param {{ persist?: boolean }} [options] false leaves storage and the
 *   system-follow flag alone, for previews and OS-driven updates.
 * @returns {'light' | 'dark'} the theme now in force
 */
export function setTheme(theme, { persist = true } = {}) {
  return writeTheme(globalThis.window, globalThis.document, theme, persist);
}

/**
 * Flip between day and night and persist it as an explicit choice.
 *
 * @returns {'light' | 'dark'} the theme now in force
 */
export function toggleTheme() {
  return flipTheme(globalThis.window, globalThis.document);
}

/**
 * Wire the theme toggle. Resolution runs stored choice -> OS preference ->
 * light, matching the bootstrap so it can never contradict the first paint.
 * The OS is followed only until the visitor makes an explicit choice.
 *
 * @param {{ document?: Document, window?: Window }} [deps]
 * @returns {{ getTheme: Function, setTheme: Function, toggle: Function, destroy: Function }}
 *   `setTheme(theme, { persist })` and `toggle()` mirror the exports and all
 *   three act on `deps`; `destroy()` removes both listeners and the meta tag
 *   this call created.
 */
export function initTheme(deps = {}) {
  const doc = deps.document ?? globalThis.document;
  const win = deps.window ?? globalThis.window;
  if (!doc || !win) return NOOP;

  const button = doc.getElementById('theme-toggle');
  const stored = readStored(win);
  if (isTheme(stored)) followsSystem = false;
  const start = isTheme(stored) ? stored : (prefersDark(win) ? DARK : LIGHT);

  const write = (theme, persist = true) => writeTheme(win, doc, theme, persist);
  const sync = (theme) => {
    if (button) paintToggle(button, theme);
    paintThemeColor(doc, theme);
    return theme;
  };
  const onClick = () => sync(flipTheme(win, doc));
  const onSystemChange = (event) => {
    if (followsSystem) sync(write(event.matches ? DARK : LIGHT, false));
  };

  let query = null;
  try {
    query = typeof win.matchMedia === 'function' ? win.matchMedia(DARK_QUERY) : null;
  } catch {
    query = null;
  }

  button?.addEventListener('click', onClick);
  if (query && typeof query.addEventListener === 'function') {
    query.addEventListener('change', onSystemChange);
  }
  sync(write(start, false));

  return Object.freeze({
    getTheme: () => readTheme(win, doc),
    setTheme: (theme, options = {}) => sync(write(theme, options.persist !== false)),
    toggle: () => sync(flipTheme(win, doc)),
    destroy() {
      button?.removeEventListener('click', onClick);
      if (query && typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', onSystemChange);
      }
      jsMeta?.remove();
      jsMeta = null;
    },
  });
}