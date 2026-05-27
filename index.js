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
define(Object.prototype, Symbol.iterator, function* iterator() {
  for (const key of Object.keys(this)) {
    yield [key, this[key]];
  }
});
// ─── Number ───────────────────────────────────────────────────────────────────
// Creates Array(n) and iterates every slot, including holes.
// Holes yield the HOLE sentinel so consumers can distinguish from undefined.

define(Number.prototype, Symbol.iterator, function* iterator() {
  const len = Math.abs(Math.floor(this.valueOf()));
  const arr = Array(len);
  for (let i = 0; i < len; i++) {
    yield i in arr ? arr[i] : HOLE;
  }
});

// ─── BigInt ───────────────────────────────────────────────────────────────────
// Same range semantics as Number.

define(BigInt.prototype, Symbol.iterator, function* iterator() {
  const len = this.valueOf() < 0n ? -this.valueOf() : this.valueOf();
  const arr = Array(Number(len));
  for (let i = 0; i < arr.length; i++) {
    yield i in arr ? arr[i] : HOLE;
  }
});

// ─── Boolean ──────────────────────────────────────────────────────────────────
// Yields the boolean value once. Trivial but consistent — everything iterates.

define(Boolean.prototype, Symbol.iterator, function* iterator() {
  yield this.valueOf();
});

// ─── RegExp ───────────────────────────────────────────────────────────────────
// Yields [pattern, bool] first (false if pattern is falsy, empty, or throws),
// then yields each active flag character individually.

