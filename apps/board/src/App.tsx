// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useEffect, useMemo, useState } from 'react';
import { createClient } from './api/client.js';
import { clearSession, loadSession, saveSession, type Session } from './api/session.js';
import { LageList } from './components/LageList.js';
import { UsagePanel } from './components/UsagePanel.js';
import { Login } from './components/Login.js';
import { Workbench } from './components/Workbench.js';

interface Props {
  /** For tests: a fetch stub that stands in for the service. */
  fetchImpl?: typeof fetch;
  storage?: Storage;
  pollIntervalMs?: number;
}

export function App({ fetchImpl, storage, pollIntervalMs }: Props = {}) {
  const [session, setSession] = useState<Session | null>(() => loadSession(storage));
  return session ? (
    <Signed
      session={session}
      fetchImpl={fetchImpl}
      pollIntervalMs={pollIntervalMs}
      onSignOut={() => {
        clearSession(storage);
        setSession(null);
      }}
    />
  ) : (
    <Login
      {...(session === null && fetchImpl ? { fetchImpl } : {})}
      onSignIn={(s) => {
        saveSession(s, storage);
        setSession(s);
      }}
    />
  );
}

function Signed(props: {
  session: Session;
  fetchImpl: typeof fetch | undefined;
  pollIntervalMs: number | undefined;
  onSignOut(): void;
}) {
  const { session, fetchImpl, onSignOut } = props;
  const client = useMemo(
    () => createClient({ ...session, ...(fetchImpl ? { fetch: fetchImpl } : {}) }),
    [session, fetchImpl],
  );
  const [worldId, setWorldId] = useState<string | undefined>();
  const [openLage, setOpenLage] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [view, setView] = useState<'boards' | 'usage'>('boards');

  useEffect(() => {
    client
      .world_list()
      .then((w) => setWorldId(w.worlds[0]?.id))
      .catch((e: { status?: number }) => {
        if (e.status === 401) setAuthError(true);
      });
  }, [client]);

  useEffect(() => {
    if (authError) onSignOut();
  }, [authError, onSignOut]);

  return (
    <div className="wb-shell">
      <header className="wb-header">
        <h1>The Worldbuilder</h1>
        <nav aria-label="Views" className="wb-row">
          <button
            type="button"
            data-testid="nav-boards"
            aria-pressed={view === 'boards'}
            onClick={() => setView('boards')}
          >
            Boards
          </button>
          <button
            type="button"
            data-testid="nav-usage"
            aria-pressed={view === 'usage'}
            onClick={() => setView('usage')}
          >
            Usage metrics
          </button>
        </nav>
        <button type="button" data-testid="session-signout" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      {view === 'usage' ? (
        <UsagePanel client={client} />
      ) : openLage ? (
        <Workbench
          client={client}
          lageId={openLage}
          worldId={worldId}
          {...(props.pollIntervalMs !== undefined ? { pollIntervalMs: props.pollIntervalMs } : {})}
          onClose={() => setOpenLage(null)}
        />
      ) : (
        <LageList client={client} worldId={worldId} onOpen={setOpenLage} />
      )}
    </div>
  );
}
