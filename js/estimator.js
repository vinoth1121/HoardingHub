/**
 * HoardingHub — quote engine.
 *
 * The file is two halves:
 *   1. PURE CORE   — no DOM, no globals, no side effects, fully testable.
 *   2. UI BINDING  — `initEstimator()`, a thin listener wiring layer at the
 *                    bottom that only reads state and writes text.
 *
 * Every figure comes from the illustrative rate card in ./data.js. Nothing in
 * the core mutates its inputs, and every entry point is total: unknown ids or
 * junk numbers fall back to defaults instead of throwing.
 */

/* ================================================================== *
 * 1 / PURE CORE
 * ================================================================== */

import {
  BUDGET,
  CITIES,
  CITY_IDS,
  DURATION,
  FORMAT_IDS,
  FORMATS,
  RATE_CARD_VERSION,
  SITE_BLOCK_DAYS,
  getCity,
  getFormat,
} from './data.js';

/** DOOH needs a real budget behind it before the CPM maths means anything. */
const DOOH_MIN_BUDGET = 150_000;

/** Above this many affordable sites a plan stops being a spot buy. */
const ENTERPRISE_SITE_COUNT = 25;

/** Warnings render most-severe-first; ties keep rule order. */
const LEVEL_RANK = Object.freeze({ error: 0, warn: 1, info: 2 });

/**
 * Coerce anything to a finite number, or null when it is not a number at all.
 * Numeric strings are accepted because URL query values always arrive as text.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Accept either an id or an object carrying an id (handy for the binding). */
function toId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return '';
}

/**
 * Round to the nearest multiple of `step`. Non-finite input collapses to 0 so
 * a bad value can never poison a downstream multiplication.
 *
 * @param {number} value
 * @param {number} step
 * @returns {number}
 */
export function roundToNearest(value, step) {
  const v = toFiniteNumber(value);
  const s = toFiniteNumber(step);
  if (v === null || s === null || s <= 0) return 0;
  return Math.round(v / s) * s;
}

