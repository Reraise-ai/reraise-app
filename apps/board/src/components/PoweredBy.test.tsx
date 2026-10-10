// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The quiet "Powered by Private Executive" credit: a real link, on the login screen and on the
// working screens, keyboard reachable, and not a board control.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App.js';
import { saveSession } from '../api/session.js';
import { PRIVATE_EXECUTIVE_URL } from '../privateExecutive.js';
import { BASE, LAGE_ID, TOKEN, createMockApi } from '../testing/mockApi.js';
import { PoweredBy } from './PoweredBy.js';

function link() {
  return screen.getByRole('link', { name: /Private Executive/ });
}

describe('Powered by Private Executive', () => {
  it('is a new-tab link to the one address, and not a board control', () => {
    render(<PoweredBy />);
    const credit = link();
    expect(credit.tagName).toBe('A');
    expect(credit.getAttribute('href')).toBe(PRIVATE_EXECUTIVE_URL);
    expect(credit.getAttribute('target')).toBe('_blank');
    expect(credit.getAttribute('rel')).toBe('noopener noreferrer');
    expect(credit.className).toBe('');
    expect(credit.closest('button, nav, header, main')).toBeNull();
    expect(screen.getByRole('contentinfo').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Powered by Private Executive (opens in a new tab)',
    );
    const url = new URL(PRIVATE_EXECUTIVE_URL);
    expect(url.protocol).toBe('https:');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it('is reached with the keyboard', async () => {
    render(<PoweredBy />);
    await userEvent.tab();
    expect(document.activeElement).toBe(link());
  });

  it('keeps a visible focus ring on the credit link', () => {
    const css = readFileSync(path.resolve('apps/board/src/App.css'), 'utf8');
    const at = css.indexOf('.wb-powered-by a:focus-visible');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, at + 180);
    expect(block).toContain('outline:');
    expect(block).toContain('var(--wb-focus)');
    expect(block).not.toContain('outline: none');
    expect(css).toContain('text-decoration: underline');
  });

  it('shows the credit on the login screen, below the form', async () => {
    render(<App fetchImpl={createMockApi().fetch} />);
    expect(screen.getByTestId('login-form')).toBeTruthy();
    expect(link().closest('main')).toBeNull();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByTestId('login-base-url'));
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(link());
  });

  it('shows the credit on the Lagen list, the usage view and the open board', async () => {
    const api = createMockApi();
    saveSession({ baseUrl: BASE, token: TOKEN });
    render(<App fetchImpl={api.fetch} pollIntervalMs={30} />);
    await screen.findByTestId('lage-list');
    expect(link().closest('main, nav')).toBeNull();

    await userEvent.click(screen.getByTestId('nav-usage'));
    await screen.findByTestId('usage-panel');
    expect(link().getAttribute('href')).toBe(PRIVATE_EXECUTIVE_URL);

    await userEvent.click(screen.getByTestId('nav-boards'));
    await userEvent.click(await screen.findByTestId(`lage-open-${LAGE_ID}`));
    await screen.findByTestId('workbench');
    expect(link().closest('.react-flow, main')).toBeNull();

    await userEvent.click(screen.getByTestId('session-signout'));
    expect(screen.getByTestId('login-form')).toBeTruthy();
    expect(link().getAttribute('href')).toBe(PRIVATE_EXECUTIVE_URL);
  });
});
