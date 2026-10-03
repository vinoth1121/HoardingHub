/**
 * HoardingHub — data layer.
 *
 * The single source of truth for the fictional rate card. Everything here is
 * plain, frozen data plus four small lookup helpers; there is no DOM access,
 * no I/O and no side effects, so any module may import it safely.
 */

/* ------------------------------------------------------------------ *
 * ILLUSTRATIVE RATE CARD — NOT REAL PRICING.
 * Invented for a fictional demo product. The SHAPE is realistic for
 * Indian OOH (per-day, per-site, city-weighted) so the estimator maths
 * behaves like the real thing, but no figure here should be quoted to
 * a customer. Production would read this from a CMS or rate-card API.
 * ------------------------------------------------------------------ */

/** Version stamped onto every quote so a shared link names the card it used. */
export const RATE_CARD_VERSION = '2026.01';

/** Minimum bookable run, in days. Inventory is sold in whole weekly blocks. */
export const SITE_BLOCK_DAYS = 7;

/** Run-length bounds for the estimator, in days. */
export const DURATION = Object.freeze({ min: 7, max: 90, step: 1, default: 30 });

/** Budget bounds for the estimator, in whole rupees. */
export const BUDGET = Object.freeze({ min: 5_000, max: 5_000_000, step: 5_000, default: 500_000 });

/**
 * Metro inventory pools. `multiplier` is the only city lever in the maths:
 * it scales both the day rate and the daily impression estimate, so a
 * dearer city is assumed to deliver proportionally busier sites.
 */
export const CITIES = Object.freeze([
  Object.freeze({ id: 'chennai',   name: 'Chennai',   region: 'Tamil Nadu',  multiplier: 0.85, note: 'Marina + OMR corridor' }),
  Object.freeze({ id: 'mumbai',    name: 'Mumbai',    region: 'Maharashtra', multiplier: 1.35, note: 'Bandra + Andheri flyover' }),
  Object.freeze({ id: 'delhi',     name: 'Delhi',     region: 'Delhi NCR',   multiplier: 1.25, note: 'Ring Road + metro pillars' }),
  Object.freeze({ id: 'bengaluru', name: 'Bengaluru', region: 'Karnataka',   multiplier: 1.15, note: 'Whitefield + Airport Road' }),
  Object.freeze({ id: 'hyderabad', name: 'Hyderabad', region: 'Telangana',   multiplier: 1.00, note: 'Gachibowli + Banjara Hills' }),
  Object.freeze({ id: 'kolkata',   name: 'Kolkata',   region: 'West Bengal', multiplier: 0.90, note: 'Park Street + Salt Lake' }),
]);

/**
 * The three product families. Rates are per unit per day and impressions are
 * per unit per day, before the city multiplier.
 */
export const FORMATS = Object.freeze([
  Object.freeze({ id: 'hoarding',       name: 'Hoarding',       label: 'Hoarding',       baseRatePerDay: 1_850, impressionsLow: 42_000,  impressionsHigh: 90_000,  unitLabel: 'per hoarding per day' }),
  Object.freeze({ id: 'bus-shelter',    name: 'Bus shelter',    label: 'Bus shelter',    baseRatePerDay: 620,    impressionsLow: 18_000,  impressionsHigh: 45_000,  unitLabel: 'per shelter per day' }),
  Object.freeze({ id: 'digital-screen', name: 'Digital screen', label: 'Digital screen', baseRatePerDay: 1_150, impressionsLow: 60_000,  impressionsHigh: 180_000, unitLabel: 'per screen per day' }),
]);
/**
 * Copy shown in the FAQ accordion. Wording is kept identical to the shipped
 * markup so the page has exactly one voice for these answers.
 */
