# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Test harness for the Hermes integration: a fake Hermes plugin host and a fake Worldbuilder MCP
responder. Hermes itself is never installed (it is heavy); the host fake copies the contracts the
plugin depends on from the Hermes source and cites the files."""
