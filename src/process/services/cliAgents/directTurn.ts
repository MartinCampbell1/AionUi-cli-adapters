import { spawn, type StdioOptions } from 'child_process';
import { closeSync, openSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ipcBridge } from '@/common';
import { transformMessage } from '@/common/chat/chatLib';
import { uuid } from '@/common/utils';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { AcpBackend } from '@/common/types/acpTypes';
import { addOrUpdateMessage } from '@process/utils/message';
import { prepareCleanEnv } from '@process/agent/acp/acpConnectors';

export type DirectCliBackend = Extract<AcpBackend, 'claude' | 'droid' | 'hermes'> | 'gemini';

const DIRECT_CLI_TURN_BACKENDS = new Set<AcpBackend | 'gemini'>(['claude', 'droid', 'hermes', 'gemini']);

export function isDirectCliTurnBackend(backend: string | undefined): backend is DirectCliBackend {
  return Boolean(backend && DIRECT_CLI_TURN_BACKENDS.has(backend as AcpBackend | 'gemini'));
}

type DirectTurnOptions = {
  backend: DirectCliBackend;
  conversationId: string;
  input: string;
  msgId?: string;
  cwd?: string;
  files?: string[];
  signal?: AbortSignal;
};

type DirectHealthOptions = {
  backend: DirectCliBackend;
  cwd?: string;
  signal?: AbortSignal;
};

export type DirectCliHealthResult = {
  available: boolean;
  latency: number;
  error?: string;
  authRequired?: boolean;
};

type CommandSpec = {
  command: string;
  args: string[];
  timeoutMs: number;
};

type DirectCommandResult = {
  stdout: string;
  stderr: string;
};

type DirectCommandError = Error & {
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  code?: number | null;
  signal?: NodeJS.Signals | null;
};

const CLAUDE_EMPTY_MCP_CONFIG = JSON.stringify({ mcpServers: {} });

function buildPrompt(input: string, files?: string[]): string {
  const cleanFiles = (files ?? []).filter(Boolean);
  if (cleanFiles.length === 0) return input;
  return `${input}\n\nAttached files:\n${cleanFiles.map((file) => `- ${file}`).join('\n')}`;
}

export function getDirectCliCommandSpec(backend: DirectCliBackend, prompt: string): CommandSpec {
  switch (backend) {
    case 'claude':
      return {
        command: 'claude',
        args: [
          '-p',
          prompt,
          '--setting-sources',
          'project,local',
          '--dangerously-skip-permissions',
          '--output-format',
          'text',
          '--no-session-persistence',
          '--no-chrome',
          '--disable-slash-commands',
          '--strict-mcp-config',
          '--mcp-config',
          CLAUDE_EMPTY_MCP_CONFIG,
        ],
        timeoutMs: 300_000,
      };
    case 'gemini':
      return {
        command: 'gemini',
        args: ['-p', prompt, '--output-format', 'text'],
        timeoutMs: 300_000,
      };
    case 'hermes':
      return {
        command: 'hermes',
        args: ['-z', prompt],
        timeoutMs: 300_000,
      };
    case 'droid':
      return {
        command: 'droid',
        args: ['exec', '--output-format', 'text', prompt],
        timeoutMs: 300_000,
      };
  }
}

async function prepareDirectCliEnv(backend: DirectCliBackend): Promise<Record<string, string | undefined>> {
  const env = await prepareCleanEnv();

  if (backend === 'claude') {
    // Claude Code should use its own CLI login store here. API model settings
    // from AionUi can otherwise force Anthropic Console mode and break OAuth.
    for (const key of Object.keys(env)) {
      if (key.startsWith('ANTHROPIC_') || key === 'CLAUDE_CODE_USE_BEDROCK' || key === 'CLAUDE_CODE_USE_VERTEX') {
        delete env[key];
      }
    }
  }

  return env;
}

function isLikelyAuthFailure(text: string): boolean {
  return /auth|login|credential|api key|unauthorized|forbidden|invalid authentication|factory_api_key|401|403/i.test(
    text
  );
}

