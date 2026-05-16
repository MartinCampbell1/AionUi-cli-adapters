/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
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
import { fileExists, truncateMessage } from './utils';
import { runSqliteJson, sqlString } from './sqliteCli';

const DEFAULT_SOURCE = '~/.hermes/state.db';

type HermesSessionRow = {
  id: string;
  source?: string | null;
  title?: string | null;
  model_config?: string | null;
  started_at?: number | null;
  updated_at?: number | null;
  last_message_at?: number | null;
  actual_message_count: number;
};

type HermesMessageRow = {
  id: number | string;
  role: string;
  content?: string | null;
  timestamp?: number | null;
};

function workspaceFromModelConfig(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'cwd' in parsed) {
      const cwd = (parsed as { cwd?: unknown }).cwd;
      return typeof cwd === 'string' ? cwd : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function roleFromHermes(value: string): 'user' | 'assistant' | 'system' | 'tool' | undefined {
  if (value === 'user') return 'user';
  if (value === 'assistant') return 'assistant';
  if (value === 'system') return 'system';
  if (value === 'tool') return 'tool';
  return undefined;
}

async function readHermesMessages(sourcePath: string, sessionId: string): Promise<CliHistoryMessage[]> {
  const rows = await runSqliteJson<HermesMessageRow>(
    sourcePath,
    `select id, role, content, timestamp
       from messages
       where session_id = ${sqlString(sessionId)}
       order by timestamp asc, id asc`
  );

  const messages = rows.map((row): CliHistoryMessage | null => {
    const role = roleFromHermes(String(row.role));
    const text = typeof row.content === 'string' ? row.content.trim() : undefined;
    if (!role || !text) return null;
    return {
      id: String(row.id),
      role,
      text: truncateMessage(text),
      timestamp: normalizeTimestamp(row.timestamp),
      hidden: role === 'tool' || role === 'system',
    };
  });
  return messages.filter((message): message is CliHistoryMessage => Boolean(message));
}

export function createHermesHistoryReader(homeDir = os.homedir()): CliHistoryReader {
  const sourcePath = expandHomePath(DEFAULT_SOURCE, homeDir);
  return {
    backend: 'hermes',
    sourceLabel: 'Hermes state.db',
    sourcePath,
    async listSessions(options): Promise<CliHistoryReaderResult> {
      const warnings: string[] = [];
      if (!(await fileExists(sourcePath))) {
        return { backend: 'hermes', sessions: [], totalSessions: 0, warnings: ['Hermes state.db not found'] };
      }

      try {
        const rows = await runSqliteJson<HermesSessionRow>(
          sourcePath,
          `select s.id,
                    s.source,
                    s.title,
                    s.model_config,
                    s.started_at,
                    max(m.timestamp) as last_message_at,
                    count(m.id) as actual_message_count
             from sessions s
             left join messages m on m.session_id = s.id
             where coalesce(s.is_user_visible, 1) = 1
             group by s.id
             order by coalesce(max(m.timestamp), s.started_at, 0) desc
             limit ${Math.min(Math.max(options?.limit ?? 50, 200), 500)}`
        );

        const sessionIds = new Set(options?.sessionIds || []);
        const filteredRows = sessionIds.size ? rows.filter((row) => sessionIds.has(row.id)) : rows;
        const sessions: CliHistorySession[] = [];
        const limit = options?.limit ?? 50;
        for (const row of filteredRows) {
          if (!sessionIds.size && sessions.length >= limit) break;
          const messages = await readHermesMessages(sourcePath, row.id);
          if (messages.length === 0) continue;
          const createdAt = normalizeTimestamp(row.started_at, messages[0]?.timestamp ?? Date.now());
          const updatedAt = normalizeTimestamp(row.last_message_at ?? row.started_at, createdAt);
          sessions.push({
            backend: 'hermes',
            sourceKind: 'hermes-state-db',
            sourceSessionId: row.id,
            title: normalizeTitle(row.title || undefined, `Hermes ${row.id}`),
            workspace: workspaceFromModelConfig(row.model_config),
            sourcePath,
            createdAt,
            updatedAt,
            messageCount: messages.length,
            messages,
            warnings: [] as string[],
            ...makeReadOnlyResume(),
          });
        }

        const totalRow = await runSqliteJson<{ total: number }>(sourcePath, 'select count(*) as total from sessions');
        return {
          backend: 'hermes',
          sessions,
          totalSessions: totalRow[0]?.total ?? 0,
          totalMessages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
          warnings,
        };
      } catch (error) {
        return {
          backend: 'hermes',
          sessions: [],
          totalSessions: 0,
          warnings: [`Failed to read Hermes state.db: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    },
  };
}
