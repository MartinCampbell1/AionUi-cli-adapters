/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { agentRegistry } from '@process/agent/AgentRegistry';
import { isAgentKind } from '@/common/types/detectedAgent';
import type { CliAgentBackend, CliAgentImportRequest, CliAgentImportResult } from '@/common/types/cliAgent';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { getCliAgentDescriptor } from './registry';
import { probeCliAgentStatus, type CliDetectedAgentInfo } from './diagnostics';
import { getHistorySummary, listHistorySessions } from './historyReaders';
import { importCliAgentHistory } from './historyImport';

function findDetectedAgent(backend: CliAgentBackend): CliDetectedAgentInfo | undefined {
  const detected = agentRegistry.getDetectedAgents();
  const match = detected.find((agent) => {
    if (backend === 'gemini') return agent.backend === 'gemini';
    return isAgentKind(agent, 'acp') && agent.backend === backend;
  });
  if (!match) return undefined;
  const descriptor = getCliAgentDescriptor(backend);
  return {
    backend,
    name: match.name || descriptor.name,
    cliPath: 'cliPath' in match ? match.cliPath : undefined,
    acpArgs: 'acpArgs' in match ? match.acpArgs : undefined,
  };
}

export async function getCliAgentStatus(backend: CliAgentBackend) {
  return probeCliAgentStatus(backend, findDetectedAgent(backend));
}

export async function getCliAgentHistorySummary(backend: CliAgentBackend) {
  return getHistorySummary(backend);
}

export async function getCliAgentHistorySessions(
  backend: CliAgentBackend,
  options?: { limit?: number; sessionIds?: string[] }
) {
  return listHistorySessions(backend, options);
}

export async function importCliAgentHistoryIntoRepo(
  repo: IConversationRepository,
  request: CliAgentImportRequest
): Promise<CliAgentImportResult> {
  const detected = findDetectedAgent(request.backend);
  return importCliAgentHistory(repo, request, { cliPath: detected?.cliPath });
}
