// Bytes for what goes out ten times a second: the horde, the planes, the toys.
//
// A report that names every figure on the desk is a few hundred bytes this way, against a few
// kilobytes as JSON, and it goes to every guest ten times a second. Places are in centimetres
// in sixteen bits, which holds the desk and the sky over it with room to spare.

const CM = 100;

/** What a player's round ended on, as the others are told it (net/crew.js `pf`). */
export const ENDED = { air: 0, desk: 1, figure: 2, plane: 3 };

export class Writer {
  constructor(size = 2048) {
    this.buf = new ArrayBuffer(size);
    this.dv = new DataView(this.buf);
    this.at = 0;
  }

  room(n) {
    if (this.at + n <= this.buf.byteLength) return;
    const bigger = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.at + n));
    new Uint8Array(bigger).set(new Uint8Array(this.buf, 0, this.at));
    this.buf = bigger;
    this.dv = new DataView(bigger);
  }

  u8(v) { this.room(1); this.dv.setUint8(this.at, clampInt(v, 0, 255)); this.at += 1; return this; }
  u16(v) { this.room(2); this.dv.setUint16(this.at, clampInt(v, 0, 65535)); this.at += 2; return this; }
  f32(v) { this.room(4); this.dv.setFloat32(this.at, Number.isFinite(v) ? v : 0); this.at += 4; return this; }
  /** A time on the room's clock, in ms. */
  f64(v) { this.room(8); this.dv.setFloat64(this.at, Number.isFinite(v) ? v : 0); this.at += 8; return this; }
  /** A place along one axis, in metres. */
  pos(v) { this.room(2); this.dv.setInt16(this.at, clampInt(v * CM, -32768, 32767)); this.at += 2; return this; }
  /** 0 to 1, in 255 steps. */
  unit(v) { return this.u8(v * 255); }
  /** An angle, in 65536 steps round the circle. */
  angle(v) {
    const turn = Math.PI * 2;
    return this.u16(((((v % turn) + turn) % turn) / turn) * 65536 % 65536);
  }
  /** -1 to 1: a quaternion's part. */
  signed(v) { this.room(2); this.dv.setInt16(this.at, clampInt(v * 32767, -32767, 32767)); this.at += 2; return this; }

  bytes() { return new Uint8Array(this.buf, 0, this.at); }
}

export class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = 0;
  }

  /** Throws when the bytes run out: what came was not a whole report, and is dropped whole. */
  need(n) { if (this.at + n > this.dv.byteLength) throw new RangeError('short report'); }
  u8() { this.need(1); return this.dv.getUint8(this.at++); }
  u16() { this.need(2); const v = this.dv.getUint16(this.at); this.at += 2; return v; }
  f32() { this.need(4); const v = this.dv.getFloat32(this.at); this.at += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.at); this.at += 8; return v; }
  pos() { this.need(2); const v = this.dv.getInt16(this.at); this.at += 2; return v / CM; }
  unit() { return this.u8() / 255; }
  angle() { return (this.u16() / 65536) * Math.PI * 2; }
  signed() { this.need(2); const v = this.dv.getInt16(this.at); this.at += 2; return v / 32767; }
  get done() { return this.at >= this.dv.byteLength; }
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number.isFinite(v) ? v : 0);
  return n < lo ? lo : n > hi ? hi : n;
}

/** A number from somebody else's message, or `fallback` when it is not one. */
export function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
