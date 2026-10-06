// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

export type DisclosureTarget = 'screen' | 'local_model' | 'cloud_model' | 'demo';

export interface DisclosureDecision {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
}

/** Skeleton: until rules exist, everything is denied (default deny). */
export function decideDefault(_target: DisclosureTarget): DisclosureDecision {
  return { decision: 'deny', reason: 'default deny: no disclosure rule allows this' };
}
