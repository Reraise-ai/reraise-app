// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Card identity (ADR-0005, ADR-0023): `uri = wb:<storeInstanceId>/<externalId>` and the
// canonical id derived from it. Pure functions without I/O, usable in Node and browsers.

import type { CardId, WbUri } from './generated/contracts.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URI_RE =
  /^wb:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/((?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+)$/;
const UNRESERVED = /^[A-Za-z0-9._~-]$/;

/** RFC 3986 percent-encoding of the NFC-normalised UTF-8 bytes, upper-case hex, case kept. */
export function encodeExternalId(externalId: string): string {
  if (externalId.length === 0) throw new Error('externalId must not be empty');
  let out = '';
  for (const byte of new TextEncoder().encode(externalId.normalize('NFC'))) {
    const ch = String.fromCharCode(byte);
    out += UNRESERVED.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** `wb:<storeInstanceId>/<externalId percent-encoded>`. `storeInstanceId` must be a UUID. */
export function buildUri(storeInstanceId: string, externalId: string): WbUri {
  if (!UUID_RE.test(storeInstanceId)) {
    throw new Error('storeInstanceId must be a lower-case UUID, never a hostname, path or name');
  }
  return `wb:${storeInstanceId}/${encodeExternalId(externalId)}`;
}

/** Split a `wb:` URI into its store instance id and the decoded external id. */
export function parseUri(uri: string): { storeInstanceId: string; externalId: string } {
  const m = URI_RE.exec(uri);
  if (!m) throw new Error(`not a wb: card URI: ${uri}`);
  return { storeInstanceId: m[1]!, externalId: decodeURIComponent(m[2]!) };
}

/** True if `uri` is a well-formed `wb:` card URI (and therefore holds no hostname or path). */
export function isWbUri(uri: string): boolean {
  return URI_RE.test(uri);
}

/**
 * Canonical id of a card in a store with its own id scheme: the 128 bits of the ULID are the
 * first 128 bits of SHA-256(uri), as 26 Crockford base32 characters. Same URI, same id, on
 * every machine and after every index rebuild. Derived ids are not time-sortable.
 */
export function deriveCardId(uri: string): CardId {
  if (!isWbUri(uri)) throw new Error(`not a wb: card URI: ${uri}`);
  return encodeUlid(sha256(new TextEncoder().encode(uri)).subarray(0, 16));
}

/** Encode 16 bytes (128 bits) as a 26-character ULID string. */
export function encodeUlid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error('a ULID encodes exactly 16 bytes');
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 (FIPS 180-4). Synchronous and dependency-free so that id derivation works the same
 * in every runtime; tested against node:crypto.
 */
export function sha256(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + add[i]!) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!);
  return out;
}
