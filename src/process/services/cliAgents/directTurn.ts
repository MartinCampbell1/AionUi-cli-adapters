import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { ipcBridge } from '@/common';
import { transformMessage } from '@/common/chat/chatLib';
import { uuid } from '@/common/utils';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { AcpBackend } from '@/common/types/acpTypes';
import { addOrUpdateMessage } from '@process/utils/message';
import { prepareCleanEnv } from '@process/agent/acp/acpConnectors';

const execFile = promisify(execFileCb);

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

function buildPrompt(input: string, files?: string[]): string {
  const cleanFiles = (files ?? []).filter(Boolean);
  if (cleanFiles.length === 0) return input;
  return `${input}\n\nAttached files:\n${cleanFiles.map((file) => `- ${file}`).join('\n')}`;
}

function getCommandSpec(backend: DirectCliBackend, prompt: string): CommandSpec {
  switch (backend) {
    case 'claude':
      return {
        command: 'claude',
        args: ['-p', prompt, '--dangerously-skip-permissions'],
        timeoutMs: 60_000,
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
      'Claude Code CLI did not return within 60 seconds.',
      'This usually means the local Claude CLI is waiting on an expired or invalid login.',
      'Run `claude auth login`, then verify with `claude -p "hello" --dangerously-skip-permissions`.',
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
  return Math.min(spec.timeoutMs, 60_000);
}

function cleanCliOutput(backend: DirectCliBackend, stdout: string): string {
  const text = stdout.trim();
  if (backend !== 'gemini') return text;

  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed &&
        !trimmed.startsWith('MCP issues detected.') &&
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
  const spec = getCommandSpec(options.backend, 'Reply with exactly: AionUi health ok');
  const env = await prepareCleanEnv();

  try {
    const { stdout } = await execFile(spec.command, spec.args, {
      cwd: options.cwd,
      env,
      timeout: getHealthTimeoutMs(options.backend, spec),
      signal: options.signal,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
    });
    const content = cleanCliOutput(options.backend, stdout);
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
  const spec = getCommandSpec(options.backend, prompt);
  const env = await prepareCleanEnv();

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
    const { stdout } = await execFile(spec.command, spec.args, {
      cwd: options.cwd,
      env,
      timeout: spec.timeoutMs,
      signal: options.signal,
      killSignal: 'SIGTERM',
      maxBuffer: 16 * 1024 * 1024,
    });
    const content = cleanCliOutput(options.backend, stdout);
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
