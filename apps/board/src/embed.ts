// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Embedding mode: a host (for example a desktop app plugin or an iframe) shows the board inside
// its own window. The host owns the session, so the board drops its demo notice and Sign out,
// and it takes the host's light or dark theme.

import { useEffect, useState } from 'react';

export type BoardTheme = 'light' | 'dark';

export interface EmbedOptions {
  embed: boolean;
  theme?: BoardTheme;
}

/** Reads `?embed=1` and `?theme=light|dark` from a query string. Anything else is ignored. */
export function embedOptions(search: string): EmbedOptions {
  const query = new URLSearchParams(search);
  const theme = query.get('theme');
  return {
    embed: query.get('embed') === '1',
    ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
  };
}

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function systemTheme(): BoardTheme {
  try {
    return globalThis.matchMedia?.(LIGHT_QUERY).matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * The theme the board shows: the host's when it names one; when embedded without one, the
 * system preference (and its later changes); otherwise the board's own dark theme.
 */
export function useBoardTheme(embed: boolean, theme: BoardTheme | undefined): BoardTheme {
  const follow = embed && theme === undefined;
  const [system, setSystem] = useState<BoardTheme>(() => (follow ? systemTheme() : 'dark'));
  useEffect(() => {
    if (!follow) return;
    setSystem(systemTheme());
    let media: MediaQueryList | undefined;
    try {
      media = globalThis.matchMedia?.(LIGHT_QUERY);
    } catch {
      return;
    }
    if (!media) return;
    const onChange = () => setSystem(systemTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [follow]);
  return theme ?? (follow ? system : 'dark');
}