/** Clamp to an integer inside `{ min, max }`, defaulting on junk input. */
function clampTo(value, { min, max, default: fallback }) {
  const v = toFiniteNumber(value);
  if (v === null) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Run length in whole days, always inside `[DURATION.min, DURATION.max]`.
 * NaN, undefined and non-numeric input fall back to `DURATION.default`.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function clampDuration(value) {
  return clampTo(value, DURATION);
}

/**
 * Budget in whole rupees, always inside `[BUDGET.min, BUDGET.max]`.
 * NaN, undefined and non-numeric input fall back to `BUDGET.default`.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function clampBudget(value) {
  return clampTo(value, BUDGET);
}

/** Unknown city ids resolve to the first city on the card, never to a throw. */
function resolveCity(cityId) {
  return getCity(toId(cityId)) ?? CITIES[0];
}

/** Unknown format ids resolve to the first format on the card. */
function resolveFormat(formatId) {
  return getFormat(toId(formatId)) ?? FORMATS[0];
}

/**
 * Rupees per site per day: the format rate weighted by the city multiplier and
 * snapped to the nearest ₹10, which is how the sales desk quotes it.
 * Mumbai hoarding = round(1850 x 1.35, 10) = 2500.
 *
 * @param {string} cityId
 * @param {string} formatId
 * @returns {number}
 */
export function dailyRate(cityId, formatId) {
  const city = resolveCity(cityId);
  const format = resolveFormat(formatId);
  return roundToNearest(format.baseRatePerDay * city.multiplier, 10);
}

/**
 * Media cost for the whole run, one site, snapped to the nearest ₹100 so the
 * figure on screen matches the figure on an invoice.
 *
 * @param {string} cityId
 * @param {string} formatId
 * @param {unknown} days
 * @returns {number}
 */
export function totalCost(cityId, formatId, days) {
  const rate = dailyRate(cityId, formatId);
  return roundToNearest(rate * clampDuration(days), 100);
}

/**
 * Estimated impressions for the whole run of a single site.
 *
 * @param {string} cityId
 * @param {string} formatId
 * @param {unknown} days
 * @returns {{ low: number, high: number }}
 */
export function impressionRange(cityId, formatId, days) {
  const city = resolveCity(cityId);
  const format = resolveFormat(formatId);
  const run = clampDuration(days);
  let low = Math.round(format.impressionsLow * city.multiplier * run);
  let high = Math.round(format.impressionsHigh * city.multiplier * run);
  if (high < low) [low, high] = [high, low];
  return { low, high };
}
/**
 * How many sites the budget buys, priced against the default run length.
 * Inventory is sold in whole weekly blocks, so a site only counts when a full
 * {@link SITE_BLOCK_DAYS}-day run fits inside the budget.
 *
 * @param {string} cityId
 * @param {string} formatId
 * @param {unknown} budget
 * @returns {number}
 */
export function sitesAffordable(cityId, formatId, budget) {
  const rate = dailyRate(cityId, formatId);
  const rupees = clampBudget(budget);
  if (rupees < totalCost(cityId, formatId, DURATION.default)) return 0;
  return Math.floor(rupees / (rate * SITE_BLOCK_DAYS));
}

/** Freeze a warning and hard-cap the copy at 220 characters. */
function makeWarning(code, level, message) {
  const copy = message.length > 220 ? `${message.slice(0, 217)}...` : message;
  return Object.freeze({ code, level, message: copy });
}

/** Most severe first; equal severities keep the order the rules fired in. */
const bySeverity = (a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level];

/**
 * Advice attached to a quote. At most one warning per rule, sorted
 * error -> warn -> info, and `[]` for a healthy mid-range plan.
 *
 * @param {string} cityId
 * @param {string} formatId
 * @param {unknown} days
 * @param {unknown} budget
 * @returns {ReadonlyArray<{ code: string, level: 'error'|'warn'|'info', message: string }>}
 */
export function warningsFor(cityId, formatId, days, budget) {
  const format = resolveFormat(formatId);
  const run = clampDuration(days);
  const rupees = clampBudget(budget);
  const rate = dailyRate(cityId, formatId);
  const cost = totalCost(cityId, formatId, run);
  const sites = sitesAffordable(cityId, formatId, rupees);
  const warnings = [];

  // 1 / the plan does not fit at all.
  if (rupees < cost) {
    const shortfall = cost - rupees;
    const affordableDays = rate > 0 ? Math.floor(rupees / rate) : 0;
    const message = affordableDays >= DURATION.min
      ? `Needs ${formatINR(cost)} for ${run} days — that is ${formatINR(shortfall)} more than your ${formatINR(rupees)} budget. A ${affordableDays}-day run would fit.`
      : `Needs ${formatINR(cost)} for ${run} days — ${formatINR(shortfall)} short, and even the ${DURATION.min}-day minimum of ${formatINR(roundToNearest(rate * DURATION.min, 100))} will not fit.`;
    warnings.push(makeWarning('under-budget', 'error', message));
  }

  // 2 / it fits, but only just.
  if (rupees >= cost && rupees < cost * 1.5) {
    const comfortable = roundToNearest(cost * 1.5, 1_000);
    warnings.push(makeWarning('tight', 'warn', `Workable, but there is no room for artwork, installation or GST. Add ${formatINR(comfortable - rupees)} to reach ${formatINR(comfortable)}.`));
  }

  // 3 / big enough to be a package deal rather than a spot buy.
  if (sites >= ENTERPRISE_SITE_COUNT) {
    warnings.push(makeWarning('enterprise', 'info', `At ${formatCount(sites)} sites this is a multi-city package — ask for the pan-India rate card across all six metros.`));
  }

  // 4 / DOOH below its sensible floor.
  if (format.id === 'digital-screen' && rupees < DOOH_MIN_BUDGET) {
    warnings.push(makeWarning('dooh-minimum', 'warn', `DOOH needs a 3-month run to be worth its CPM; below ₹1,50,000 a static hoarding performs better. You are ${formatINR(DOOH_MIN_BUDGET - rupees)} under that mark.`));
  }

  return warnings.sort(bySeverity);
}

/**
 * The whole quote in one plain object: money, reach, how many sites the
 * budget buys, and the caveats. Total by construction — unknown ids fall back
 * to the first city/format on the card and junk numbers fall back to the
 * clamp defaults, so the UI can never be handed `undefined`.
 *
 * @param {{ city?: unknown, format?: unknown, duration?: unknown, budget?: unknown }} [input]
 */
export function calculateQuote(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const city = resolveCity(source.city);
  const format = resolveFormat(source.format);
  const duration = clampDuration(source.duration);
  const budget = clampBudget(source.budget);

  const rate = dailyRate(city.id, format.id);
  const total = totalCost(city.id, format.id, duration);
  const impressions = impressionRange(city.id, format.id, duration);
  const impressionsPerDay = Object.freeze({
    low: Math.round(format.impressionsLow * city.multiplier),
    high: Math.round(format.impressionsHigh * city.multiplier),
  });
  const sites = sitesAffordable(city.id, format.id, budget);
  const isBudgetSufficient = budget >= total;
  const shortfall = isBudgetSufficient ? 0 : total - budget;
  const effectiveCpm = impressions.low > 0 ? Math.round((total / impressions.low) * 1_000) : 0;
  const warnings = warningsFor(city.id, format.id, duration, budget);
  const costPerDay = duration > 0 ? Math.round(total / duration) : 0;

  const summary = !isBudgetSufficient
    ? `${format.label} in ${city.name} for ${duration} days costs ${formatINR(total)} — ${formatINR(shortfall)} more than your ${formatINR(budget)} budget.`
    : sites >= ENTERPRISE_SITE_COUNT
      ? `${format.label} in ${city.name} for ${duration} days comes to ${formatINR(total)}, and your ${formatINR(budget)} budget covers ${sites} sites as a pan-India package.`
      : `${format.label} in ${city.name} for ${duration} days comes to ${formatINR(total)} at ${formatINR(rate)} a day — about ${formatINR(effectiveCpm)} CPM across ${formatCount(impressions.low)} impressions.`;

  return Object.freeze({
    rateCardVersion: RATE_CARD_VERSION,
    city,
    format,
    duration,
    budget,
    dailyRate: rate,
    totalCost: total,
    costPerDay,
    impressions,
    impressionsPerDay,
    sitesAffordable: sites,
    isBudgetSufficient,
    shortfall,
    effectiveCpm,
    warnings,
    summary,
  });
}

/* ------------------------------------------------------------------ *
 * FORMATTERS — en-IN grouping, whole rupees, Indian compaction.
 * ------------------------------------------------------------------ */

const inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const countFormatter = new Intl.NumberFormat('en-IN');

/**
 * Rupees with Indian digit grouping, e.g. `₹1,23,456`.
 * @param {unknown} n
 * @returns {string}
 */
export function formatINR(n) {
  const v = toFiniteNumber(n);
  return v === null ? '₹0' : `₹${inrFormatter.format(v)}`;
}

/**
 * Rupees compacted the way an Indian media plan is read out loud:
 * `₹2.5L`, `₹1.2Cr`, or plain `₹45,000` below a lakh.
 * @param {unknown} n
 * @returns {string}
 */
export function formatCompactINR(n) {
  const v = toFiniteNumber(n);
  if (v === null) return '₹0';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1).replace(/\.?0+$/, '')}L`;
  return formatINR(v);
}

/**
 * Large counts with Indian digit grouping, e.g. `1,23,45,678`.
 * @param {unknown} n
 * @returns {string}
 */
export function formatCount(n) {
  const v = toFiniteNumber(n);
  return v === null ? '0' : countFormatter.format(v);
}
