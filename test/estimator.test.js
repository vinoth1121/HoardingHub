/**
 * Unit tests for the HoardingHub quote engine.
 * Run with: node --test test/
 *
 * Only the pure core is exercised here — no DOM, no globals. The UI binding
 * is deliberately thin and is verified in the browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BUDGET, CITY_IDS, DURATION, FORMAT_IDS } from '../js/data.js';
import {
  calculateQuote,
  clampBudget,
  clampDuration,
  dailyRate,
  formatCompactINR,
  formatCount,
  formatINR,
  impressionRange,
  roundToNearest,
  sitesAffordable,
  totalCost,
  warningsFor,
} from '../js/estimator.js';

const codes = (warnings) => warnings.map((w) => w.code);

/* ---------------------------------------------------------------- *
 * clampDuration
 * ---------------------------------------------------------------- */

test('clampDuration floors at the seven-day minimum', () => {
  assert.equal(clampDuration(3), DURATION.min);
  assert.equal(clampDuration(0), DURATION.min);
  assert.equal(clampDuration(-40), DURATION.min);
});

test('clampDuration caps at ninety days', () => {
  assert.equal(clampDuration(365), DURATION.max);
  assert.equal(clampDuration(1e9), DURATION.max);
});

test('clampDuration passes an in-range integer straight through', () => {
  assert.equal(clampDuration(30), 30);
  assert.equal(clampDuration(7), 7);
  assert.equal(clampDuration(90), 90);
});

test('clampDuration falls back to the default on NaN', () => {
  assert.equal(clampDuration(NaN), DURATION.default);
  assert.equal(clampDuration(Infinity), DURATION.default);
});

test('clampDuration falls back to the default on undefined and null', () => {
  assert.equal(clampDuration(undefined), DURATION.default);
  assert.equal(clampDuration(), DURATION.default);
  assert.equal(clampDuration(null), DURATION.default);
});

test('clampDuration rounds a decimal to the nearest whole day', () => {
  assert.equal(clampDuration(45.6), 46);
  assert.equal(clampDuration(45.4), 45);
});

test('clampDuration accepts a numeric string', () => {
  assert.equal(clampDuration('14'), 14);
  assert.equal(clampDuration(' 21 '), 21);
});

test('clampDuration rejects non-numeric text', () => {
  assert.equal(clampDuration('soon'), DURATION.default);
  assert.equal(clampDuration({}), DURATION.default);
});

/* ---------------------------------------------------------------- *
 * clampBudget
 * ---------------------------------------------------------------- */

test('clampBudget floors at the five-thousand minimum', () => {
  assert.equal(clampBudget(1_000), BUDGET.min);
  assert.equal(clampBudget(-900_000), BUDGET.min);
});

test('clampBudget caps at fifty lakh', () => {
  assert.equal(clampBudget(9_000_000), BUDGET.max);
});

test('clampBudget passes an in-range figure straight through', () => {
  assert.equal(clampBudget(500_000), 500_000);
  assert.equal(clampBudget(BUDGET.min), BUDGET.min);
});

test('clampBudget falls back to the default on NaN', () => {
  assert.equal(clampBudget(NaN), BUDGET.default);
  assert.equal(clampBudget(-Infinity), BUDGET.default);
});

test('clampBudget falls back to the default on undefined and null', () => {
  assert.equal(clampBudget(undefined), BUDGET.default);
  assert.equal(clampBudget(), BUDGET.default);
  assert.equal(clampBudget(null), BUDGET.default);
});

test('clampBudget rounds a decimal rupee figure', () => {
  assert.equal(clampBudget(250_000.4), 250_000);
  assert.equal(clampBudget(250_000.6), 250_001);
});

test('clampBudget accepts a numeric string', () => {
  assert.equal(clampBudget('750000'), 750_000);
  assert.equal(clampBudget('  12000 '), 12_000);
});

test('clampBudget rejects non-numeric text', () => {
  assert.equal(clampBudget('lots'), BUDGET.default);
  assert.equal(clampBudget([]), BUDGET.default);
});

/* ---------------------------------------------------------------- *
 * roundToNearest and dailyRate
 * ---------------------------------------------------------------- */

