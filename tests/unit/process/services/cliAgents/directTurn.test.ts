/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  cleanDirectCliOutput,
  getDirectCliCommandSpec,
  isDirectCliTurnBackend,
} from '@/process/services/cliAgents/directTurn';

describe('direct CLI turn backend routing', () => {
  it('routes one-shot CLI backends away from prewarmed ACP sessions', () => {
    expect(isDirectCliTurnBackend('claude')).toBe(true);
    expect(isDirectCliTurnBackend('droid')).toBe(true);
    expect(isDirectCliTurnBackend('hermes')).toBe(true);
    expect(isDirectCliTurnBackend('gemini')).toBe(true);
  });

  it('keeps ACP-native backends on their normal transport', () => {
    expect(isDirectCliTurnBackend('codex')).toBe(false);
    expect(isDirectCliTurnBackend('opencode')).toBe(false);
    expect(isDirectCliTurnBackend(undefined)).toBe(false);
  });

  it('runs Claude one-shot chat with explicit text output and isolated MCP config', () => {
    const spec = getDirectCliCommandSpec('claude', 'hello');

    expect(spec.command).toBe('claude');
    expect(spec.args).toEqual([
      '-p',
      'hello',
      '--setting-sources',
      'project,local',
      '--dangerously-skip-permissions',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--no-chrome',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
    ]);
  });

  it('keeps Gemini text when MCP warning is printed on the same line', () => {
    const output = cleanDirectCliOutput(
      'gemini',
      [
        'MCP issues detected. Run /mcp list for status.gemini adapter ok',
        'Created execution plan for SessionEnd: 1 hook(s) to execute in parallel',
        'Hook execution for SessionEnd: 1 hooks executed successfully, total duration: 9ms',
      ].join('\n')
    );

    expect(output).toBe('gemini adapter ok');
  });
});
