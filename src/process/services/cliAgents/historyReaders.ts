/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliAgentBackend, CliAgentHistoryListResult, CliAgentHistorySummary } from '@/common/types/cliAgent';
import { getCliAgentDescriptor } from './registry';
import type { CliHistoryReader, CliHistorySession } from './historyTypes';
import { toHistorySessionSummary } from './historyTypes';
import { createClaudeHistoryReader } from './adapters/claudeHistory';
import { createCodexHistoryReader } from './adapters/codexHistory';
import { createHermesHistoryReader } from './adapters/hermesHistory';
import { createOpenCodeHistoryReader } from './adapters/opencodeHistory';
import { createUnsupportedHistoryReader } from './adapters/unsupportedHistory';

export function createHistoryReader(backend: CliAgentBackend): CliHistoryReader {
  if (backend === 'claude') return createClaudeHistoryReader();
  if (backend === 'codex') return createCodexHistoryReader();
  if (backend === 'hermes') return createHermesHistoryReader();
  if (backend === 'opencode') return createOpenCodeHistoryReader();
  return createUnsupportedHistoryReader(backend);
}

export async function readHistorySessions(
  backend: CliAgentBackend,
  options?: { limit?: number; sessionIds?: string[] }
): Promise<{ sessions: CliHistorySession[]; totalSessions: number; totalMessages?: number; warnings: string[] }> {
  const reader = createHistoryReader(backend);
  const result = await reader.listSessions(options);
  return {
    sessions: result.sessions,
    totalSessions: result.totalSessions,
    totalMessages: result.totalMessages,
    warnings: result.warnings,
  };
}

export async function listHistorySessions(
  backend: CliAgentBackend,
  options?: { limit?: number; sessionIds?: string[] }
): Promise<CliAgentHistoryListResult> {
  const result = await readHistorySessions(backend, options);
  return {
    backend,
    sessions: result.sessions.map(toHistorySessionSummary),
    totalSessions: result.totalSessions,
    warnings: result.warnings,
  };
}

export async function getHistorySummary(backend: CliAgentBackend): Promise<CliAgentHistorySummary> {
  const descriptor = getCliAgentDescriptor(backend);
  const reader = createHistoryReader(backend);
  const result = await reader.listSessions({ limit: 10 });
  const newestAt = result.sessions.reduce<number | undefined>((newest, session) => {
    if (!newest || session.updatedAt > newest) return session.updatedAt;
    return newest;
  }, undefined);
  const supportedBackends: CliAgentBackend[] = ['claude', 'codex', 'hermes', 'opencode'];
  const support = supportedBackends.includes(backend)
    ? result.sessions.length > 0
      ? 'supported'
      : result.warnings.length > 0
        ? 'error'
        : 'empty'
    : 'unsupported';

  return {
    backend,
    support,
    sourceLabel: descriptor.historyLabel,
    sourcePath: reader.sourcePath,
    totalSessions: result.totalSessions,
    totalMessages: result.totalMessages,
    newestAt,
    warnings: result.warnings,
  };
}