define(RegExp.prototype, Symbol.iterator, function* iterator() {
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

define(Date.prototype, Symbol.iterator, function* iterator() {
  yield ['year', this.getFullYear()];
  yield ['month', this.getMonth()]; // 0-indexed, matches Date API
  yield ['day', this.getDate()];
  yield ['hours', this.getHours()];
  yield ['minutes', this.getMinutes()];
  yield ['seconds', this.getSeconds()];
  yield ['milliseconds', this.getMilliseconds()];
  yield ['timestamp', this.getTime()];
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

define(Function.prototype, Symbol.iterator, function* iterator() {
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

define(ArrayBuffer.prototype, Symbol.iterator, function* iterator() {
  yield* new Uint8Array(this);
});

// ─── DataView ─────────────────────────────────────────────────────────────────
// Yields each byte in the view's range (respects byteOffset + byteLength).

define(DataView.prototype, Symbol.iterator, function* iterator() {
  for (let i = 0; i < this.byteLength; i++) {
    yield this.getUint8(i);
  }
});

// ─── Promise ──────────────────────────────────────────────────────────────────
// Async iterator. Awaits resolution, then:
//   - delegates to resolved value's own async iterator if present
//   - delegates to resolved value's own sync iterator if present
//   - otherwise yields the resolved value once

define(Promise.prototype, Symbol.asyncIterator, async function* iterator() {
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

/**
 * oprah-iterator/whatwg
 * WHATWG API extensions for oprah-iterator.
 *
 * Separate module — these APIs may not exist in all environments (Node vs browser).
 * Each block guards existence before patching.
 *
 * Sync iter on streaming types yields Promise<{value, done}> per chunk.
 * Consumer pattern:
 *
 *   for (const pchunk of blob) {
 *     const { value, done } = await pchunk;
 *     if (done) break;
 *     chunks.push(value);
 *   }
 */

// ─── Util (local — don't want hard dep on main module internals) ──────────────

function* streamSyncIter(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      yield reader.read(); // Promise<{value: Uint8Array, done: boolean}>
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── ReadableStream ───────────────────────────────────────────────────────────
// Async iter: yield chunks directly (already exists in modern browsers — guard).
// Sync iter: lazy promise-per-chunk via shared util.

if (typeof ReadableStream !== 'undefined') {
  if (!ReadableStream.prototype[Symbol.asyncIterator]) {
    define(ReadableStream.prototype, Symbol.asyncIterator, async function* iterator() {
      const reader = this.getReader();
      try {
        while (true) {
          const {
            value,
            done
          } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    });
  }

  define(ReadableStream.prototype, Symbol.iterator, function* iterator() {
    yield* streamSyncIter(this);
  });
}

// ─── Blob ─────────────────────────────────────────────────────────────────────
// Async iter: yield chunks from .stream().
// Sync iter: lazy promise-per-chunk.
// File extends Blob — inherits both automatically.

if (typeof Blob !== 'undefined') {
  define(Blob.prototype, Symbol.asyncIterator, async function* iterator() {
    const reader = this.stream().getReader();
    try {
      while (true) {
        const {
          value,
          done
        } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  });

  define(Blob.prototype, Symbol.iterator, function* iterator() {
    yield* streamSyncIter(this.stream());
  });
}

// ─── Request ──────────────────────────────────────────────────────────────────
// Sync iter: metadata fields as [k, v] pairs.
// Async iter: body chunks (consumes body — clone first if needed).

if (typeof Request !== 'undefined') {
  define(Request.prototype, Symbol.iterator, function* iterator() {
    yield ['url', this.url];
    yield ['method', this.method];
    yield ['mode', this.mode];
    yield ['credentials', this.credentials];
    yield ['cache', this.cache];
    yield ['redirect', this.redirect];
    yield ['referrer', this.referrer];
    yield ['headers', this.headers];
    yield ['bodyUsed', this.bodyUsed];
  });

  define(Request.prototype, Symbol.asyncIterator, async function* iterator() {
    if (!this.body) return;
    const reader = this.body.getReader();
    try {
      while (true) {
        const {
          value,
          done
        } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  });
}

// ─── Response ─────────────────────────────────────────────────────────────────
// Sync iter: metadata fields as [k, v] pairs.
// Async iter: body chunks.

if (typeof Response !== 'undefined') {
  define(Response.prototype, Symbol.iterator, function* iterator() {
    yield ['url', this.url];
    yield ['status', this.status];
    yield ['statusText', this.statusText];
    yield ['ok', this.ok];
    yield ['redirected', this.redirected];
    yield ['type', this.type];
    yield ['headers', this.headers];
    yield ['bodyUsed', this.bodyUsed];
  });

  define(Response.prototype, Symbol.asyncIterator, async function* iterator() {
    if (!this.body) return;
    const reader = this.body.getReader();
    try {
      while (true) {
        const {
          value,
          done
        } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  });
}

// ─── URL ──────────────────────────────────────────────────────────────────────
// Yields URL components as [k, v] pairs. Same shape as Object iter.

if (typeof URL !== 'undefined') {
  define(URL.prototype, Symbol.iterator, function* iterator() {
    yield ['href', this.href];
    yield ['origin', this.origin];
    yield ['protocol', this.protocol];
    yield ['username', this.username];
    yield ['password', this.password];
    yield ['host', this.host];
    yield ['hostname', this.hostname];
    yield ['port', this.port];
    yield ['pathname', this.pathname];
    yield ['search', this.search];
    yield ['hash', this.hash];
  });
}

// ─── Event ────────────────────────────────────────────────────────────────────
// Yields key event fields as [k, v] pairs.

if (typeof Event !== 'undefined') {
  define(Event.prototype, Symbol.iterator, function* iterator() {
    yield ['type', this.type];
    yield ['target', this.target];
    yield ['currentTarget', this.currentTarget];
    yield ['bubbles', this.bubbles];
    yield ['cancelable', this.cancelable];
    yield ['defaultPrevented', this.defaultPrevented];
    yield ['composed', this.composed];
    yield ['timeStamp', this.timeStamp];
    yield ['isTrusted', this.isTrusted];
  });
}

// ─── MessageEvent ─────────────────────────────────────────────────────────────
// Extends Event — yields MessageEvent-specific fields after super fields.

if (typeof MessageEvent !== 'undefined') {
  define(MessageEvent.prototype, Symbol.iterator, function* iterator() {
    yield* Event.prototype[Symbol.iterator].call(this); // super fields first
    yield ['data', this.data];
    yield ['origin', this.origin];
    yield ['source', this.source];
    yield ['ports', this.ports];
  });
}

// ─── AbortSignal ──────────────────────────────────────────────────────────────
// Yields aborted state and reason.

if (typeof AbortSignal !== 'undefined') {
  define(AbortSignal.prototype, Symbol.iterator, function* iterator() {
    yield ['aborted', this.aborted];
    yield ['reason', this.reason];
  });
}
