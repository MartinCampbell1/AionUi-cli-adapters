/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import type { CliAgentBackend } from '@/common/types/cliAgent';
import { expandHomePath, getCliAgentDescriptor } from '../registry';
import type { CliHistoryReader, CliHistoryReaderResult } from '../historyTypes';
import { fileExists } from './utils';

export function createUnsupportedHistoryReader(
  backend: Extract<CliAgentBackend, 'gemini' | 'droid'>,
  homeDir = os.homedir()
): CliHistoryReader {
  const descriptor = getCliAgentDescriptor(backend);
  const sourcePath = descriptor.defaultHistoryPath ? expandHomePath(descriptor.defaultHistoryPath, homeDir) : undefined;
  return {
    backend,
    sourceLabel: descriptor.historyLabel,
    sourcePath,
    async listSessions(): Promise<CliHistoryReaderResult> {
      const sourceExists = sourcePath ? await fileExists(sourcePath) : false;
      const warning =
        backend === 'gemini'
          ? 'Gemini CLI message history store is not available in the current local installation.'
          : 'Factory Droid history import is disabled until the CLI is authenticated and a stable history store is identified.';
      return {
        backend,
        sessions: [],
        totalSessions: 0,
        warnings: [sourceExists ? warning : `${warning} Source path not found.`],
      };
    },
  };
}
