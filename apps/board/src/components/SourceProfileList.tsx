// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Eight dimensions of one source, each with its sample size (ADR-0018). Below minimumN the
// board says "insufficient data". There is no combined figure.

import type {
  SourceProfile,
  SourceProfileDimension,
  StoredSourceProfile,
} from '@worldbuilder/core';
import { SOURCE_PROFILE_MINIMUM_N } from '@worldbuilder/core/source-profile';

const ROWS: readonly { id: string; label: string }[] = [
  { id: 'hitAccuracy', label: 'Hit accuracy' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'topicCompetence', label: 'Topic competence' },
  { id: 'agreement', label: 'Agreement' },
  { id: 'deviation', label: 'Deviation' },
  { id: 'sourceQuality', label: 'Source quality' },
  { id: 'historicalPerformance', label: 'Historical performance' },
  { id: 'counterPerspectiveValue', label: 'Counter-perspective value' },
];

function figure(n: number, value: number | undefined, minimumN: number): string {
  if (n < minimumN || value === undefined) return `insufficient data (n=${n})`;
  return `${value} (n=${n})`;
}

function rowText(profile: SourceProfile | undefined, id: string): string {
  const minimumN = profile?.minimumN ?? SOURCE_PROFILE_MINIMUM_N;
  if (id === 'topicCompetence') {
    const topics = profile?.dimensions.topicCompetence ?? [];
    if (topics.length === 0) return figure(0, undefined, minimumN);
    return topics
      .map((topic) => `${topic.topic}: ${figure(topic.n, topic.value, minimumN)}`)
      .join('; ');
  }
  const dimension = profile?.dimensions[id as keyof SourceProfile['dimensions']] as
    SourceProfileDimension | undefined;
  return figure(dimension?.n ?? 0, dimension?.value, minimumN);
}

/** The stored profile, or eight empty dimensions when none has been derived yet. */
export function SourceProfileList({
  profile,
  error,
}: {
  profile: StoredSourceProfile | undefined;
  error: string | null;
}) {
  const current = profile?.profile;
  const earlier = profile?.earlier.at(-1);
  return (
    <section aria-labelledby="source-profile-h" data-testid="source-profile">
      <h3 id="source-profile-h">Source profile</h3>
      <p className="wb-muted">On this device only. Each dimension stands on its own.</p>
      {error ? (
        <p role="alert" className="wb-error" data-testid="source-profile-error">
          {error}
        </p>
      ) : (
        <ul className="wb-list">
          {ROWS.map((row) => (
            <li key={row.id} data-testid={`source-dimension-${row.id}`}>
              {row.label}: {rowText(current, row.id)}
            </li>
          ))}
        </ul>
      )}
      {earlier && (
        <p className="wb-muted" data-testid="source-profile-earlier">
          Earlier hit count: {earlier.dimensions.hitAccuracy.n}
        </p>
      )}
    </section>
  );
}
