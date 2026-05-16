/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import type { AcpBackend } from '@/common/types/acpTypes';
import type { CliAgentBackend, CliAgentImportRequest, CliAgentImportResult } from '@/common/types/cliAgent';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { getCliAgentDescriptor } from './registry';
import { readHistorySessions } from './historyReaders';
import type { CliHistoryMessage, CliHistorySession } from './historyTypes';

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 160);
}

function isImportableBackend(backend: CliAgentBackend): backend is Extract<CliAgentBackend, AcpBackend> {
  return backend !== 'gemini';
}

function messagePosition(role: CliHistoryMessage['role']): TMessage['position'] {
  if (role === 'user') return 'right';
  if (role === 'assistant') return 'left';
  return 'center';
}

function toConversation(session: CliHistorySession, cliPath?: string): TChatConversation {
  if (!isImportableBackend(session.backend)) {
    throw new Error(`${session.backend} history cannot be imported as an ACP conversation`);
  }
  const now = Date.now();
  return {
    id: `cli-history-${session.backend}-${sanitizeIdPart(session.sourceSessionId)}`,
    type: 'acp',
    name: session.title,
    desc: session.workspace || session.sourcePath || '',
    createTime: session.createdAt,
    modifyTime: session.updatedAt,
    source: 'cli-history',
    extra: {
      backend: session.backend,
      agentName: getCliAgentDescriptor(session.backend).name,
      cliPath,
      workspace: session.workspace,
      customWorkspace: Boolean(session.workspace),
      cliHistory: {
        provider: session.backend,
        sourceSessionId: session.sourceSessionId,
        sourceKind: session.sourceKind,
        sourcePath: session.sourcePath,
        importedAt: now,
        messageCount: session.messageCount,
        resumable: session.resumable,
        resumeStrategy: session.resumeStrategy,
      },
    },
  };
}

function toAionMessage(conversationId: string, message: CliHistoryMessage, index: number): TMessage {
  return {
    id: `${conversationId}-message-${sanitizeIdPart(message.id || String(index))}`,
    msg_id: message.id,
    conversation_id: conversationId,
    type: 'text',
    content: { content: message.text },
    createdAt: message.timestamp,
    position: messagePosition(message.role),
    status: 'finish',
    hidden: message.hidden,
  };
}

function importedKey(conversation: TChatConversation): string | undefined {
  if (conversation.type !== 'acp') return undefined;
  const history = conversation.extra.cliHistory;
  return history ? `${history.provider}:${history.sourceSessionId}` : undefined;
}

export async function importCliAgentHistory(
  repo: IConversationRepository,
  request: CliAgentImportRequest,
  options?: { cliPath?: string }
): Promise<CliAgentImportResult> {
  if (!isImportableBackend(request.backend)) {
    return {
      backend: request.backend,
      imported: 0,
      skipped: 0,
      failed: 0,
      conversations: [],
      warnings: [`${request.backend} history import is not supported for this backend.`],
    };
  }

  const existingConversations = await repo.listAllConversations();
  const importedKeys = new Set(existingConversations.map(importedKey).filter((key): key is string => Boolean(key)));
  const history = await readHistorySessions(request.backend, {
    limit: request.limit ?? 20,
    sessionIds: request.sessionIds,
  });
  const conversations: CliAgentImportResult['conversations'] = [];
  const warnings = [...history.warnings];
  let skipped = 0;
  let failed = 0;

  for (const session of history.sessions) {
    const key = `${session.backend}:${session.sourceSessionId}`;
    if (importedKeys.has(key)) {
      skipped += 1;
      continue;
    }
    if (session.messages.length === 0) {
      skipped += 1;
      continue;
    }

    try {
      const conversation = toConversation(session, options?.cliPath);
      await repo.createConversation(conversation);
      const messages = session.messages.map((message, index) => toAionMessage(conversation.id, message, index));
      for (const message of messages) {
        await repo.insertMessage(message);
      }
      importedKeys.add(key);
      conversations.push({
        conversationId: conversation.id,
        sourceSessionId: session.sourceSessionId,
        title: session.title,
      });
    } catch (error) {
      failed += 1;
      warnings.push(
        `Failed to import ${session.backend} session ${session.sourceSessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    backend: request.backend,
    imported: conversations.length,
    skipped,
    failed,
    conversations,
    warnings,
  };
}