test('roundToNearest snaps to the step and collapses junk to zero', () => {
  assert.equal(roundToNearest(1_234, 10), 1_230);
  assert.equal(roundToNearest(1_235, 10), 1_240);
  assert.equal(roundToNearest(1_234, 100), 1_200);
  assert.equal(roundToNearest(NaN, 10), 0);
  assert.equal(roundToNearest(1_234, 0), 0);
});

test('dailyRate matches the published regression anchors', () => {
  assert.equal(dailyRate('mumbai', 'hoarding'), 2_500);
  assert.equal(dailyRate('chennai', 'hoarding'), 1_570);
  assert.equal(dailyRate('bengaluru', 'digital-screen'), 1_320);
  assert.equal(dailyRate('hyderabad', 'bus-shelter'), 620);
});

test('dailyRate ranks hoardings by city multiplier', () => {
  // Multipliers: mumbai 1.35 > delhi 1.25 > bengaluru 1.15 > hyderabad 1.00 >
  // kolkata 0.90 > chennai 0.85, and the snapped day rates must follow suit.
  const mumbai = dailyRate('mumbai', 'hoarding');
  const kolkata = dailyRate('kolkata', 'hoarding');
  const chennai = dailyRate('chennai', 'hoarding');
  assert.ok(mumbai > kolkata, `${mumbai} should beat ${kolkata}`);
  assert.ok(kolkata > chennai, `${kolkata} should beat ${chennai}`);
  assert.equal(chennai, 1_570);
  assert.equal(kolkata, 1_670);
});

test('dailyRate falls back to the first card entry for unknown ids', () => {
  assert.equal(dailyRate('atlantis', 'hoarding'), dailyRate('chennai', 'hoarding'));
  assert.equal(dailyRate('mumbai', 'hologram'), dailyRate('mumbai', 'hoarding'));
});

/* ---------------------------------------------------------------- *
 * totalCost
 * ---------------------------------------------------------------- */

test('totalCost rounds the run to the nearest hundred rupees', () => {
  // Bengaluru hoarding: round(1850 x 1.15, 10) = 2130, and 2130 x 45 = 95850.
  assert.equal(totalCost('bengaluru', 'hoarding', 45), 95_900);
  assert.equal(totalCost('mumbai', 'hoarding', 30) % 100, 0);
  assert.equal(totalCost('mumbai', 'hoarding', 30), 75_000);
});

test('totalCost grows monotonically with days', () => {
  let previous = 0;
  for (const days of [7, 14, 30, 45, 60, 90]) {
    const cost = totalCost('delhi', 'hoarding', days);
    assert.ok(cost > previous, `${days} days (${cost}) should beat ${previous}`);
    previous = cost;
  }
});

test('totalCost clamps a silly run length instead of throwing', () => {
  assert.equal(totalCost('mumbai', 'hoarding', 9_999), totalCost('mumbai', 'hoarding', 90));
  assert.equal(totalCost('mumbai', 'hoarding', 'nope'), totalCost('mumbai', 'hoarding', 30));
});

/* ---------------------------------------------------------------- *
 * impressionRange
 * ---------------------------------------------------------------- */

test('impressionRange keeps high at or above low for every combination', () => {
  for (const city of CITY_IDS) {
    for (const format of FORMAT_IDS) {
      const { low, high } = impressionRange(city, format, 30);
      assert.ok(high >= low, `${city}/${format}: ${high} < ${low}`);
      assert.ok(low > 0, `${city}/${format}: low must be positive`);
    }
  }
});

test('impressionRange scales with the run length', () => {
  const short = impressionRange('mumbai', 'hoarding', 30);
  const long = impressionRange('mumbai', 'hoarding', 90);
  assert.deepEqual(short, { low: 1_701_000, high: 3_645_000 });
  assert.ok(long.low > short.low);
  assert.ok(long.high > short.high);
  assert.equal(long.low, short.low * 3);
});

test('impressionRange weights by city multiplier', () => {
  const mumbai = impressionRange('mumbai', 'hoarding', 7);
  const chennai = impressionRange('chennai', 'hoarding', 7);
  assert.equal(mumbai.low, Math.round(42_000 * 1.35 * 7));
  assert.ok(mumbai.low > chennai.low);
});

/* ---------------------------------------------------------------- *
 * sitesAffordable
 * ---------------------------------------------------------------- */

