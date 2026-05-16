/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isCliAgentBackend } from '@/common/types/cliAgent';
import type { CliAgentBackend } from '@/common/types/cliAgent';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import {
  getCliAgentHistorySessions,
  getCliAgentHistorySummary,
  getCliAgentStatus,
  importCliAgentHistoryIntoRepo,
} from '@process/services/cliAgents';

function parseBackend(backend: string): CliAgentBackend {
  if (!isCliAgentBackend(backend)) {
    throw new Error(`Unsupported CLI agent backend: ${backend}`);
  }
  return backend;
}

export function initCliAgentBridge(repo: IConversationRepository): void {
  ipcBridge.cliAgents.getStatus.provider(async ({ backend }) => {
    try {
      return { success: true, data: await getCliAgentStatus(parseBackend(backend)) };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.cliAgents.getHistorySummary.provider(async ({ backend }) => {
    try {
      return { success: true, data: await getCliAgentHistorySummary(parseBackend(backend)) };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.cliAgents.listHistorySessions.provider(async ({ backend, limit, sessionIds }) => {
    try {
      return {
        success: true,
        data: await getCliAgentHistorySessions(parseBackend(backend), { limit, sessionIds }),
      };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.cliAgents.importHistory.provider(async (request) => {
    try {
      const result = await importCliAgentHistoryIntoRepo(repo, {
        ...request,
        backend: parseBackend(request.backend),
      });
      for (const conversation of result.conversations) {
        ipcBridge.conversation.listChanged.emit({
          conversationId: conversation.conversationId,
          action: 'created',
          source: 'cli-history',
        });
      }
      return { success: true, data: result };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
