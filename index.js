/**
 * oprah-iterator
 * "You get an iterator! YOU get an iterator! EVERYBODY gets an iterator!"
 *
 * Adds Symbol.iterator (and Symbol.asyncIterator where appropriate) to every
 * builtin prototype that lacks one. Side-effect-only import.
 *
 * Safe-define: all iterators are non-enumerable, writable, configurable.
 */

// ─── Sentinel ────────────────────────────────────────────────────────────────

export const HOLE = Symbol('hole');

// ─── Util ─────────────────────────────────────────────────────────────────────

function define(proto, symbol, fn) {
  Object.defineProperty(proto, symbol, {
    value: fn,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

// ─── Object ───────────────────────────────────────────────────────────────────
// Yields [key, value] for all own enumerable string keys.
// Placed first — all others inherit from Object.prototype, so their own
// Symbol.iterator definitions shadow this one cleanly.
define(Object.prototype, Symbol.iterator, function* iterator () {
  for (const key of Object.keys(this)) {
    yield [key, this[key]];
  }
});
// ─── Number ───────────────────────────────────────────────────────────────────
// Creates Array(n) and iterates every slot, including holes.
// Holes yield the HOLE sentinel so consumers can distinguish from undefined.

define(Number.prototype, Symbol.iterator, function* iterator () {
  const len = Math.abs(Math.floor(this.valueOf()));
  const arr = Array(len);
  for (let i = 0; i < len; i++) {
    yield i in arr ? arr[i] : HOLE;
  }
});

// ─── BigInt ───────────────────────────────────────────────────────────────────
// Same range semantics as Number.

define(BigInt.prototype, Symbol.iterator, function* iterator () {
  const len = this.valueOf() < 0n ? -this.valueOf() : this.valueOf();
  const arr = Array(Number(len));
  for (let i = 0; i < arr.length; i++) {
    yield i in arr ? arr[i] : HOLE;
  }
});

// ─── Boolean ──────────────────────────────────────────────────────────────────
// Yields the boolean value once. Trivial but consistent — everything iterates.

define(Boolean.prototype, Symbol.iterator, function* iterator () {
  yield this.valueOf();
});

// ─── RegExp ───────────────────────────────────────────────────────────────────
// Yields [pattern, bool] first (false if pattern is falsy, empty, or throws),
// then yields each active flag character individually.

define(RegExp.prototype, Symbol.iterator, function* iterator () {
  let pattern, ok;
  try {
    pattern = this.source;
    // '(?:)' is the serialized form of an empty regex — treat as falsy
    ok = !!pattern && pattern !== '(?:)';
  } catch {
    ok = false;
  }
  yield [pattern ?? null, ok];

  for (const flag of 'dgimsuy') {
    if (this.flags.includes(flag)) yield flag;
  }
});

// ─── Date ─────────────────────────────────────────────────────────────────────
// Yields labelled date components as [field, value] pairs.

define(Date.prototype, Symbol.iterator, function* iterator () {
  yield ['year',        this.getFullYear()];
  yield ['month',       this.getMonth()];      // 0-indexed, matches Date API
  yield ['day',         this.getDate()];
  yield ['hours',       this.getHours()];
  yield ['minutes',     this.getMinutes()];
  yield ['seconds',     this.getSeconds()];
  yield ['milliseconds',this.getMilliseconds()];
  yield ['timestamp',   this.getTime()];
});

// ─── Error ────────────────────────────────────────────────────────────────────
// Reflect.ownKeys catches non-enumerable props (stack on V8) + Symbols.
// Yields [key, value] — same shape as Object iterator but broader key set.

define(Error.prototype, Symbol.iterator, function* iterator() {
  for (const key of Reflect.ownKeys(this)) {
    yield [key, this[key]];
  }
});

// ─── Function ─────────────────────────────────────────────────────────────────
// Parses parameter names from .toString() source.
// Handles: regular fns, arrows, methods, async, generators.
// Does NOT handle destructured params or defaults containing commas — those
// need a real parser (acorn etc). Yields raw param token strings in that case.

define(Function.prototype, Symbol.iterator, function* iterator () {
  const src = this.toString();
  const match = src.match(/^[^(]*\(([^)]*)\)/s);
  if (!match || !match[1].trim()) return;
  for (const param of match[1].split(',')) {
    const trimmed = param.trim();
    if (trimmed) yield trimmed;
  }
});

// ─── ArrayBuffer ──────────────────────────────────────────────────────────────
// Yields each byte as an unsigned integer via a Uint8Array view.

define(ArrayBuffer.prototype, Symbol.iterator, function* iterator () {
  yield* new Uint8Array(this);
});

// ─── DataView ─────────────────────────────────────────────────────────────────
// Yields each byte in the view's range (respects byteOffset + byteLength).

define(DataView.prototype, Symbol.iterator, function* iterator () {
  for (let i = 0; i < this.byteLength; i++) {
    yield this.getUint8(i);
  }
});

// ─── Promise ──────────────────────────────────────────────────────────────────
// Async iterator. Awaits resolution, then:
//   - delegates to resolved value's own async iterator if present
//   - delegates to resolved value's own sync iterator if present
//   - otherwise yields the resolved value once

define(Promise.prototype, Symbol.asyncIterator, async function* iterator () {
  const val = await this;
  if (val != null && val[Symbol.asyncIterator]) {
    yield* val[Symbol.asyncIterator]();
  } else if (val != null && val[Symbol.iterator]) {
    yield* val[Symbol.iterator]();
  } else {
    yield val;
  }
});

// ─── WeakMap / WeakSet ────────────────────────────────────────────────────────
// Intentionally NOT patched. Non-iterability is load-bearing for GC semantics.
// Adding iteration would require retaining all keys — defeats the purpose.
