// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from './session.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe('session storage', () => {
  it('round-trips the session in sessionStorage and clears it', () => {
    const s = memoryStorage();
    expect(loadSession(s)).toBeNull();
    saveSession({ baseUrl: 'http://127.0.0.1:4310', token: 't' }, s);
    expect(loadSession(s)).toEqual({ baseUrl: 'http://127.0.0.1:4310', token: 't' });
    clearSession(s);
    expect(loadSession(s)).toBeNull();
  });

  it('uses sessionStorage, never localStorage, by default', () => {
    saveSession({ baseUrl: 'http://x', token: 'abc' });
    expect(sessionStorage.getItem('wb.session')).toContain('abc');
    expect(localStorage.length).toBe(0);
  });

  it('treats garbage and incomplete entries as signed out', () => {
    expect(loadSession(memoryStorage({ 'wb.session': 'not json' }))).toBeNull();
    expect(loadSession(memoryStorage({ 'wb.session': '{"baseUrl":"x"}' }))).toBeNull();
    expect(loadSession(memoryStorage({ 'wb.session': '{"baseUrl":"x","token":""}' }))).toBeNull();
  });

  it('keeps working when storage throws', () => {
    const broken = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadSession(broken)).toBeNull();
    expect(() => saveSession({ baseUrl: 'x', token: 't' }, broken)).not.toThrow();
    expect(() => clearSession(broken)).not.toThrow();
  });
});
