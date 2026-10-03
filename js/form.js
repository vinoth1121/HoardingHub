/**
 * HoardingHub — booking form.
 *
 * Two halves: a PURE CORE (no DOM, no globals, testable on its own) and a UI
 * BINDING at the bottom that only reads controls and writes text. No backend
 * and no network — a valid submit stages the enquiry in the page and hands the
 * visitor a prefilled `mailto:` fallback they send themselves, so nothing is
 * stored and no history entry is written. Every entry point is total: an
 * unknown field name or a non-string value falls back to a message, not a throw.
 * Error copy is in the page's own voice: plain, specific, always actionable.
 */

import { CITY_IDS, getCity } from './data.js';

/* ---------------------------------------------------------------- PURE CORE */

/** The patterns, limits and visitor-facing copy, in one frozen register. */
export const VALIDATION = Object.freeze({
  name: Object.freeze({
    min: 2,
    max: 80,
    letters: /\p{L}/u, // any Unicode letter, so Devanagari names still pass
  }),
  email: Object.freeze({
    max: 120,
    pattern: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i, // pragmatic on purpose
  }),
  phone: Object.freeze({
    digits: 10,
    separators: /[\s\-()]/g, // spaces, dashes, parens: how numbers get typed
    plus: /\+/g, // a `+` only ever belongs to the +91 prefix
    countryCode: /^(?:91|0)/, // dropped only when >10 digits survive
    pattern: /^[6-9]\d{9}$/, // Indian mobiles begin 6-9
  }),
  city: Object.freeze({ ids: Object.freeze([...CITY_IDS]) }),
  message: Object.freeze({ max: 1000 }),
  messages: Object.freeze({
    name: Object.freeze({
      empty: 'Tell us your name — at least 2 characters.',
      short: 'Add at least 2 characters so we know who to reply to.',
      long: 'Keep your name under 80 characters — a contact name, not a company.',
      letters: 'Put letters in the name field — a number alone is not a name.',
    }),
    email: Object.freeze({
      empty: 'We need an email address to send the site map to.',
      shape: 'That email is missing an @ or a domain — check for a typo.',
      long: 'Keep the email under 120 characters.',
    }),
    phone: Object.freeze({
      shape: 'Enter a 10-digit Indian mobile number, like 9840012345.',
    }),
    city: Object.freeze({ empty: 'Pick the city you want the boards in.' }),
    message: Object.freeze({
      long: 'Keep it under 1000 characters — we will call you for the rest.',
    }),
  }),
});

/** The order fields are validated, summarised and focused in. */
const FIELDS = Object.freeze(['name', 'email', 'phone', 'city', 'message']);

/** Fictional desk the fallback mail is addressed to. */
const MAILBOX = 'bookings@hoardinghub.in';

/** Carriage-return line feed, so the encoded body carries `%0D%0A`. */
const EOL = '\r\n';

/** Longest name in the subject line before it is elided. */
const SUBJECT_NAME_MAX = 28;

/** Estimator inputs ./estimator.js mirrors into the query string. */
const ESTIMATOR_KEYS = Object.freeze(['city', 'format', 'days', 'budget']);

/** Coerce anything to text, without throwing on symbols or junk. */
function toText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

/** The bare ten digits an Indian mobile is written as. Separators and the `+`
 *  go; a leading `91` or `0` is dropped only when more than ten digits survive,
 *  so a real number that starts `91` is left exactly as typed. */
function normalisePhone(raw) {
  const packed = toText(raw)
    .replace(VALIDATION.phone.separators, '')
    .replace(VALIDATION.phone.plus, '');
  return packed.length > VALIDATION.phone.digits
    ? packed.replace(VALIDATION.phone.countryCode, '')
    : packed;
}

/** One rule per field: a message, or `''` when the value passes. */
const CHECKS = Object.freeze({
  name(value) {
    const text = value.trim();
    if (text === '') return VALIDATION.messages.name.empty;
    if (text.length < VALIDATION.name.min) return VALIDATION.messages.name.short;
    if (text.length > VALIDATION.name.max) return VALIDATION.messages.name.long;
    if (!VALIDATION.name.letters.test(text)) return VALIDATION.messages.name.letters;
    return '';
  },
  email(value) {
    const text = value.trim();
    if (text === '') return VALIDATION.messages.email.empty;
    if (text.length > VALIDATION.email.max) return VALIDATION.messages.email.long;
    return VALIDATION.email.pattern.test(text) ? '' : VALIDATION.messages.email.shape;
  },
  phone(value) {
    const digits = normalisePhone(value);
    if (digits.length !== VALIDATION.phone.digits) return VALIDATION.messages.phone.shape;
    return VALIDATION.phone.pattern.test(digits) ? '' : VALIDATION.messages.phone.shape;
  },
  city(value) {
    return VALIDATION.city.ids.includes(value.trim().toLowerCase())
      ? ''
      : VALIDATION.messages.city.empty;
  },
  message(value) {
    return value.trim().length > VALIDATION.message.max ? VALIDATION.messages.message.long : '';
  },
});

