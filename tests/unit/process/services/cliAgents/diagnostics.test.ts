/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { CliAgentHistorySummary } from '@/common/types/cliAgent';
import { probeCliAgentStatus, type CliCommandRunner } from '@/process/services/cliAgents/diagnostics';

const history: CliAgentHistorySummary = {
  backend: 'codex',
  support: 'empty',
  sourceLabel: 'test',
  totalSessions: 0,
  warnings: [],
};

function makeHistory(backend: CliAgentHistorySummary['backend']): CliAgentHistorySummary {
  return { ...history, backend };
}

describe('cli agent diagnostics', () => {
  it('marks Codex authenticated from login status output', async () => {
    const runner = vi.fn<CliCommandRunner>(async (_command, args) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'codex-cli 0.130.0\n', stderr: '', timedOut: false };
      }
      return { exitCode: 0, stdout: 'Logged in using ChatGPT\n', stderr: '', timedOut: false };
    });

    const status = await probeCliAgentStatus(
      'codex',
      { backend: 'codex', name: 'Codex', cliPath: '/usr/local/bin/codex' },
      runner,
      makeHistory('codex')
    );

    expect(status.runtimeState).toBe('ready');
    expect(status.authState).toBe('authenticated');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('does not mark Claude ready from auth status JSON alone', async () => {
    const runner = vi.fn<CliCommandRunner>(async (_command, args) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: '2.1.126 (Claude Code)\n', stderr: '', timedOut: false };
      }
      return {
        exitCode: 0,
        stdout: '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\n',
        stderr: '',
        timedOut: false,
      };
    });

    const status = await probeCliAgentStatus(
      'claude',
      { backend: 'claude', name: 'Claude Code', cliPath: '/Users/test/.local/bin/claude' },
      runner,
      makeHistory('claude')
    );

    expect(status.runtimeState).toBe('unknown');
    expect(status.authState).toBe('unknown');
    expect(status.message).toBe('Run Check chat to verify the non-interactive CLI path');
    expect(status.warnings).toContain(
      'Claude Code auth status does not prove non-interactive chat readiness; use Check chat.'
    );
    expect(status.remediation?.commands).toEqual(['claude auth login']);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('does not call interactive Droid auth status', async () => {
    const runner = vi.fn<CliCommandRunner>(async () => ({
      exitCode: 0,
      stdout: '0.102.0\n',
      stderr: '',
      timedOut: false,
    }));

    const status = await probeCliAgentStatus(
      'droid',
      { backend: 'droid', name: 'Factory Droid', cliPath: '/Users/test/.local/bin/droid' },
      runner,
      makeHistory('droid')
    );

    expect(status.runtimeState).toBe('login-required');
    expect(status.authState).toBe('login-required');
    expect(status.remediation?.commands).toEqual(['droid', 'export FACTORY_API_KEY=fk-...']);
    expect(status.remediation?.verifyCommands).toEqual(['droid exec --output-format text "hello"']);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('includes provider login remediation for unauthenticated OpenCode', async () => {
    const runner = vi.fn<CliCommandRunner>(async (_command, args) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: '1.14.20\n', stderr: '', timedOut: false };
      }
      return { exitCode: 1, stdout: 'No credentials configured\n', stderr: '', timedOut: false };
    });

    const status = await probeCliAgentStatus(
      'opencode',
      { backend: 'opencode', name: 'OpenCode', cliPath: '/Users/test/.opencode/bin/opencode' },
      runner,
      makeHistory('opencode')
    );

    expect(status.runtimeState).toBe('login-required');
    expect(status.authState).toBe('not-authenticated');
    expect(status.remediation?.commands).toEqual(['opencode auth login']);
    expect(status.remediation?.verifyCommands).toEqual(['opencode auth list']);
  });

  it('does not show remediation when Codex is ready', async () => {
    const runner = vi.fn<CliCommandRunner>(async (_command, args) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'codex-cli 0.130.0\n', stderr: '', timedOut: false };
      }
      return { exitCode: 0, stdout: 'Logged in using ChatGPT\n', stderr: '', timedOut: false };
    });

    const status = await probeCliAgentStatus(
      'codex',
      { backend: 'codex', name: 'Codex', cliPath: '/usr/local/bin/codex' },
      runner,
      makeHistory('codex')
    );

    expect(status.runtimeState).toBe('ready');
    expect(status.remediation).toBeUndefined();
  });
});