function formatCliError(
  backend: DirectCliBackend,
  error: Error & { stdout?: string; stderr?: string; killed?: boolean }
): string {
  const parts = [error.message, error.stdout, error.stderr]
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n')
    .trim();

  if (backend === 'claude' && error.killed) {
    return [
      "Claude Code CLI did not return before AionUi's CLI timeout.",
      'This usually means the local Claude CLI is waiting on an expired login, an invalid credential, or a local bootstrap prompt.',
      'Run `claude auth login --claudeai`, then verify with `claude -p "hello" --setting-sources project,local --dangerously-skip-permissions --output-format text --no-session-persistence --no-chrome --disable-slash-commands --strict-mcp-config --mcp-config \'{"mcpServers":{}}\'`.',
      parts,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (backend === 'claude' && isLikelyAuthFailure(parts)) {
    return [
      'Claude Code CLI is installed, but non-interactive chat authentication failed.',
      'AionUi launches Claude through `claude -p` and reuses the same local Claude Code CLI login.',
      '`claude auth status` can be stale; refresh the CLI login with `claude auth login --claudeai`.',
      'Verify in Terminal with `claude -p "hello" --setting-sources project,local --dangerously-skip-permissions --output-format text --no-session-persistence --no-chrome --disable-slash-commands --strict-mcp-config --mcp-config \'{"mcpServers":{}}\'`.',
      parts,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (backend === 'droid' && isLikelyAuthFailure(parts)) {
    return [
      'Factory Droid CLI is installed, but its local authentication is not ready.',
      'AionUi launches Droid through `droid exec --output-format text PROMPT` and reuses the same local CLI auth.',
      'Run `droid` and finish `/login`, or export a valid `FACTORY_API_KEY`, then verify with `droid exec "hello"`.',
      parts,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return parts || String(error);
}

function getHealthTimeoutMs(backend: DirectCliBackend, spec: CommandSpec): number {
  if (backend === 'claude') return Math.min(spec.timeoutMs, 25_000);
  return Math.min(spec.timeoutMs, 120_000);
}

async function runCliCommand(
  spec: CommandSpec,
  options: {
    cwd?: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
    signal?: AbortSignal;
    maxBuffer: number;
  }
): Promise<DirectCommandResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-cli-'));
  const stdoutPath = path.join(tempDir, 'stdout.txt');
  const stderrPath = path.join(tempDir, 'stderr.txt');
  const isPosix = process.platform !== 'win32';
  const stdoutFd = isPosix ? null : openSync(stdoutPath, 'w');
  const stderrFd = isPosix ? null : openSync(stderrPath, 'w');
  let closedFiles = false;

  const closeOutputFiles = () => {
    if (closedFiles) return;
    closedFiles = true;
    if (stdoutFd !== null) closeSync(stdoutFd);
    if (stderrFd !== null) closeSync(stderrFd);
  };

  const readOutputs = async (): Promise<DirectCommandResult> => {
    const [stdout, stderr] = await Promise.all([
      readFile(stdoutPath, 'utf8').catch(() => ''),
      readFile(stderrPath, 'utf8').catch(() => ''),
    ]);
    return { stdout, stderr };
  };

  try {
    return await new Promise((resolve, reject) => {
      const spawnEnv = { ...options.env };
      let spawnCommand = spec.command;
      let spawnArgs = spec.args;
      let stdio: StdioOptions = ['ignore', stdoutFd ?? 'ignore', stderrFd ?? 'ignore'];

      if (options.cwd && process.platform !== 'win32') {
        spawnEnv.PWD = options.cwd;
      }

      if (isPosix) {
        spawnEnv.AIONUI_CLI_STDOUT = stdoutPath;
        spawnEnv.AIONUI_CLI_STDERR = stderrPath;
        spawnCommand = '/bin/sh';
        spawnArgs = [
          '-c',
          'exec "$@" >"$AIONUI_CLI_STDOUT" 2>"$AIONUI_CLI_STDERR"',
          'aionui-cli',
          spec.command,
          ...spec.args,
        ];
        stdio = 'ignore';
      }

      const child = spawn(spawnCommand, spawnArgs, {
        cwd: options.cwd,
        env: spawnEnv,
        stdio,
      });

      let timedOut = false;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };

      const finishReject = async (error: DirectCommandError) => {
        if (settled) return;
        settled = true;
        cleanup();
        closeOutputFiles();
        const { stdout, stderr } = await readOutputs();
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      };

      const onAbort = () => {
        child.kill('SIGTERM');
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);

      if (options.signal?.aborted) {
        child.kill('SIGTERM');
      } else {
        options.signal?.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (error) => {
        void finishReject(error as DirectCommandError);
      });

      child.on('close', (code, signal) => {
        cleanup();
        if (settled) return;
        closeOutputFiles();

        void readOutputs().then(({ stdout, stderr }) => {
          const overflow = stdout.length + stderr.length > options.maxBuffer;

          if (code === 0 && !timedOut && !overflow && !options.signal?.aborted) {
            settled = true;
            resolve({ stdout, stderr });
            return;
          }

          const error = new Error(`Command failed: ${spec.command} ${spec.args.join(' ')}`) as DirectCommandError;
          error.code = code;
          error.signal = signal;
          error.killed = timedOut || overflow || Boolean(options.signal?.aborted);
          error.stdout = stdout;
          error.stderr = stderr;
          if (timedOut) error.message = `Command timed out: ${spec.command} ${spec.args.join(' ')}`;
          if (overflow) error.message = `${spec.command} output exceeded ${options.maxBuffer} bytes`;
          settled = true;
          reject(error);
        }, reject);
      });
    });
  } finally {
    closeOutputFiles();
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function cleanDirectCliOutput(backend: DirectCliBackend, stdout: string): string {
  const text = stdout.trim();
  if (backend !== 'gemini') return text;

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

function emitAndPersist(message: IResponseMessage): void {
  const transformed = transformMessage(message);
  if (transformed) {
    addOrUpdateMessage(message.conversation_id, transformed);
  }
  ipcBridge.conversation.responseStream.emit(message);
}

function emitOnly(message: IResponseMessage): void {
  ipcBridge.conversation.responseStream.emit(message);
}

export async function probeDirectCliTurnHealth(options: DirectHealthOptions): Promise<DirectCliHealthResult> {
  const start = Date.now();
  const spec = getDirectCliCommandSpec(options.backend, 'Reply with exactly: AionUi health ok');
  const env = await prepareDirectCliEnv(options.backend);

  try {
    const { stdout } = await runCliCommand(spec, {
      cwd: options.cwd,
      env,
      signal: options.signal,
      timeoutMs: getHealthTimeoutMs(options.backend, spec),
      maxBuffer: 4 * 1024 * 1024,
    });
    const content = cleanDirectCliOutput(options.backend, stdout);
    const latency = Date.now() - start;

    if (!content) {
      return {
        available: false,
        latency,
        error: `${options.backend} CLI returned no text output`,
        authRequired: false,
      };
    }

    return { available: true, latency };
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string; killed?: boolean };
    const detail = formatCliError(options.backend, maybeError);
    return {
      available: false,
      latency: Date.now() - start,
      error: detail || String(error),
      authRequired: isLikelyAuthFailure(detail) || (options.backend === 'claude' && Boolean(maybeError.killed)),
    };
  }
}

export async function runDirectCliTurn(options: DirectTurnOptions): Promise<void> {
  const msgId = options.msgId || uuid();
  const prompt = buildPrompt(options.input, options.files);
  const spec = getDirectCliCommandSpec(options.backend, prompt);
  const env = await prepareDirectCliEnv(options.backend);

  emitOnly({
    type: 'request_trace',
    conversation_id: options.conversationId,
    msg_id: msgId,
    data: {
      backend: options.backend,
      provider: 'local-cli',
      modelId: spec.command,
      timestamp: Date.now(),
    },
  });
  emitOnly({ type: 'start', conversation_id: options.conversationId, msg_id: msgId, data: null });

  try {
    const { stdout } = await runCliCommand(spec, {
      cwd: options.cwd,
      env,
      signal: options.signal,
      timeoutMs: spec.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    const content = cleanDirectCliOutput(options.backend, stdout);
    if (!content) {
      throw new Error(`${options.backend} CLI returned no text output`);
    }

    emitAndPersist({
      type: 'content',
      conversation_id: options.conversationId,
      msg_id: uuid(),
      data: content,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }

    const maybeError = error as Error & { stdout?: string; stderr?: string; killed?: boolean };
    const detail = formatCliError(options.backend, maybeError);
    emitAndPersist({
      type: 'error',
      conversation_id: options.conversationId,
      msg_id: uuid(),
      data: detail || String(error),
    });
    throw error;
  } finally {
    emitOnly({ type: 'finish', conversation_id: options.conversationId, msg_id: uuid(), data: null });
  }
}
