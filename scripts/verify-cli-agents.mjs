#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const includeSlow = args.has('--include-slow');

const HOME = os.homedir();
const MAX_HISTORY_FILES = 20_000;

const agents = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    versionArgs: ['--version'],
    statusArgs: ['auth', 'status'],
    chatArgs: [
      '-p',
      'Reply with exactly: claude adapter ok',
      '--dangerously-skip-permissions',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
    ],
    timeoutMs: 25_000,
    env: (env) => {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_BASE_URL;
      return env;
    },
    history: [{ label: 'Claude projects JSONL', dir: path.join(HOME, '.claude', 'projects'), ext: '.jsonl' }],
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    versionArgs: ['--version'],
    chatSkipped: 'ACP-backed in AionUi; use packaged UI smoke for end-to-end chat.',
    history: [{ label: 'Codex sessions JSONL', dir: path.join(HOME, '.codex', 'sessions'), ext: '.jsonl' }],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    versionArgs: ['--version'],
    chatArgs: ['-p', 'Reply with exactly: gemini adapter ok', '--output-format', 'text'],
    timeoutMs: 60_000,
    clean: cleanGeminiOutput,
    historyNote: 'Gemini CLI does not expose a stable local chat-history store used by this adapter.',
  },
  {
    id: 'hermes',
    label: 'Hermes Agent',
    command: 'hermes',
    versionArgs: ['--version'],
    chatArgs: ['-z', 'Reply with exactly: hermes adapter ok'],
    timeoutMs: 60_000,
    history: [{ label: 'Hermes state DB', file: path.join(HOME, '.hermes', 'state.db') }],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    versionArgs: ['--version'],
    statusArgs: ['auth', 'list'],
    chatSkipped: 'ACP-backed in AionUi; use packaged UI smoke for end-to-end chat.',
    history: [{ label: 'OpenCode SQLite DB', file: path.join(HOME, '.local', 'share', 'opencode', 'opencode.db') }],
  },
  {
    id: 'droid',
    label: 'Factory Droid',
    command: 'droid',
    versionArgs: ['--version'],
    chatArgs: ['exec', '--output-format', 'text', 'Reply with exactly: droid adapter ok'],
    timeoutMs: 25_000,
    historyNote: 'Droid history import is not enabled until a stable local transcript store is identified.',
  },
];

function cloneEnv(agent) {
  const env = { ...process.env };
  return agent.env ? agent.env(env) : env;
}

function run(command, cmdArgs, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, cmdArgs, {
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - started;
  const stdout = sanitize(result.stdout ?? '');
  const stderr = sanitize(result.stderr ?? '');
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    signal: result.signal,
    error: result.error,
    elapsedMs,
    output,
  };
}

function commandPath(command) {
  const result = spawnSync('/bin/zsh', ['-lc', `command -v ${command}`], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function sanitize(text) {
  return text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[redacted]')
    .replace(/sk-clb-[A-Za-z0-9_-]{12,}/g, 'sk-clb-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [redacted]')
    .replace(/("access_token"\s*:\s*")[^"]+/gi, '$1[redacted]')
    .replace(/("refresh_token"\s*:\s*")[^"]+/gi, '$1[redacted]')
    .trim();
}

function cleanGeminiOutput(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^MCP issues detected\. Run \/mcp list for status\. ?/, ''))
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed &&
        !trimmed.startsWith('Created execution plan for SessionEnd:') &&
        !trimmed.startsWith('Expanding hook command:') &&
        !trimmed.startsWith('Hook execution for SessionEnd:')
      );
    })
    .join('\n')
    .trim();
}

function countFiles(root, ext) {
  if (!fs.existsSync(root)) return { exists: false, count: 0, truncated: false };

  let count = 0;
  let truncated = false;
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        count += 1;
        if (count >= MAX_HISTORY_FILES) {
          truncated = true;
          stack.length = 0;
          break;
        }
      }
    }
  }

  return { exists: true, count, truncated };
}

function describeHistory(agent) {
  const rows = [];
  for (const item of agent.history ?? []) {
    if (item.file) {
      if (!fs.existsSync(item.file)) {
        rows.push(`${item.label}: missing (${item.file})`);
        continue;
      }
      const stat = fs.statSync(item.file);
      rows.push(`${item.label}: present (${item.file}, ${Math.round(stat.size / 1024)} KiB)`);
      continue;
    }

    const counted = countFiles(item.dir, item.ext);
    if (!counted.exists) {
      rows.push(`${item.label}: missing (${item.dir})`);
    } else {
      rows.push(`${item.label}: ${counted.count}${counted.truncated ? '+' : ''} ${item.ext} files (${item.dir})`);
    }
  }

  if (agent.historyNote) rows.push(agent.historyNote);
  return rows;
}

