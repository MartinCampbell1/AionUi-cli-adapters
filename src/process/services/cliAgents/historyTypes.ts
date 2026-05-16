/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliAgentBackend, CliAgentHistorySession, CliAgentResumeStrategy } from '@/common/types/cliAgent';

export type CliHistoryMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface CliHistoryMessage {
  id: string;
  role: CliHistoryMessageRole;
  text: string;
  timestamp: number;
  hidden?: boolean;
}

export interface CliHistorySession extends CliAgentHistorySession {
  sourceKind: 'codex-jsonl' | 'claude-jsonl' | 'hermes-state-db' | 'opencode-db';
  messages: CliHistoryMessage[];
}

export interface CliHistoryReaderResult {
  backend: CliAgentBackend;
  sessions: CliHistorySession[];
  totalSessions: number;
  totalMessages?: number;
  warnings: string[];
}

export interface CliHistoryReader {
  backend: CliAgentBackend;
  sourceLabel: string;
  sourcePath?: string;
  listSessions(options?: { limit?: number; sessionIds?: string[] }): Promise<CliHistoryReaderResult>;
}

export function toHistorySessionSummary(session: CliHistorySession): CliAgentHistorySession {
  return {
    backend: session.backend,
    sourceSessionId: session.sourceSessionId,
    title: session.title,
    workspace: session.workspace,
    sourcePath: session.sourcePath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    resumable: session.resumable,
    resumeStrategy: session.resumeStrategy,
    warnings: session.warnings,
  };
}

export function normalizeTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeTitle(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

export function makeReadOnlyResume(): { resumable: false; resumeStrategy: CliAgentResumeStrategy } {
  return { resumable: false, resumeStrategy: 'read-only' };
}
