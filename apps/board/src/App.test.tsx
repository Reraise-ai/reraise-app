// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import css from './App.css?raw';

describe('App placeholder', () => {
  it('renders the heading and the three layers', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'The Worldbuilder' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('styles only through tokens: no raw colours outside tokens.css', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|hsl)a?\(/);
  });
});
