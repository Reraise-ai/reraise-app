// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

import { PRIVATE_EXECUTIVE_URL } from '../privateExecutive.js';

/** Quiet credit. Not a board control: muted text, and only the name is a link. */
export function PoweredBy() {
  return (
    <footer className="wb-powered-by">
      <p>
        Powered by{' '}
        <a href={PRIVATE_EXECUTIVE_URL} target="_blank" rel="noopener noreferrer">
          {'Private Executive '}
          <span className="wb-visually-hidden">(opens in a new tab)</span>
        </a>
      </p>
    </footer>
  );
}
