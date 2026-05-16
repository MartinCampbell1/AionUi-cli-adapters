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
import { fileExists, isRecord, readJsonObject, textFromUnknown, truncateMessage } from './utils';
import { runSqliteJson, sqlString } from './sqliteCli';

const DEFAULT_SOURCE = '~/.local/share/opencode/opencode.db';

type OpenCodeSessionRow = {
  id: string;
  title?: string | null;
  slug?: string | null;
  directory?: string | null;
  time_created?: number | null;
  time_updated?: number | null;
  message_count?: number;
};

type OpenCodeMessageRow = {
  id: string;
  role?: string;
  time_created?: number | null;
};

type OpenCodePartRow = {
  data?: string | null;
};

async function readOpenCodeMessages(sourcePath: string, sessionId: string): Promise<CliHistoryMessage[]> {
  const rows = await runSqliteJson<OpenCodeMessageRow>(
    sourcePath,
    `select id,
              json_extract(data, '$.role') as role,
              time_created
       from message
       where session_id = ${sqlString(sessionId)}
       order by time_created asc, id asc`
  );

  const messages: CliHistoryMessage[] = [];
  for (const row of rows) {
    const role = row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : undefined;
    if (!role) continue;
    const parts = await runSqliteJson<OpenCodePartRow>(
      sourcePath,
      `select data
         from part
         where message_id = ${sqlString(row.id)}
         order by time_created asc, id asc`
    );
    const textParts = parts
      .map((part) => {
        const data = part.data ? readJsonObject(part.data) : null;
        if (!data || data.synthetic === true) return undefined;
        if (data.type !== 'text') return undefined;
        return textFromUnknown(data.text);
      })
      .filter((item): item is string => Boolean(item?.trim()));
    if (textParts.length === 0) continue;
    messages.push({
      id: row.id,
      role,
      text: truncateMessage(textParts.join('\n')),
      timestamp: normalizeTimestamp(row.time_created),
    });
  }
  return messages;
}

export function createOpenCodeHistoryReader(homeDir = os.homedir()): CliHistoryReader {
  const sourcePath = expandHomePath(DEFAULT_SOURCE, homeDir);
  return {
    backend: 'opencode',
    sourceLabel: 'OpenCode SQLite',
    sourcePath,
    async listSessions(options): Promise<CliHistoryReaderResult> {
      if (!(await fileExists(sourcePath))) {
        return { backend: 'opencode', sessions: [], totalSessions: 0, warnings: ['OpenCode database not found'] };
      }

      try {
        const sessionIds = new Set(options?.sessionIds || []);
        const rows = await runSqliteJson<OpenCodeSessionRow>(
          sourcePath,
          `select s.id,
                    s.title,
                    s.slug,
                    s.directory,
                    s.time_created,
                    s.time_updated,
                    count(m.id) as message_count
             from session s
             left join message m on m.session_id = s.id
             group by s.id
             order by coalesce(s.time_updated, s.time_created, 0) desc
             limit ${Math.min(Math.max(options?.limit ?? 50, 200), 500)}`
        );
        const filteredRows = sessionIds.size ? rows.filter((row) => sessionIds.has(row.id)) : rows;

        const sessions: CliHistorySession[] = [];
        const limit = options?.limit ?? 50;
        for (const row of filteredRows) {
          if (!sessionIds.size && sessions.length >= limit) break;
          const messages = await readOpenCodeMessages(sourcePath, row.id);
          if (messages.length === 0) continue;
          const createdAt = normalizeTimestamp(row.time_created, messages[0]?.timestamp ?? Date.now());
          const updatedAt = normalizeTimestamp(row.time_updated, messages[messages.length - 1]?.timestamp ?? createdAt);
          sessions.push({
            backend: 'opencode',
            sourceKind: 'opencode-db',
            sourceSessionId: row.id,
            title: normalizeTitle(row.title || row.slug || undefined, `OpenCode ${row.id}`),
            workspace: row.directory || undefined,
            sourcePath,
            createdAt,
            updatedAt,
            messageCount: messages.length,
            messages,
            warnings: [] as string[],
            ...makeReadOnlyResume(),
          });
        }

        const totalRow = await runSqliteJson<{ total: number }>(sourcePath, 'select count(*) as total from session');
        return {
          backend: 'opencode',
          sessions,
          totalSessions: totalRow[0]?.total ?? 0,
          totalMessages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
          warnings: [],
        };
      } catch (error) {
        return {
          backend: 'opencode',
          sessions: [],
          totalSessions: 0,
          warnings: [`Failed to read OpenCode database: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    },
  };
}
