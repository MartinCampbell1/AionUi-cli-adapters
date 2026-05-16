/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackend, AgentBackend } from './acpTypes';

export type CliAgentBackend = Extract<AgentBackend, 'claude' | 'codex' | 'gemini' | 'hermes' | 'opencode' | 'droid'>;

export type CliAgentAuthState = 'authenticated' | 'login-required' | 'not-authenticated' | 'unknown';

export type CliAgentRuntimeState = 'ready' | 'login-required' | 'unavailable' | 'unsupported' | 'error' | 'unknown';

export type CliAgentHistorySupport = 'supported' | 'unsupported' | 'empty' | 'error';

export type CliAgentResumeStrategy = 'acp-session' | 'native-cli' | 'read-only';

export interface CliAgentRemediation {
  title: string;
  description: string;
  commands: string[];
  verifyCommands: string[];
}

export interface CliAgentHistorySummary {
  backend: CliAgentBackend;
  support: CliAgentHistorySupport;
  sourceLabel: string;
  sourcePath?: string;
  totalSessions: number;
  totalMessages?: number;
  newestAt?: number;
  warnings: string[];
}

export interface CliAgentRuntimeStatus {
  backend: CliAgentBackend;
  name: string;
  installed: boolean;
  cliPath?: string;
  acpArgs?: string[];
  version?: string;
  authState: CliAgentAuthState;
  runtimeState: CliAgentRuntimeState;
  message?: string;
  warnings: string[];
  remediation?: CliAgentRemediation;
  history: CliAgentHistorySummary;
}

export interface CliAgentHistorySession {
  backend: CliAgentBackend;
  sourceSessionId: string;
  title: string;
  workspace?: string;
  sourcePath?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  resumable: boolean;
  resumeStrategy: CliAgentResumeStrategy;
  warnings: string[];
}

export interface CliAgentHistoryListResult {
  backend: CliAgentBackend;
  sessions: CliAgentHistorySession[];
  totalSessions: number;
  warnings: string[];
}

export interface CliAgentImportedHistoryExtra {
  provider: CliAgentBackend;
  sourceSessionId: string;
  sourceKind: 'codex-jsonl' | 'claude-jsonl' | 'hermes-state-db' | 'opencode-db';
  sourcePath?: string;
  importedAt: number;
  messageCount: number;
  resumable: boolean;
  resumeStrategy: CliAgentResumeStrategy;
}

export interface CliAgentImportRequest {
  backend: CliAgentBackend;
  sessionIds?: string[];
  limit?: number;
}

export interface CliAgentImportResult {
  backend: CliAgentBackend;
  imported: number;
  skipped: number;
  failed: number;
  conversations: Array<{
    conversationId: string;
    sourceSessionId: string;
    title: string;
  }>;
  warnings: string[];
}

export function isCliAgentBackend(value: string): value is CliAgentBackend {
  return (
    value === 'claude' ||
    value === 'codex' ||
    value === 'gemini' ||
    value === 'hermes' ||
    value === 'opencode' ||
    value === 'droid'
  );
}

export function isCliAgentAcpBackend(value: CliAgentBackend): value is Extract<CliAgentBackend, AcpBackend> {
  return value !== 'gemini';
}
