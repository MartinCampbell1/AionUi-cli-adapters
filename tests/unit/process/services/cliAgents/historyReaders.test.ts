/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeHistoryReader } from '@/process/services/cliAgents/adapters/claudeHistory';
import { createCodexHistoryReader } from '@/process/services/cliAgents/adapters/codexHistory';
import { createHermesHistoryReader } from '@/process/services/cliAgents/adapters/hermesHistory';
import { createOpenCodeHistoryReader } from '@/process/services/cliAgents/adapters/opencodeHistory';

const tempRoots: string[] = [];

async function makeTempHome(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aionui-cli-agent-test-'));
  tempRoots.push(root);
  return root;
}

function writeSqliteDb(databasePath: string, sql: string): void {
  execFileSync('/usr/bin/sqlite3', [databasePath, sql]);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe('cli agent history readers', () => {
  it('reads Codex JSONL messages and skips context-only rows', async () => {
    const home = await makeTempHome();
    const dir = path.join(home, '.codex', 'sessions', '2026', '01', '01');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'rollout-2026-01-01T00-00-00-session-1.jsonl');
    const rows = [
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'session-1', cwd: '/tmp/project' },
      },
      {
        timestamp: '2026-01-01T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }],
        },
      },
      {
        timestamp: '2026-01-01T00:00:02.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello codex' }] },
      },
      {
        timestamp: '2026-01-01T00:00:03.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello back' }] },
      },
    ];
    await fs.promises.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const result = await createCodexHistoryReader(home).listSessions({ limit: 10 });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sourceSessionId).toBe('session-1');
    expect(result.sessions[0].workspace).toBe('/tmp/project');
    expect(result.sessions[0].messages.map((message) => message.text)).toEqual(['hello codex', 'hello back']);
  });

  it('reads Claude JSONL user and assistant messages', async () => {
    const home = await makeTempHome();
    const dir = path.join(home, '.claude', 'projects', '-tmp-project');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'claude-session.jsonl');
    const rows = [
      {
        type: 'user',
        sessionId: 'claude-session',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:02.000Z',
        cwd: '/tmp/project',
        message: { role: 'user', content: 'hello claude' },
      },
      {
        type: 'assistant',
        sessionId: 'claude-session',
        uuid: 'a1',
        timestamp: '2026-01-01T00:00:03.000Z',
        cwd: '/tmp/project',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello human' }] },
      },
    ];
    await fs.promises.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const result = await createClaudeHistoryReader(home).listSessions({ limit: 10 });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sourceSessionId).toBe('claude-session');
    expect(result.sessions[0].messages.map((message) => message.text)).toEqual(['hello claude', 'hello human']);
  });

  it('reads Hermes state.db sessions and hides system/tool messages', async () => {
    const home = await makeTempHome();
    const db = path.join(home, '.hermes', 'state.db');
    await fs.promises.mkdir(path.dirname(db), { recursive: true });
    writeSqliteDb(
      db,
      `
      create table sessions (
        id text primary key,
        source text,
        title text,
        model_config text,
        started_at integer,
        is_user_visible integer
      );
      create table messages (
        id integer primary key,
        session_id text,
        role text,
        content text,
        timestamp integer
      );
      insert into sessions values (
        'hermes-session',
        'cli',
        'Hermes fixture',
        '{"cwd":"/tmp/hermes-project"}',
        1770000000000,
        1
      );
      insert into messages values (1, 'hermes-session', 'system', 'hidden system note', 1770000000001);
      insert into messages values (2, 'hermes-session', 'user', 'hello hermes', 1770000000002);
      insert into messages values (3, 'hermes-session', 'assistant', 'hello back from hermes', 1770000000003);
      insert into messages values (4, 'hermes-session', 'tool', 'hidden tool output', 1770000000004);
      `
    );

    const result = await createHermesHistoryReader(home).listSessions({ limit: 10 });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sourceSessionId).toBe('hermes-session');
    expect(result.sessions[0].workspace).toBe('/tmp/hermes-project');
    expect(result.sessions[0].messages.map((message) => message.text)).toEqual([
      'hidden system note',
      'hello hermes',
      'hello back from hermes',
      'hidden tool output',
    ]);
    expect(result.sessions[0].messages.filter((message) => message.hidden).map((message) => message.role)).toEqual([
      'system',
      'tool',
    ]);
  });

  it('reads OpenCode SQLite sessions, messages, and text parts', async () => {
    const home = await makeTempHome();
    const db = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
    await fs.promises.mkdir(path.dirname(db), { recursive: true });
    writeSqliteDb(
      db,
      `
      create table session (
        id text primary key,
        title text,
        slug text,
        directory text,
        time_created integer,
        time_updated integer
      );
      create table message (
        id text primary key,
        session_id text,
        data text,
        time_created integer
      );
      create table part (
        id text primary key,
        message_id text,
        data text,
        time_created integer
      );
      insert into session values (
        'opencode-session',
        'OpenCode fixture',
        'opencode-fixture',
        '/tmp/opencode-project',
        1770000001000,
        1770000002000
      );
      insert into message values ('m-user', 'opencode-session', '{"role":"user"}', 1770000001001);
      insert into message values ('m-assistant', 'opencode-session', '{"role":"assistant"}', 1770000001002);
      insert into part values ('p-user', 'm-user', '{"type":"text","text":"hello opencode"}', 1770000001001);
      insert into part values ('p-synthetic', 'm-user', '{"type":"text","text":"skip me","synthetic":true}', 1770000001001);
      insert into part values ('p-tool', 'm-assistant', '{"type":"tool","text":"skip tool"}', 1770000001002);
      insert into part values ('p-assistant', 'm-assistant', '{"type":"text","text":"hello back from opencode"}', 1770000001003);
      `
    );

    const result = await createOpenCodeHistoryReader(home).listSessions({ limit: 10 });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sourceSessionId).toBe('opencode-session');
    expect(result.sessions[0].workspace).toBe('/tmp/opencode-project');
    expect(result.sessions[0].messages.map((message) => message.text)).toEqual([
      'hello opencode',
      'hello back from opencode',
    ]);
  });
});
