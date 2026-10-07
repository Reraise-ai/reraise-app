// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The session token lives in sessionStorage only (gone when the tab closes), never in
// localStorage, a cookie or the URL (ADR-0026). Storage may be unavailable; then the session
// simply does not persist across reloads.

const KEY = 'wb.session';

export interface Session {
  baseUrl: string;
  token: string;
}

export const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';

export function loadSession(storage: Storage | undefined = safeStorage()): Session | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Session>;
    if (typeof v.token === 'string' && v.token && typeof v.baseUrl === 'string') {
      return { baseUrl: v.baseUrl, token: v.token };
    }
  } catch {
    /* unreadable: treat as signed out */
  }
  return null;
}

export function saveSession(session: Session, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(session));
  } catch {
    /* not persisted */
  }
}

export function clearSession(storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
