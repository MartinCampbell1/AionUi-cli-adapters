/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-cli-diagnostics-test-'));
    vi.stubEnv('AIONUI_CLI_DIAGNOSTICS_HOME', tempHome);
    vi.stubEnv('FACTORY_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

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
    expect(status.remediation?.commands).toEqual(['claude auth login --claudeai']);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('marks Claude login required when local OAuth metadata is expired', async () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'redacted',
          refreshToken: 'redacted',
          expiresAt: Date.now() - 60_000,
        },
      })
    );

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

    expect(status.runtimeState).toBe('login-required');
    expect(status.authState).toBe('login-required');
    expect(status.message).toContain('Claude Code OAuth token expired');
    expect(status.warnings.some((warning) => warning.includes('auth status can still report logged in'))).toBe(true);
    expect(status.remediation?.commands).toEqual(['claude auth login --claudeai']);
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

  it('explains that Droid custom models still require Factory auth', async () => {
    const factoryDir = path.join(tempHome, '.factory');
    fs.mkdirSync(factoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(factoryDir, 'settings.json'),
      JSON.stringify({ customModels: [{ id: 'custom:local-codex-lb' }] })
    );

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
    expect(status.warnings).toContain(
      'Factory Droid has custom models configured, but droid exec still requires Factory CLI login or FACTORY_API_KEY before chat can start.'
    );
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

  it('uses the OpenCode cold-start timeout for version and auth probes', async () => {
    const runner = vi.fn<CliCommandRunner>(async (_command, args) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: '1.14.20\n', stderr: '', timedOut: false };
      }
      return { exitCode: 0, stdout: 'OpenAI api\n', stderr: '', timedOut: false };
    });

    const status = await probeCliAgentStatus(
      'opencode',
      { backend: 'opencode', name: 'OpenCode', cliPath: '/Users/test/.opencode/bin/opencode' },
      runner,
      makeHistory('opencode')
    );

    expect(status.runtimeState).toBe('ready');
    expect(runner).toHaveBeenNthCalledWith(1, '/Users/test/.opencode/bin/opencode', ['--version'], 15_000);
    expect(runner).toHaveBeenNthCalledWith(2, '/Users/test/.opencode/bin/opencode', ['auth', 'list'], 15_000);
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
