#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

import { main } from './main.js';

const code = await main(process.argv.slice(2));
if (code >= 0) process.exit(code);
