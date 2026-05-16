/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import type { CliAgentBackend } from '@/common/types/cliAgent';

export interface CliAgentRemediationDescriptor {
  title: string;
  description: string;
  commands: string[];
  verifyCommands: string[];
}

export interface CliAgentDescriptor {
  backend: CliAgentBackend;
  name: string;
  command: string;
  versionArgs: string[];
  probeTimeoutMs?: number;
  authProbe?: {
    args: string[];
    authenticatedPatterns: string[];
    unauthenticatedPatterns: string[];
    provesChatReadiness?: boolean;
  };
  historyLabel: string;
  defaultHistoryPath?: string;
  remediation?: CliAgentRemediationDescriptor;
}

export const CLI_AGENT_BACKENDS: CliAgentBackend[] = ['claude', 'codex', 'gemini', 'hermes', 'opencode', 'droid'];

export const CLI_AGENT_DESCRIPTORS: Record<CliAgentBackend, CliAgentDescriptor> = {
  claude: {
    backend: 'claude',
    name: 'Claude Code',
    command: ACP_BACKENDS_ALL.claude.cliCommand || 'claude',
    versionArgs: ['--version'],
    authProbe: {
      args: ['auth', 'status'],
      authenticatedPatterns: ['"loggedin":true', '"loggedIn":true', '"authenticated":true', 'logged in'],
      unauthenticatedPatterns: [
        'not logged in',
        'login required',
        'unauthorized',
        '"loggedin":false',
        '"loggedIn":false',
      ],
      provesChatReadiness: false,
    },
    historyLabel: 'Claude Code JSONL',
    defaultHistoryPath: '~/.claude/projects',
    remediation: {
      title: 'Repair Claude Code CLI login',
      description:
        'AionUi reuses the local Claude Code CLI session. If chat returns 401 even while auth status says logged in, refresh the Claude CLI login in Terminal.',
      commands: ['claude auth login --claudeai'],
      verifyCommands: ['claude -p "hello" --dangerously-skip-permissions --output-format text'],
    },
  },
  codex: {
    backend: 'codex',
    name: 'Codex',
    command: ACP_BACKENDS_ALL.codex.cliCommand || 'codex',
    versionArgs: ['--version'],
    authProbe: {
      args: ['login', 'status'],
      authenticatedPatterns: ['logged in', 'authenticated'],
      unauthenticatedPatterns: ['not logged in', 'login required', 'unauthorized'],
    },
    historyLabel: 'Codex sessions JSONL',
    defaultHistoryPath: '~/.codex/sessions',
    remediation: {
      title: 'Repair Codex CLI login',
      description: 'AionUi talks to Codex through the local Codex CLI and mirrors its local auth into the ACP process.',
      commands: ['codex login'],
      verifyCommands: ['codex login status'],
    },
  },
  gemini: {
    backend: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    versionArgs: ['--version'],
    historyLabel: 'Gemini CLI history',
    defaultHistoryPath: '~/.gemini/history',
    remediation: {
      title: 'Repair Gemini CLI login',
      description:
        'Gemini is launched through the installed Gemini CLI; complete auth in the CLI if requests start retrying.',
      commands: ['gemini'],
      verifyCommands: ['gemini --version'],
    },
  },
  hermes: {
    backend: 'hermes',
    name: 'Hermes Agent',
    command: ACP_BACKENDS_ALL.hermes.cliCommand || 'hermes',
    versionArgs: ['--version'],
    historyLabel: 'Hermes state.db',
    defaultHistoryPath: '~/.hermes/state.db',
    remediation: {
      title: 'Repair Hermes provider login',
      description:
        'Hermes Agent can be installed while its upstream provider token is expired. Refresh the provider auth, then re-check Hermes.',
      commands: ['codex', 'hermes auth status openai-codex'],
      verifyCommands: ['hermes auth list', 'hermes auth status openai-codex'],
    },
  },
  opencode: {
    backend: 'opencode',
    name: 'OpenCode',
    command: ACP_BACKENDS_ALL.opencode.cliCommand || 'opencode',
    versionArgs: ['--version'],
    probeTimeoutMs: 15_000,
    authProbe: {
      args: ['auth', 'list'],
      authenticatedPatterns: ['openai', 'anthropic', 'google', 'enabled', 'credential'],
      unauthenticatedPatterns: ['no credentials', 'not logged in', 'login required'],
    },
    historyLabel: 'OpenCode SQLite',
    defaultHistoryPath: '~/.local/share/opencode/opencode.db',
    remediation: {
      title: 'Repair OpenCode provider login',
      description:
        'OpenCode stores provider credentials locally; AionUi uses those credentials through the OpenCode CLI.',
      commands: ['opencode auth login'],
      verifyCommands: ['opencode auth list'],
    },
  },
  droid: {
    backend: 'droid',
    name: 'Factory Droid',
    command: ACP_BACKENDS_ALL.droid.cliCommand || 'droid',
    versionArgs: ['--version'],
    probeTimeoutMs: 15_000,
    historyLabel: 'Factory Droid history',
    remediation: {
      title: 'Complete Factory Droid CLI login',
      description:
        'AionUi runs Droid through the local CLI (`droid exec`). Open Droid once in Terminal and finish `/login`, or export FACTORY_API_KEY in your shell environment.',
      commands: ['droid', 'export FACTORY_API_KEY=fk-...'],
      verifyCommands: ['droid exec --output-format text "hello"'],
    },
  },
};

export function getCliAgentDescriptor(backend: CliAgentBackend): CliAgentDescriptor {
  return CLI_AGENT_DESCRIPTORS[backend];
}

export function expandHomePath(pathname: string, homeDir: string): string {
  return pathname.startsWith('~/') ? `${homeDir}${pathname.slice(1)}` : pathname;
}
