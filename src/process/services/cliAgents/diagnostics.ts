/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'child_process';
import type {
  CliAgentAuthState,
  CliAgentBackend,
  CliAgentHistorySummary,
  CliAgentRemediation,
  CliAgentRuntimeStatus,
} from '@/common/types/cliAgent';
import { getCliAgentDescriptor } from './registry';
import { getHistorySummary } from './historyReaders';

export interface CliCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorCode?: string;
}

export interface CliDetectedAgentInfo {
  backend: string;
  name: string;
  cliPath?: string;
  acpArgs?: string[];
}

export type CliCommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<CliCommandResult>;

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_CAPTURE_BYTES = 20_000;

export const defaultCliCommandRunner: CliCommandRunner = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: MAX_CAPTURE_BYTES }, (error, stdout, stderr) => {
      const maybeError = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      resolve({
        exitCode: typeof maybeError?.code === 'number' ? maybeError.code : maybeError ? null : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        timedOut: Boolean(maybeError?.killed),
        errorCode: typeof maybeError?.code === 'string' ? maybeError.code : undefined,
      });
    });
  });

function firstLine(text: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return line;
}

function compactOutput(result: CliCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function matchesAny(text: string, patterns: string[]): boolean {
  const normalized = text.toLowerCase();
  const compact = normalized.replace(/\s+/g, '');
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase();
    return normalized.includes(normalizedPattern) || compact.includes(normalizedPattern.replace(/\s+/g, ''));
  });
}

function parseBooleanAuthFlag(output: string): CliAgentAuthState | undefined {
  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const flags = [parsed.loggedIn, parsed.loggedin, parsed.authenticated, parsed.logged_in];
    if (flags.some((flag) => flag === true)) return 'authenticated';
    if (flags.some((flag) => flag === false)) return 'not-authenticated';
  } catch {
    return undefined;
  }

  return undefined;
}

function parseAuthState(backend: CliAgentBackend, output: string): CliAgentAuthState {
  const descriptor = getCliAgentDescriptor(backend);
  if (!descriptor.authProbe) return 'unknown';
  const booleanAuthFlag = parseBooleanAuthFlag(output);
  if (booleanAuthFlag) return booleanAuthFlag;
  if (matchesAny(output, descriptor.authProbe.unauthenticatedPatterns)) return 'not-authenticated';
  if (matchesAny(output, descriptor.authProbe.authenticatedPatterns)) return 'authenticated';
  return 'unknown';
}

function getRemediation(
  backend: CliAgentBackend,
  state: CliAgentRuntimeStatus['runtimeState']
): CliAgentRemediation | undefined {
  if (state === 'ready') return undefined;
  return getCliAgentDescriptor(backend).remediation;
}

export async function probeCliAgentStatus(
  backend: CliAgentBackend,
  detectedAgent?: CliDetectedAgentInfo,
  runner: CliCommandRunner = defaultCliCommandRunner,
  historySummary?: CliAgentHistorySummary
): Promise<CliAgentRuntimeStatus> {
  const descriptor = getCliAgentDescriptor(backend);
  const command = detectedAgent?.cliPath || descriptor.command;
  const warnings: string[] = [];
  const history = historySummary ?? (await getHistorySummary(backend));
  const probeTimeoutMs = descriptor.probeTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  const versionResult = await runner(command, descriptor.versionArgs, probeTimeoutMs);
  const versionOutput = compactOutput(versionResult);
  const version = firstLine(versionOutput);

  if (versionResult.errorCode === 'ENOENT') {
    const runtimeState = 'unavailable';
    return {
      backend,
      name: descriptor.name,
      installed: false,
      cliPath: detectedAgent?.cliPath,
      acpArgs: detectedAgent?.acpArgs,
      authState: 'unknown',
      runtimeState,
      message: `${descriptor.name} CLI not found`,
      warnings: [...warnings, ...history.warnings],
      remediation: getRemediation(backend, runtimeState),
      history,
    };
  }

  if (versionResult.timedOut) {
    warnings.push(`${descriptor.name} version probe timed out`);
  }

  if (backend === 'droid') {
    const runtimeState = 'login-required';
    warnings.push('Factory Droid auth status can be interactive; login is required before chat is enabled.');
    return {
      backend,
      name: descriptor.name,
      installed: true,
      cliPath: detectedAgent?.cliPath || command,
      acpArgs: detectedAgent?.acpArgs,
      version,
      authState: 'login-required',
      runtimeState,
      message: 'Login required in Factory Droid CLI',
      warnings: [...warnings, ...history.warnings],
      remediation: getRemediation(backend, runtimeState),
      history,
    };
  }

  if (!descriptor.authProbe) {
    const runtimeState = versionResult.exitCode === 0 ? 'ready' : 'unknown';
    return {
      backend,
      name: descriptor.name,
      installed: true,
      cliPath: detectedAgent?.cliPath || command,
      acpArgs: detectedAgent?.acpArgs,
      version,
      authState: 'unknown',
      runtimeState,
      warnings: [...warnings, ...history.warnings],
      remediation: getRemediation(backend, runtimeState),
      history,
    };
  }

  const authResult = await runner(command, descriptor.authProbe.args, probeTimeoutMs);
  const authOutput = compactOutput(authResult);
  const authState = parseAuthState(backend, authOutput);

  if (authResult.timedOut) {
    warnings.push(`${descriptor.name} auth probe timed out`);
  }

  if (authState === 'authenticated') {
    if (descriptor.authProbe.provesChatReadiness === false) {
      const runtimeState = 'unknown';
      warnings.push(`${descriptor.name} auth status does not prove non-interactive chat readiness; use Check chat.`);
      return {
        backend,
        name: descriptor.name,
        installed: true,
        cliPath: detectedAgent?.cliPath || command,
        acpArgs: detectedAgent?.acpArgs,
        version,
        authState: 'unknown',
        runtimeState,
        message: 'Run Check chat to verify the non-interactive CLI path',
        warnings: [...warnings, ...history.warnings],
        remediation: getRemediation(backend, runtimeState),
        history,
      };
    }

    return {
      backend,
      name: descriptor.name,
      installed: true,
      cliPath: detectedAgent?.cliPath || command,
      acpArgs: detectedAgent?.acpArgs,
      version,
      authState,
      runtimeState: 'ready',
      warnings: [...warnings, ...history.warnings],
      history,
    };
  }

  const runtimeState = authState === 'not-authenticated' ? 'login-required' : 'unknown';
  return {
    backend,
    name: descriptor.name,
    installed: true,
    cliPath: detectedAgent?.cliPath || command,
    acpArgs: detectedAgent?.acpArgs,
    version,
    authState,
    runtimeState,
    message: authState === 'not-authenticated' ? 'CLI login required' : 'CLI auth state is unknown',
    warnings: [...warnings, ...history.warnings],
    remediation: getRemediation(backend, runtimeState),
    history,
  };
}
