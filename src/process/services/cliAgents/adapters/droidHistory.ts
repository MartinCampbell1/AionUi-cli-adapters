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
import { isContextOnlyMessage, isRecord, readJsonObject, textFromUnknown, truncateMessage, walkFiles } from './utils';

const DEFAULT_SOURCE = '~/.factory/sessions';

function isDroidNoiseText(text: string): boolean {
  const trimmed = text.trim();
  return (
    !trimmed ||
    trimmed.startsWith('<system-reminder>') ||
    trimmed.startsWith('</system-reminder>') ||
    trimmed === '[Request interrupted by user]'
  );
}

function textFromDroidContent(value: unknown): string | undefined {
  if (typeof value === 'string') return isDroidNoiseText(value) ? undefined : value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!isRecord(item)) return undefined;
        if (item.type !== 'text') return undefined;
        return textFromUnknown(item);
      })
      .filter((item): item is string => Boolean(item?.trim()))
      .filter((item) => !isDroidNoiseText(item));
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  return textFromUnknown(value);
}

function extractDroidMessage(entry: Record<string, unknown>): { role: 'user' | 'assistant'; text: string } | null {
  if (entry.type !== 'message') return null;
  const message = isRecord(entry.message) ? entry.message : undefined;
  const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : undefined;
  if (!role) return null;
  const text = textFromDroidContent(message?.content);
  if (!text?.trim() || isContextOnlyMessage(text)) return null;
  return { role, text };
}

async function parseDroidSession(filePath: string, fileStat: fs.Stats): Promise<CliHistorySession | null> {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const messages: CliHistoryMessage[] = [];
  let sourceSessionId = path.basename(filePath, '.jsonl');
  let workspace: string | undefined;
  let sessionTitle: string | undefined;
  let firstUserText: string | undefined;
  let fallbackAssistantText: string | undefined;
  const fallbackTimestamp = fileStat.mtimeMs || Date.now();
  let createdAt = Number.POSITIVE_INFINITY;
  let updatedAt = 0;

  lines.forEach((line, index) => {
    const entry = readJsonObject(line);
    if (!entry) return;
    const timestamp = normalizeTimestamp(entry.timestamp, fallbackTimestamp);
    createdAt = Math.min(createdAt, timestamp);
    updatedAt = Math.max(updatedAt, timestamp);

    if (entry.type === 'session_start') {
      if (typeof entry.id === 'string') sourceSessionId = entry.id;
      if (typeof entry.cwd === 'string') workspace = entry.cwd;
      if (typeof entry.sessionTitle === 'string') sessionTitle = entry.sessionTitle;
      if (!sessionTitle && typeof entry.title === 'string') sessionTitle = entry.title;
      return;
    }

    if (entry.type === 'session_end' && typeof entry.finalText === 'string') {
      fallbackAssistantText = entry.finalText;
      return;
    }

    const message = extractDroidMessage(entry);
    if (!message) return;
    if (message.role === 'user' && !firstUserText) firstUserText = message.text;
    messages.push({
      id: typeof entry.id === 'string' ? entry.id : `${sourceSessionId}-${index}`,
      role: message.role,
      text: truncateMessage(message.text),
      timestamp,
    });
  });

  if (fallbackAssistantText?.trim() && messages.every((message) => message.role !== 'assistant')) {
    messages.push({
      id: `${sourceSessionId}-final`,
      role: 'assistant',
      text: truncateMessage(fallbackAssistantText),
      timestamp: updatedAt || fallbackTimestamp,
    });
  }

  if (messages.length === 0) return null;
  return {
    backend: 'droid',
    sourceKind: 'droid-jsonl',
    sourceSessionId,
    title: normalizeTitle(sessionTitle || firstUserText, `Droid ${sourceSessionId}`),
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

export function createDroidHistoryReader(homeDir = os.homedir()): CliHistoryReader {
  const sourcePath = expandHomePath(DEFAULT_SOURCE, homeDir);
  return {
    backend: 'droid',
    sourceLabel: 'Factory Droid sessions JSONL',
    sourcePath,
    async listSessions(options): Promise<CliHistoryReaderResult> {
      const warnings: string[] = [];
      const files = await walkFiles(sourcePath, '.jsonl');
      const sortedFiles = files
        .map((file) => {
          const stat = fs.statSync(file);
          return { file, stat };
        })
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      const sessionIds = new Set(options?.sessionIds || []);
      const limit = options?.limit ?? 50;
      const sessions: CliHistorySession[] = [];

      for (const item of sortedFiles) {
        if (!sessionIds.size && sessions.length >= limit) break;
        if (item.stat.size > 25_000_000) {
          warnings.push(`Skipped large Droid history file ${item.file}`);
          continue;
        }
        try {
          const session = await parseDroidSession(item.file, item.stat);
          if (!session) continue;
          if (sessionIds.size && !sessionIds.has(session.sourceSessionId)) continue;
          sessions.push(session);
        } catch (error) {
          warnings.push(
            `Failed to read Droid history file ${item.file}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        backend: 'droid',
        sessions,
        totalSessions: files.length,
        totalMessages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
        warnings,
      };
    },
  };
}