export const FAQS = Object.freeze([
  Object.freeze({
    q: 'Who actually owns the hoardings you sell?',
    a: 'We do. Every structure on our rate card sits under a long-term lease we hold with the landowner or the municipal body, and that lease carries the right to paint, paste, light and re-let it. GCC approval, the municipal NOC and the structural safety certificate are already in our name before you ever call, so you are buying inventory rather than promises. If a site is repossessed or demolished mid-flight, we credit the unused days or move you to an equivalent board at the same rate, whichever you prefer.',
  }),
  Object.freeze({
    q: 'What is the minimum booking?',
    a: 'Seven days is the floor, and the hoarding rates above already assume a seven-day block — we price the week, not the day, because paste crews, lifts and permissions are all booked by the week. Digital screens are the exception: DOOH only earns its CPM at ninety days or more, since the rate is amortised over repeat rotations. Shorter runs are still possible, but they are priced day-by-day at a premium and need a written go-ahead from our ops desk before we hold inventory.',
  }),
  Object.freeze({
    q: 'Is GST included in the estimate?',
    a: 'No — the estimator shows media cost only, so nothing is buried in the rate. GST at 18% is added at invoice and raised as a separate line, which keeps your input credit clean. Artwork and creative, printing, the paste or hoist crew and the monthly electricity for illuminated boards all appear separately on the quote. A campaign that looks like ₹5,00,000 of media usually lands close to ₹6,60,000 all-in before GST.',
  }),
  Object.freeze({
    q: 'Who supplies the creative artwork?',
    a: 'Whichever you prefer — you can mix both across cities. If you supply files, we need print-ready artwork in CMYK at 300 dpi at final print size, with 3 mm bleed and a 10 mm safety margin, delivered as a flattened PDF or a packaged set of layered files. Our studio will build from your logo and copy for a fee and returns two rounds of proofs. Either route, the artwork deadline is five working days before the start date.',
  }),
  Object.freeze({
    q: 'How fast can a site go live?',
    a: 'Digital screens go live in forty-eight hours from artwork approval — the file is pushed over the network, so there is nothing physical to install. Painted and pasted hoardings take three to five working days, because municipal painting permission and a structural safety check have to clear first. If we miss the agreed go-live date for reasons on our side, the make-good clause applies: a refund of every unused day, or a free extension of the same length at the same rate.',
  }),
  Object.freeze({
    q: 'Can I book the same site in several cities?',
    a: 'Yes, and most national brands do. The rate card is identical in Chennai, Mumbai, Delhi, Bengaluru, Hyderabad and Kolkata, so a pan-India buy is one PO, one consolidated GST invoice and one dispatch report. Rates scale by volume rather than by city: a five-city package is quoted at the metro rate for every board, and a commitment of ninety days or more locks that rate for the full term. Mixed-format packages are priced per format and then bundled at package rates.',
  }),
]);

/** Headline numbers in the hero. Static, so no function is needed. */
export const STATS = Object.freeze([
  Object.freeze({ value: '1,240', label: 'Live hoardings' }),
  Object.freeze({ value: '6', label: 'Metros' }),
  Object.freeze({ value: '₹1,850 / day', label: 'From' }),
  Object.freeze({ value: '48 hrs', label: 'Go-live' }),
]);

/* ------------------------------------------------------------------ *
 * Lookups. Every helper returns null rather than throwing, so callers
 * can decide their own fallback (the estimator falls back to index 0).
 * ------------------------------------------------------------------ */

/**
 * @param {string} id
 * @returns {Readonly<{id:string,name:string,region:string,multiplier:number,note:string}> | null}
 */
export const getCity = (id) => CITIES.find((c) => c.id === id) ?? null;

/**
 * @param {string} id
 * @returns {Readonly<{id:string,name:string,label:string,baseRatePerDay:number,impressionsLow:number,impressionsHigh:number,unitLabel:string}> | null}
 */
export const getFormat = (id) => FORMATS.find((f) => f.id === id) ?? null;

/** City ids in rate-card order. */
export const CITY_IDS = CITIES.map((c) => c.id);

/** Format ids in rate-card order. */
export const FORMAT_IDS = FORMATS.map((f) => f.id);