function classifyChat(agent, result, cleanedOutput) {
  if (result.ok && cleanedOutput.toLowerCase().includes(`${agent.id} adapter ok`)) return 'ready';
  if (
    /auth|login|credential|api key|unauthorized|forbidden|invalid authentication|factory_api_key|401|403/i.test(
      result.output
    )
  ) {
    return 'blocked-auth';
  }
  if (result.error?.code === 'ETIMEDOUT' || result.signal) return 'timeout';
  if (result.ok) return 'unexpected-output';
  return 'failed';
}

const summaries = [];

console.log('AionUi CLI agent verification');
console.log(`strict=${strict ? 'yes' : 'no'} includeSlow=${includeSlow ? 'yes' : 'no'}`);
console.log('');

for (const agent of agents) {
  const binary = commandPath(agent.command);
  const summary = { id: agent.id, installed: Boolean(binary), chat: 'not-run' };
  summaries.push(summary);

  console.log(`${agent.label} (${agent.id})`);
  if (!binary) {
    summary.chat = 'missing';
    console.log(`  binary: missing (${agent.command})`);
    console.log('');
    continue;
  }

  console.log(`  binary: ${binary}`);

  if (agent.versionArgs) {
    const version = run(agent.command, agent.versionArgs, { env: cloneEnv(agent), timeoutMs: 8_000 });
    console.log(
      `  version: ${version.ok ? summarizeOutput(version.output) : `failed: ${summarizeOutput(version.output)}`}`
    );
  }

  if (agent.statusArgs) {
    const status = run(agent.command, agent.statusArgs, { env: cloneEnv(agent), timeoutMs: 12_000 });
    console.log(
      `  status: ${status.ok ? summarizeOutput(status.output) : `failed: ${summarizeOutput(status.output)}`}`
    );
  }

  for (const historyLine of describeHistory(agent)) {
    console.log(`  history: ${historyLine}`);
  }

  if (agent.chatSkipped) {
    summary.chat = 'skipped';
    console.log(`  chat: skipped - ${agent.chatSkipped}`);
    console.log('');
    continue;
  }

  if (!agent.chatArgs) {
    summary.chat = 'not-supported';
    console.log('  chat: not supported by this verifier');
    console.log('');
    continue;
  }

  if (!includeSlow && agent.timeoutMs > 30_000) {
    summary.chat = 'skipped-slow';
    console.log('  chat: skipped by default because this probe can be slow; pass --include-slow to run it.');
    console.log('');
    continue;
  }

  const chat = run(agent.command, agent.chatArgs, { env: cloneEnv(agent), timeoutMs: agent.timeoutMs });
  const cleanedOutput = agent.clean ? agent.clean(chat.output) : chat.output;
  const chatState = classifyChat(agent, chat, cleanedOutput);
  summary.chat = chatState;
  console.log(`  chat: ${chatState} (${chat.elapsedMs}ms)`);
  if (cleanedOutput) console.log(`  output: ${summarizeOutput(cleanedOutput, agent)}`);
  console.log('');
}

const counts = summaries.reduce((acc, item) => {
  acc[item.chat] = (acc[item.chat] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `Summary: ${Object.entries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')}`
);

if (
  strict &&
  summaries.some((item) => ['missing', 'blocked-auth', 'timeout', 'failed', 'unexpected-output'].includes(item.chat))
) {
  process.exit(1);
}

function summarizeOutput(text, agent) {
  const trimmed = text.trim();
  if (!trimmed) return '(no output)';

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const usefulKeys = ['loggedIn', 'authMethod', 'apiProvider', 'subscriptionType'];
      const summary = usefulKeys
        .filter((key) => Object.prototype.hasOwnProperty.call(parsed, key))
        .map((key) => `${key}=${parsed[key]}`)
        .join(', ');
      if (summary) return summary;
    }
  } catch {
    // Non-JSON command output is expected for most CLIs.
  }

  if (agent?.id) {
    const expected = `${agent.id} adapter ok`;
    const matching = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().includes(expected));
    if (matching) return trimLine(matching);
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((item) => !item.startsWith('###')) ?? lines[0];
  return trimLine(line);
}

function trimLine(line) {
  if (!line) return '(no output)';
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}
