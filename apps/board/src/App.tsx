// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useEffect, useMemo, useState } from 'react';
import { createClient, type BoardClient } from './api/client.js';
import { clearSession, loadSession, saveSession, type Session } from './api/session.js';
import { LageList } from './components/LageList.js';
import { ProposalsInbox } from './components/ProposalsInbox.js';
import { TrainingExportPanel } from './components/TrainingExportPanel.js';
import { UsagePanel } from './components/UsagePanel.js';
import { Login } from './components/Login.js';
import { PoweredBy } from './components/PoweredBy.js';
import { Workbench } from './components/Workbench.js';

interface Props {
  /** For tests: a fetch stub that stands in for the service. */
  fetchImpl?: typeof fetch;
  storage?: Storage;
  pollIntervalMs?: number;
  /** For tests: the wait before the local level-1 engine re-runs after an assumption change. */
  level1DebounceMs?: number;
  /** Static demo: this client is the board. There is no Board API. */
  client?: BoardClient;
  onSignOut?: () => void;
}

export function App({
  fetchImpl,
  storage,
  pollIntervalMs,
  level1DebounceMs,
  client,
  onSignOut,
}: Props = {}) {
  const [session, setSession] = useState<Session | null>(() =>
    client ? null : loadSession(storage),
  );
  if (client) {
    return (
      <Signed
        client={client}
        demo
        pollIntervalMs={pollIntervalMs}
        level1DebounceMs={level1DebounceMs}
        onSignOut={() => onSignOut?.()}
      />
    );
  }
  return session ? (
    <SignedSession
      session={session}
      fetchImpl={fetchImpl}
      pollIntervalMs={pollIntervalMs}
      level1DebounceMs={level1DebounceMs}
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

function SignedSession(props: {
  session: Session;
  fetchImpl: typeof fetch | undefined;
  pollIntervalMs: number | undefined;
  level1DebounceMs: number | undefined;
  onSignOut(): void;
}) {
  const { session, fetchImpl, onSignOut } = props;
  // Any 401, from any call, ends the session (the token is wrong or the service was restarted).
  const client = useMemo(
    () =>
      createClient({
        ...session,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        onUnauthorized: onSignOut,
      }),
    [session, fetchImpl, onSignOut],
  );
  return (
    <Signed
      client={client}
      pollIntervalMs={props.pollIntervalMs}
      level1DebounceMs={props.level1DebounceMs}
      onSignOut={onSignOut}
    />
  );
}

function Signed(props: {
  client: BoardClient;
  demo?: boolean;
  pollIntervalMs: number | undefined;
  level1DebounceMs: number | undefined;
  onSignOut(): void;
}) {
  const { client, onSignOut } = props;
  const [worldId, setWorldId] = useState<string | undefined>();
  const [openLage, setOpenLage] = useState<string | null>(null);
  const [view, setView] = useState<'boards' | 'usage'>('boards');

  useEffect(() => {
    client
      .world_list()
      .then((w) => setWorldId(w.worlds[0]?.id))
      .catch(() => undefined);
  }, [client]);

  return (
    <div className="wb-shell">
      <header className="wb-header">
        <h1>The Worldbuilder</h1>
        {props.demo && (
          <p className="wb-muted" data-testid="demo-banner">
            Demo. Changes stay in this browser.
          </p>
        )}
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
          key={openLage}
          client={client}
          lageId={openLage}
          worldId={worldId}
          {...(props.pollIntervalMs !== undefined ? { pollIntervalMs: props.pollIntervalMs } : {})}
          {...(props.level1DebounceMs !== undefined
            ? { level1DebounceMs: props.level1DebounceMs }
            : {})}
          onClose={() => setOpenLage(null)}
          onOpenLage={setOpenLage}
        />
      ) : (
        <>
          <LageList client={client} worldId={worldId} onOpen={setOpenLage} />
          <TrainingExportPanel client={client} />
          <aside className="wb-page" aria-label="All proposals">
            <ProposalsInbox
              client={client}
              {...(props.pollIntervalMs !== undefined
                ? { pollIntervalMs: props.pollIntervalMs }
                : {})}
            />
          </aside>
        </>
      )}
      <PoweredBy />
    </div>
  );
}
