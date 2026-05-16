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

const DEFAULT_SOURCE = '~/.codex/sessions';

function messageTextFromCodexPayload(payload: Record<string, unknown>): string | undefined {
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isRecord(item)) return undefined;
      const type = item.type;
      if (type === 'input_text' || type === 'output_text' || type === 'text') {
        return textFromUnknown(item.text);
      }
      return undefined;
    })
    .filter((item): item is string => Boolean(item?.trim()));
  return parts.length > 0 ? parts.join('\n') : undefined;
}

async function parseCodexSession(filePath: string): Promise<CliHistorySession | null> {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const messages: CliHistoryMessage[] = [];
  let sourceSessionId = path.basename(filePath, '.jsonl').replace(/^rollout-/, '');
  let workspace: string | undefined;
  let createdAt = Number.POSITIVE_INFINITY;
  let updatedAt = 0;
  let firstUserText: string | undefined;

  lines.forEach((line, index) => {
    const event = readJsonObject(line);
    if (!event) return;
    const timestamp = normalizeTimestamp(event.timestamp);
    createdAt = Math.min(createdAt, timestamp);
    updatedAt = Math.max(updatedAt, timestamp);

    if (event.type === 'session_meta' && isRecord(event.payload)) {
      const payload = event.payload;
      if (typeof payload.id === 'string') sourceSessionId = payload.id;
      if (typeof payload.cwd === 'string') workspace = payload.cwd;
      return;
    }

    if (event.type !== 'response_item' || !isRecord(event.payload)) return;
    const payload = event.payload;
    if (payload.type !== 'message') return;
    const role = payload.role === 'assistant' ? 'assistant' : payload.role === 'user' ? 'user' : undefined;
    if (!role) return;
    const text = messageTextFromCodexPayload(payload);
    if (!text?.trim() || isContextOnlyMessage(text)) return;
    if (role === 'user' && !firstUserText) firstUserText = text;
    messages.push({
      id: `${sourceSessionId}-${index}`,
      role,
      text: truncateMessage(text),
      timestamp,
    });
  });

  if (messages.length === 0) return null;
  const fallbackTimestamp = messages[0]?.timestamp ?? Date.now();
  const title = normalizeTitle(firstUserText, `Codex ${sourceSessionId}`);
  return {
    backend: 'codex',
    sourceKind: 'codex-jsonl',
    sourceSessionId,
    title,
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

export function createCodexHistoryReader(homeDir = os.homedir()): CliHistoryReader {
  const sourcePath = expandHomePath(DEFAULT_SOURCE, homeDir);
  return {
    backend: 'codex',
    sourceLabel: 'Codex sessions JSONL',
    sourcePath,
    async listSessions(options): Promise<CliHistoryReaderResult> {
      const warnings: string[] = [];
      const files = await walkFiles(sourcePath, '.jsonl');
      const sessionIds = new Set(options?.sessionIds || []);
      const sortedFiles = files
        .map((file) => {
          const stat = fs.statSync(file);
          return { file, mtime: stat.mtimeMs, size: stat.size };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, sessionIds.size ? files.length : Math.max(options?.limit ?? 50, 200));

      const sessions: CliHistorySession[] = [];
      const limit = options?.limit ?? 50;
      for (const item of sortedFiles) {
        if (!sessionIds.size && sessions.length >= limit) break;
        const file = item.file;
        if (item.size > 25_000_000) {
          warnings.push(`Skipped large Codex history file ${file}`);
          continue;
        }
        try {
          const session = await parseCodexSession(file);
          if (sessionIds.size && session && !sessionIds.has(session.sourceSessionId)) continue;
          if (session) sessions.push(session);
        } catch (error) {
          warnings.push(
            `Failed to read Codex history file ${file}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        backend: 'codex',
        sessions,
        totalSessions: files.length,
        totalMessages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
        warnings,
      };
    },
  };
}
