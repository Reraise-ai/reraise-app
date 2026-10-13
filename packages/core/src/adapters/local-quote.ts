// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// M1 stand-in for ModelConnector (AC-16). It names the card ids in the package it was given
// and writes no proposals. The gate has already chosen those cards. A networked model
// replaces this in the M2 connector slice.

import type { ModelAnswer, ModelConnector } from './model.js';

/** Engine id of the M1 quote model. */
export const LOCAL_QUOTE_ENGINE = 'local-quote';

const NO_QUESTION = 'local-quote: no question';

export function createLocalQuoteModel(): ModelConnector {
  return {
    engine: LOCAL_QUOTE_ENGINE,
    target: 'local_model',
    async ask(pkg, question): Promise<ModelAnswer> {
      if (question.trim() === '') return { text: NO_QUESTION, proposals: [] };
      const ids = pkg.items
        .map((item) => item.card.id)
        .sort()
        .join('\n');
      return { text: ids === '' ? 'local-quote' : `local-quote\n${ids}`, proposals: [] };
    },
  };
}
