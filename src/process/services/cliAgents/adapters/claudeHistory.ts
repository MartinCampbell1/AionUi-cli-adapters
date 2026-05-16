/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expandHomePath } from '../registry';
import {
  makeReadOnlyResume,
  normalizeTimestamp,
  normalizeTitle,
  type CliHistoryMessage,
  type CliHistoryReader,
  type CliHistoryReaderResult,
  type CliHistorySession,
} from '../historyTypes';
import { isRecord, readJsonObject, textFromUnknown, truncateMessage, walkFiles } from './utils';

const DEFAULT_SOURCE = '~/.claude/projects';

function extractClaudeMessage(entry: Record<string, unknown>): { role: 'user' | 'assistant'; text: string } | null {
  const type = entry.type;
  if (type !== 'user' && type !== 'assistant') return null;
  if (entry.isMeta === true || entry.isSidechain === true) return null;
  const message = isRecord(entry.message) ? entry.message : undefined;
  const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : type;
  const text = textFromUnknown(message?.content ?? entry.content);
  if (!text?.trim()) return null;
  return { role, text };
}

async function parseClaudeSession(filePath: string): Promise<CliHistorySession | null> {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const messages: CliHistoryMessage[] = [];
  let sourceSessionId = path.basename(filePath, '.jsonl');
  let workspace: string | undefined;
  let createdAt = Number.POSITIVE_INFINITY;
  let updatedAt = 0;
  let firstUserText: string | undefined;

  lines.forEach((line, index) => {
    const entry = readJsonObject(line);
    if (!entry) return;
    if (typeof entry.sessionId === 'string') sourceSessionId = entry.sessionId;
    if (typeof entry.cwd === 'string') workspace = entry.cwd;
    const timestamp = normalizeTimestamp(entry.timestamp);
    createdAt = Math.min(createdAt, timestamp);
    updatedAt = Math.max(updatedAt, timestamp);
    const message = extractClaudeMessage(entry);
    if (!message) return;
    if (message.role === 'user' && !firstUserText) firstUserText = message.text;
    messages.push({
      id: typeof entry.uuid === 'string' ? entry.uuid : `${sourceSessionId}-${index}`,
      role: message.role,
      text: truncateMessage(message.text),
      timestamp,
    });
  });

  if (messages.length === 0) return null;
  const fallbackTimestamp = messages[0]?.timestamp ?? Date.now();
  return {
    backend: 'claude',
    sourceKind: 'claude-jsonl',
    sourceSessionId,
    title: normalizeTitle(firstUserText, `Claude ${sourceSessionId}`),
    workspace,
    sourcePath: filePath,
    createdAt: Number.isFinite(createdAt) ? createdAt : fallbackTimestamp,
    updatedAt: updatedAt || fallbackTimestamp,
    messageCount: messages.length,
    messages,
    warnings: [],
    ...makeReadOnlyResume(),
  };
}

export function createClaudeHistoryReader(homeDir = os.homedir()): CliHistoryReader {
  const sourcePath = expandHomePath(DEFAULT_SOURCE, homeDir);
  return {
    backend: 'claude',
    sourceLabel: 'Claude Code JSONL',
    sourcePath,
    async listSessions(options): Promise<CliHistoryReaderResult> {
      const warnings: string[] = [];
      const files = await walkFiles(sourcePath, '.jsonl');
      const sortedFiles = files
        .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .map((item) => item.file);
      const sessionIds = new Set(options?.sessionIds || []);
      const limit = options?.limit ?? 50;
      const sessions: CliHistorySession[] = [];

      for (const file of sortedFiles) {
        if (!sessionIds.size && sessions.length >= limit) break;
        try {
          const session = await parseClaudeSession(file);
          if (!session) continue;
          if (sessionIds.size && !sessionIds.has(session.sourceSessionId)) continue;
          sessions.push(session);
        } catch (error) {
          warnings.push(
            `Failed to read Claude history file ${file}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        backend: 'claude',
        sessions,
        totalSessions: files.length,
        totalMessages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
        warnings,
      };
    },
  };
}