test('sitesAffordable is zero when the budget cannot cover the run', () => {
  assert.equal(sitesAffordable('mumbai', 'hoarding', 50_000), 0);
  assert.equal(sitesAffordable('mumbai', 'hoarding', 7_499), 0);
});

test('sitesAffordable counts whole seven-day blocks from the run cost up', () => {
  // Chennai bus shelter: rate 530, a 30-day run costs 15900, a block costs 3710.
  assert.equal(sitesAffordable('chennai', 'bus-shelter', 15_899), 0);
  assert.equal(sitesAffordable('chennai', 'bus-shelter', 15_900), 4);
  assert.equal(sitesAffordable('chennai', 'bus-shelter', 27_030), 7);
});

test('sitesAffordable floors rather than rounds', () => {
  // 500000 / (2500 x 7) = 28.57 sites — never 29.
  assert.equal(sitesAffordable('mumbai', 'hoarding', 500_000), 28);
  assert.equal(sitesAffordable('mumbai', 'hoarding', 499_999), 28);
  assert.equal(sitesAffordable('mumbai', 'hoarding', 175_000 * 2), 20);
});

/* ---------------------------------------------------------------- *
 * warningsFor
 * ---------------------------------------------------------------- */

test('warningsFor flags an under-budget plan and quotes the shortfall', () => {
  const warnings = warningsFor('mumbai', 'hoarding', 90, 50_000);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'under-budget');
  assert.equal(warnings[0].level, 'error');
  assert.ok(warnings[0].message.includes(formatINR(175_000)), warnings[0].message);
  assert.ok(warnings[0].message.includes('20-day'), warnings[0].message);
  assert.ok(warnings[0].message.length <= 220);
});

test('warningsFor says so when even the minimum run will not fit', () => {
  const [warning] = warningsFor('mumbai', 'hoarding', 90, 10_000);
  assert.equal(warning.code, 'under-budget');
  assert.ok(warning.message.includes('minimum'), warning.message);
  assert.ok(warning.message.includes(formatINR(17_500)), warning.message);
});

test('warningsFor warns when the budget only just covers the run', () => {
  const warnings = warningsFor('mumbai', 'hoarding', 30, 80_000);
  assert.deepEqual(codes(warnings), ['tight']);
  assert.equal(warnings[0].level, 'warn');
  assert.ok(warnings[0].message.includes('no room for artwork'), warnings[0].message);
});

test('warningsFor notes a pan-India package at 25 sites or more', () => {
  const warnings = warningsFor('mumbai', 'hoarding', 30, 500_000);
  assert.deepEqual(codes(warnings), ['enterprise']);
  assert.equal(warnings[0].level, 'info');
  assert.ok(warnings[0].message.includes('28'), warnings[0].message);
});

test('warningsFor warns that DOOH needs a bigger budget', () => {
  const warnings = warningsFor('mumbai', 'digital-screen', 30, 100_000);
  assert.deepEqual(codes(warnings), ['dooh-minimum']);
  assert.equal(warnings[0].level, 'warn');
  assert.ok(warnings[0].message.includes('₹1,50,000'), warnings[0].message);
});

test('warningsFor is empty for a healthy mid-range quote', () => {
  assert.deepEqual(warningsFor('mumbai', 'hoarding', 30, 200_000), []);
  assert.deepEqual(warningsFor('chennai', 'bus-shelter', 60, 60_000), []);
});

test('warningsFor sorts errors before warns before info', () => {
  const warnings = warningsFor('mumbai', 'digital-screen', 90, 100_000);
  assert.deepEqual(codes(warnings), ['under-budget', 'dooh-minimum']);
  assert.equal(warnings[0].level, 'error');
  assert.equal(warnings[1].level, 'warn');
});

/* ---------------------------------------------------------------- *
 * calculateQuote
 * ---------------------------------------------------------------- */

test('calculateQuote reconciles the default page state', () => {
  const quote = calculateQuote({ city: 'mumbai', format: 'hoarding', duration: 30, budget: 500_000 });
  assert.equal(quote.rateCardVersion, '2026.01');
  assert.equal(quote.dailyRate, 2_500);
  assert.equal(quote.costPerDay, 2_500);
  assert.equal(quote.totalCost, 75_000);
  assert.deepEqual(quote.impressions, { low: 1_701_000, high: 3_645_000 });
  assert.deepEqual(quote.impressionsPerDay, { low: 56_700, high: 121_500 });
  assert.equal(quote.sitesAffordable, 28);
  assert.equal(quote.effectiveCpm, 44);
  assert.equal(quote.shortfall, 0);
  assert.equal(quote.isBudgetSufficient, true);
});

