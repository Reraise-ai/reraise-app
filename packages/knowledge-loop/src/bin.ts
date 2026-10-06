#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Entry point of the `wb` command line; see cli.ts for commands and exit codes.

import { runCli } from './cli.js';

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
});