/**
 * Check one field in isolation.
 *
 * @param {string} name  one of `name`, `email`, `phone`, `city`, `message`
 * @param {unknown} rawValue  anything; non-strings are coerced or read as empty
 * @returns {string} a visitor-facing message, or `''` when the value is valid;
 *   an unknown `name` also returns `''`, so no caller can be handed a message
 *   for a control that has no rule. Pure: nothing is read or written.
 */
export function validateField(name, rawValue) {
  const check = Object.prototype.hasOwnProperty.call(CHECKS, name) ? CHECKS[name] : null;
  return check ? check(toText(rawValue)) : '';
}

/**
 * Check every field at once, so a submit shows the whole list instead of
 * failing one control at a time.
 *
 * @param {Record<string, unknown>} values  keyed by field name; a missing key
 *   reads as empty, the same as a blank control
 * @returns {{ valid: boolean, errors: Record<string, string> }} `errors` holds
 *   only the fields that failed, in {@link FIELDS} order. Pure.
 */
export function validateForm(values) {
  const source = values && typeof values === 'object' ? values : {};
  const errors = {};
  for (const name of FIELDS) {
    const message = validateField(name, source[name]);
    if (message !== '') errors[name] = message;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** The estimator state to quote in the mail, from an explicit query string. */
function estimatorSnapshot(supplied, search) {
  const params = supplied ? null : new URLSearchParams(search ?? '');
  const snapshot = {};
  for (const key of ESTIMATOR_KEYS) {
    const text = toText(supplied ? supplied[key] : params?.get(key)).trim();
    if (text !== '') snapshot[key] = text;
  }
  return snapshot;
}

/**
 * Build the fallback `mailto:` for a staged enquiry.
 *
 * Subject and body are both `encodeURIComponent`-encoded, so spaces, `&`, `=`
 * and newlines cannot leak into the URL — the body's line breaks come back out
 * of the encoding as `%0D%0A`. An over-long name is elided so the subject stays
 * under 70 characters and still reads in a mail client's subject list.
 *
 * @param {{ name?: unknown, email?: unknown, phone?: unknown, city?: unknown,
 *   message?: unknown, estimator?: Record<string, unknown> }} [values]
 * @returns {string} a `mailto:` URL; never empty, never throws
 */
export function buildMailto(values) {
  const source = values && typeof values === 'object' ? values : {};
  const name = toText(source.name).trim();
  const cityId = toText(source.city).trim().toLowerCase();
  const city = getCity(cityId);
  const where = city ? city.name : cityId;
  const short = name.length > SUBJECT_NAME_MAX
    ? `${name.slice(0, SUBJECT_NAME_MAX - 1).trimEnd()}…`
    : name;
  const subject = `HoardingHub enquiry — ${short || 'new campaign'}${where ? `, ${where}` : ''}`;
  const lines = [
    `Name: ${name || '—'}`,
    `Work email: ${toText(source.email).trim() || '—'}`,
    `Phone: ${normalisePhone(source.phone) || '—'}`,
    `City: ${where || '—'}`,
    '',
    'What they are launching:',
    toText(source.message).trim() || 'Not specified yet.',
  ];
  const given = source.estimator;
  const estimator = estimatorSnapshot(
    given && typeof given === 'object' ? given : null,
    globalThis.location?.search ?? '',
  );
  const carried = ESTIMATOR_KEYS.filter((key) => estimator[key] !== undefined);
  if (carried.length > 0) {
    lines.push('', 'Estimator state carried over from the page:');
    for (const key of carried) lines.push(`${key}: ${estimator[key]}`);
  }
  lines.push('', 'Staged by the HoardingHub booking form. Nothing was transmitted — sending this '
    + 'fallback is your call, from your own mail app.');
  return `mailto:${MAILBOX}?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(lines.join(EOL))}`;
}

/* ---------------------------------------------------------------- UI BINDING *
 * The only part that touches the DOM. `novalidate` stays on the form: the   *
 * messages rendered here replace the browser's, which cannot be styled.     */

/** A deliberate pause before the confirmation lands, so the click has weight. */
const SUBMIT_DELAY_MS = 700;

/** Submit-button labels: idle, in flight, settled. */
const LABEL_IDLE = 'Send enquiry';
const LABEL_BUSY = 'Sending…';
const LABEL_DONE = 'Enquiry staged';

/** The submit summary reads as a sentence, not as a number. */
const COUNT_WORDS = Object.freeze(['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six']);

/** Returned when the booking markup is not on the page. */
const NOOP = Object.freeze({
  validate: () => ({ valid: true, errors: {} }),
  reset() {},
  destroy() {},
});

/**
 * Wire the booking form. Without `#booking-form` the no-op comes back, and
 * nothing throws however much of the surrounding markup is missing.
 *
 * @param {{ document?: Document, window?: Window, submitDelay?: number }} [options]
 *   `submitDelay` overrides the 700 ms in-flight pause; `0` is honoured.
 * @returns {{ validate: Function, reset: Function, destroy: Function }}
 *   `validate()` re-reads the controls, repaints every error paragraph, moves
 *   focus to the first bad control and returns the `{ valid, errors }` result.
 *   `reset()` and `destroy()` both put the markup back to its shipped state;
 *   `destroy()` also removes every listener and cancels a pending confirmation.
 *   Side effects stay inside the form: error paragraphs, `.is-invalid`,
 *   `aria-invalid`, `data-normalized`, the success card, focus, and one
 *   `setTimeout` per valid submit. Nothing runs at import time, and no user
 *   data is written to storage, the URL or the network.
 */
export function initBookingForm(options = {}) {
  const doc = options.document ?? globalThis.document;
  const win = options.window ?? globalThis.window;
  if (!doc || !win) return NOOP;

  const form = doc.getElementById('booking-form');
  if (!form) return NOOP;

  const delay = Number.isFinite(options.submitDelay) && options.submitDelay >= 0
    ? options.submitDelay
    : SUBMIT_DELAY_MS;
  const byId = (id) => doc.getElementById(id);
  const status = byId('form-status');
  const success = byId('form-success');
  const successText = byId('success-text');
  const successMailto = byId('success-mailto');
  const heading = success?.querySelector('h2, h3, h4') ?? null;
  const headingHadTab = heading ? heading.hasAttribute('tabindex') : true;
  const submitBtn = form.querySelector('button[type="submit"]');

  /** field name -> { input, error, wrapper, describedby } */
  const controls = new Map();
  for (const name of FIELDS) {
    const input = byId(`bf-${name}`) ?? form.querySelector(`[name="${name}"]`);
    if (!input) continue;
    controls.set(name, {
      input,
      error: byId(`bf-${name}-error`),
      wrapper: typeof input.closest === 'function' ? input.closest('.field') : null,
      describedby: input.getAttribute('aria-describedby'),
    });
  }

  const flagged = new Set(); // fields carrying an error, so `input` skips the rest
  const teardown = []; // one removal closure per listener added below
  let sending = false;
  let timer = null;
  let destroyed = false;

  const on = (target, type, handler) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  };

  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  /** One field's verdict: paragraph text, `.is-invalid`, aria, `data-normalized`. */
  function paintField(name, message) {
    const field = controls.get(name);
    if (!field) return;
    const { input, error, wrapper } = field;
    if (error) {
      error.textContent = message;
      if (message === '') error.setAttribute('hidden', '');
      else error.removeAttribute('hidden');
    }
    // A stale `data-normalized` would publish a number that is no longer what is
    // typed, so it only exists while the field is valid.
    const digits = name === 'phone' && message === '' ? normalisePhone(input.value) : '';
    if (digits === '') input.removeAttribute('data-normalized');
    else input.setAttribute('data-normalized', digits);
    if (message === '') {
      flagged.delete(name);
      wrapper?.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
      return;
    }
    flagged.add(name);
    wrapper?.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
  }

  const paintAll = (errors) => {
    for (const name of FIELDS) paintField(name, errors[name] ?? '');
  };

  /** Current control values, plus the estimator state from the query string. */
  const readValues = () => {
    const values = {};
    for (const [name, field] of controls) values[name] = field.input.value;
    return { ...values, estimator: estimatorSnapshot(null, win.location?.search ?? '') };
  };

  /** Paint a whole result, then point at it: status first, then focus. */
  function paintResult(result) {
    paintAll(result.errors);
    if (result.valid) {
      setStatus('');
      return;
    }
    const count = Object.keys(result.errors).length;
    setStatus(`${COUNT_WORDS[count] ?? count} ${count === 1 ? 'field needs' : 'fields need'}`
      + ' a fix before we can send this.');
    for (const name of FIELDS) {
      if (!result.errors[name]) continue;
      const input = controls.get(name)?.input;
      if (input && typeof input.focus === 'function') {
        input.focus();
        return;
      }
    }
  }

  /** Blur always checks; `input` only once a field is flagged, so a first visit
   *  is never interrupted mid-word; a select commits on `change`. */
  function onFieldEvent(event, mode) {
    if (destroyed) return;
    const target = event.target;
    const name = target?.name;
    if (!name || !controls.has(name)) return;
    if (mode === 'input' && !flagged.has(name)) return;
    if (mode === 'change' && !flagged.has(name) && target.tagName !== 'SELECT') return;
    paintField(name, validateField(name, target.value));
  }

  /** Echo the visitor back, say what happens next, and be honest about mail. */
  function confirmationFor(values) {
    const first = toText(values.name).trim().split(/\s+/)[0] || 'there';
    const city = getCity(toText(values.city).trim().toLowerCase());
    const where = city ? `your ${city.name} enquiry` : 'your enquiry';
    return `Thanks, ${first} — ${where} is staged. A media planner, not a bot, sends three `
      + `mapped options with photos and weekday footfall inside one working day. The button `
      + `below opens your own mail app with the enquiry written out, so it only leaves this `
      + `page when you press send there.`;
  }

  function revealSuccess(values) {
    timer = null;
    if (destroyed) return;
    sending = false;
    success?.removeAttribute('hidden');
    if (successText) successText.textContent = confirmationFor(values);
    if (successMailto) successMailto.setAttribute('href', buildMailto(values));
    if (submitBtn) {
      submitBtn.textContent = LABEL_DONE;
      submitBtn.disabled = true;
    }
    // The form stays visible as a record of what was staged, but leaves the tab
    // order so focus lands on the confirmation and cannot fall back into it.
    for (const field of controls.values()) field.input.disabled = true;
    setStatus('Enquiry staged.');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      if (typeof heading.focus === 'function') heading.focus();
    }
  }

  function onSubmit(event) {
    if (typeof event?.preventDefault === 'function') event.preventDefault();
    if (destroyed || sending) return;
    const values = readValues();
    const result = validateForm(values);
    paintResult(result);
    if (!result.valid) return;
    sending = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = LABEL_BUSY;
    }
    setStatus('Staging your enquiry…');
    if (timer !== null) win.clearTimeout(timer);
    timer = win.setTimeout(() => revealSuccess(values), delay);
  }

  /** Re-check and repaint the whole form, exactly as a submit would. */
  function validate() {
    if (destroyed) return { valid: true, errors: {} };
    const result = validateForm(readValues());
    paintResult(result);
    return result;
  }

  /** Put the markup back to its shipped state without unbinding. */
  function restore() {
    if (timer !== null) {
      win.clearTimeout(timer);
      timer = null;
    }
    sending = false;
    if (typeof form.reset === 'function') form.reset();
    paintAll({});
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = LABEL_IDLE;
    }
    for (const field of controls.values()) field.input.disabled = false;
    success?.setAttribute('hidden', '');
    setStatus('');
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const off of teardown) off();
    teardown.length = 0;
    restore();
    for (const field of controls.values()) {
      if (field.describedby === null) field.input.removeAttribute('aria-describedby');
      else field.input.setAttribute('aria-describedby', field.describedby);
    }
    if (heading && !headingHadTab) heading.removeAttribute('tabindex');
    flagged.clear();
  }

  for (const [name, field] of controls) {
    // `aria-describedby` must name the error paragraph even while it is empty
    // and hidden, so a screen reader can reach the message the moment it lands.
    if (field.error) {
      const ids = (field.input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      if (!ids.includes(`bf-${name}-error`)) {
        field.input.setAttribute('aria-describedby', [...ids, `bf-${name}-error`].join(' '));
      }
    }
    on(field.input, 'blur', (event) => onFieldEvent(event, 'blur'));
    on(field.input, 'input', (event) => onFieldEvent(event, 'input'));
    on(field.input, 'change', (event) => onFieldEvent(event, 'change'));
  }
  on(form, 'submit', onSubmit);

  return Object.freeze({ validate, reset: restore, destroy });
}