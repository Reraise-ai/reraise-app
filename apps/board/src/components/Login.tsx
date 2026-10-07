// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useState, type FormEvent } from 'react';
import { createClient } from '../api/client.js';
import { DEFAULT_BASE_URL, type Session } from '../api/session.js';

interface Props {
  initialBaseUrl?: string;
  /** Called with a session whose token the service accepted. */
  onSignIn(session: Session): void;
  fetchImpl?: typeof fetch;
}

/** Paste the token printed by `worldbuilder serve`; it is checked against the service. */
export function Login({ initialBaseUrl = DEFAULT_BASE_URL, onSignIn, fetchImpl }: Props) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const session = { baseUrl: baseUrl.trim(), token: token.trim() };
    if (!session.token) {
      setError('Paste the session token first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createClient({ ...session, ...(fetchImpl ? { fetch: fetchImpl } : {}) }).world_list();
      onSignIn(session);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 401
          ? 'The service did not accept this token.'
          : `Could not sign in: ${(err as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wb-page">
      <h1>The Worldbuilder</h1>
      <form onSubmit={submit} data-testid="login-form" aria-label="Sign in">
        <p className="wb-muted">
          Start the service with <code>worldbuilder serve</code> and paste the session token it
          prints. The token stays in this tab only.
        </p>
        <div className="wb-field">
          <label htmlFor="login-base-url">Service address</label>
          <input
            id="login-base-url"
            data-testid="login-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="wb-field">
          <label htmlFor="login-token">Session token</label>
          <input
            id="login-token"
            data-testid="login-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="wb-primary" data-testid="login-submit" disabled={busy}>
          Open the board
        </button>
        {error && (
          <p role="alert" className="wb-error" data-testid="login-error">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
