// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * axe-core on the current screen: WCAG 2.x A and AA rules plus best practices. Serious and
 * critical violations fail; lower impacts are printed, not failed.
 */
export async function scan(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  const report = (impacts: string[]) =>
    results.violations
      .filter((v) => impacts.includes(v.impact ?? ''))
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => n.target.join(' ')),
      }));
  const minor = report(['minor', 'moderate']);
  if (minor.length > 0) console.log(`axe (${screen}) moderate or minor:`, JSON.stringify(minor));
  expect(report(['serious', 'critical']), `axe violations on ${screen}`).toEqual([]);
}