test('calculateQuote falls back instead of throwing on unknown ids', () => {
  const quote = calculateQuote({ city: 'atlantis', format: 'hologram', duration: 30, budget: 500_000 });
  assert.equal(quote.city.id, 'chennai');
  assert.equal(quote.format.id, 'hoarding');
  assert.doesNotThrow(() => calculateQuote());
  assert.doesNotThrow(() => calculateQuote({}));
  assert.doesNotThrow(() => calculateQuote(null));
});

test('calculateQuote clamps duration and budget before doing anything else', () => {
  const junk = calculateQuote({ city: 'mumbai', format: 'hoarding', duration: 'abc', budget: 'plenty' });
  assert.equal(junk.duration, DURATION.default);
  assert.equal(junk.budget, BUDGET.default);
  assert.equal(junk.isBudgetSufficient, true);
  const negative = calculateQuote({ city: 'mumbai', format: 'hoarding', duration: 30, budget: -3 });
  assert.equal(negative.budget, BUDGET.min);
  assert.equal(negative.shortfall, 75_000 - BUDGET.min);
  assert.equal(negative.warnings[0].code, 'under-budget');
});

test('calculateQuote reports a positive CPM and a shortfall when short', () => {
  const healthy = calculateQuote({ city: 'mumbai', format: 'hoarding', duration: 30, budget: 500_000 });
  assert.ok(healthy.effectiveCpm > 0, 'CPM must be positive');
  const short = calculateQuote({ city: 'mumbai', format: 'hoarding', duration: 90, budget: 50_000 });
  assert.equal(short.isBudgetSufficient, false);
  assert.equal(short.shortfall, 175_000);
  assert.equal(short.warnings[0].code, 'under-budget');
});

test('calculateQuote always returns a non-empty summary string', () => {
  const states = [
    { city: 'mumbai', format: 'hoarding', duration: 30, budget: 500_000 },
    { city: 'kolkata', format: 'bus-shelter', duration: 90, budget: 5_000_000 },
    { city: 'delhi', format: 'digital-screen', duration: 7, budget: 5_000 },
  ];
  for (const state of states) {
    const { summary } = calculateQuote(state);
    assert.equal(typeof summary, 'string');
    assert.ok(summary.length > 0);
  }
});

test('calculateQuote is deterministic across identical calls', () => {
  const input = { city: 'bengaluru', format: 'digital-screen', duration: 45, budget: 275_000 };
  assert.deepEqual(calculateQuote(input), calculateQuote(input));
  assert.deepEqual(calculateQuote(input).warnings, calculateQuote(input).warnings);
});

/* ---------------------------------------------------------------- *
 * Formatters
 * ---------------------------------------------------------------- */

test('formatINR uses Indian digit grouping', () => {
  assert.equal(formatINR(0), '₹0');
  assert.equal(formatINR(1_234_567), '₹12,34,567');
  assert.equal(formatINR(500_000), '₹5,00,000');
  assert.equal(formatINR(75_000), '₹75,000');
});

test('formatINR collapses non-finite input to zero', () => {
  assert.equal(formatINR(NaN), '₹0');
  assert.equal(formatINR(undefined), '₹0');
  assert.equal(formatINR(Infinity), '₹0');
  assert.equal(formatINR('abc'), '₹0');
});

test('formatCompactINR compacts lakhs and crores', () => {
  assert.equal(formatCompactINR(2_400_000), '₹24L');
  assert.equal(formatCompactINR(45_000), '₹45,000');
  assert.equal(formatCompactINR(12_000_000), '₹1.2Cr');
  assert.equal(formatCompactINR(250_000), '₹2.5L');
  assert.equal(formatCompactINR(0), '₹0');
});

test('formatCount groups digits the Indian way', () => {
  assert.equal(formatCount(12_345_678), '1,23,45,678');
  assert.equal(formatCount(1_701_000), '17,01,000');
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(NaN), '0');
  assert.equal(formatCount(undefined), '0');
});