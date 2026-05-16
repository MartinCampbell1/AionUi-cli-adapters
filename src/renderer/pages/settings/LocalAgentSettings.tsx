/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import { isCliAgentBackend } from '@/common/types/cliAgent';
import type { CliAgentRuntimeState } from '@/common/types/cliAgent';
import { copyText } from '@/renderer/utils/ui/clipboard';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import { Alert, Button, Empty, Message, Spin, Tag, Typography } from '@arco-design/web-react';
import { Caution, CheckOne, Copy, History, Play, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

const statusColor: Record<CliAgentRuntimeState, string> = {
  ready: 'green',
  'login-required': 'orange',
  unavailable: 'red',
  unsupported: 'gray',
  error: 'red',
  unknown: 'gray',
};

const LocalAgentSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ backend: string }>();
  const backend = params.backend && isCliAgentBackend(params.backend) ? params.backend : undefined;
  const [importing, setImporting] = useState(false);
  const [checkingChat, setCheckingChat] = useState(false);
  const [chatCheckResult, setChatCheckResult] = useState<{
    ok: boolean;
    latency?: number;
    message: string;
  }>();

  const statusKey = backend ? ['cli-agent-status', backend] : null;
  const sessionsKey = backend ? ['cli-agent-history-sessions', backend] : null;

  const {
    data: statusResult,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useSWR(statusKey, async () => {
    if (!backend) return undefined;
    return ipcBridge.cliAgents.getStatus.invoke({ backend });
  });

  const {
    data: sessionsResult,
    isLoading: sessionsLoading,
    mutate: mutateSessions,
  } = useSWR(sessionsKey, async () => {
    if (!backend) return undefined;
    return ipcBridge.cliAgents.listHistorySessions.invoke({ backend, limit: 8 });
  });

  const status = statusResult?.success ? statusResult.data : undefined;
  const sessions = sessionsResult?.success ? (sessionsResult.data?.sessions ?? []) : [];
  const warnings = useMemo(() => {
    const all = [
      ...(status?.warnings ?? []),
      ...(sessionsResult?.success ? (sessionsResult.data?.warnings ?? []) : []),
    ];
    return Array.from(new Set(all.filter(Boolean)));
  }, [sessionsResult, status]);

  const handleRefresh = async () => {
    await Promise.all([mutateStatus(), mutateSessions()]);
    Message.success(t('common.refreshSuccess', { defaultValue: 'Refreshed' }));
  };

  const handleImport = async () => {
    if (!backend) return;
    setImporting(true);
    try {
      const result = await ipcBridge.cliAgents.importHistory.invoke({ backend, limit: 20 });
      if (!result.success || !result.data) {
        Message.error(result.msg || t('settings.localAgent.importFailed'));
        return;
      }
      Message.success(
        t('settings.localAgent.importResult', {
          imported: result.data.imported,
          skipped: result.data.skipped,
        })
      );
      await Promise.all([mutateStatus(), mutateSessions()]);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('settings.localAgent.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const handleCopyCommands = async (commands: string[]) => {
    try {
      await copyText(commands.join('\n'));
      Message.success(t('common.copySuccess'));
    } catch {
      Message.error(t('common.copyFailed'));
    }
  };

  const handleCheckChat = async () => {
    if (!backend) return;
    setCheckingChat(true);
    setChatCheckResult(undefined);

    try {
      const result = await ipcBridge.acpConversation.checkAgentHealth.invoke({ backend });
      if (result.success && result.data?.available) {
        const latency = result.data.latency;
        const message = t('settings.localAgent.chatCheckSuccess', {
          latency: latency ?? '-',
        });
        setChatCheckResult({ ok: true, latency, message });
        Message.success(message);
        return;
      }

      const message =
        result.msg ||
        result.data?.error ||
        t('settings.localAgent.chatCheckFailed', { defaultValue: 'Chat check failed' });
      setChatCheckResult({ ok: false, message });
      Message.warning(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.localAgent.chatCheckFailed');
      setChatCheckResult({ ok: false, message });
      Message.error(message);
    } finally {
      setCheckingChat(false);
    }
  };

  const handleStartChat = async () => {
    if (!backend) return;
    await ConfigStorage.set('guid.lastSelectedAgent', backend);
    navigate('/guid');
  };

  if (!backend) {
    return (
      <SettingsPageWrapper>
        <Empty description={t('settings.localAgent.unsupportedBackend')} />
      </SettingsPageWrapper>
    );
  }

  const historySupport = status?.history.support;
  const importDisabled =
    !status || sessions.length === 0 || historySupport === 'unsupported' || historySupport === 'error';

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px'>
        <div className='flex flex-col gap-12px md:flex-row md:items-center md:justify-between'>
          <div className='min-w-0'>
            <Typography.Title heading={5} className='!mb-4px'>
              {status?.name || backend}
            </Typography.Title>
            <Typography.Text type='secondary' className='block text-12px'>
              {t('settings.localAgent.subtitle')}
            </Typography.Text>
          </div>
          <div className='flex flex-wrap gap-8px'>
            <Button size='small' icon={<Refresh size='14' />} onClick={() => void handleRefresh()}>
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button
              size='small'
              icon={<CheckOne size='14' />}
              loading={checkingChat}
              disabled={!status || status.runtimeState === 'unavailable'}
              onClick={() => void handleCheckChat()}
            >
              {t('settings.localAgent.checkChat')}
            </Button>
            <Button size='small' type='primary' icon={<Play size='14' />} onClick={() => void handleStartChat()}>
              {t('settings.localAgent.startChat')}
            </Button>
          </div>
        </div>

        {statusLoading ? (
          <div className='flex min-h-120px items-center justify-center rounded-8px bg-aou-1'>
            <Spin />
          </div>
        ) : (
          <div className='grid gap-12px md:grid-cols-2'>
            <div className='flex flex-col gap-10px rounded-8px bg-aou-1 p-16px'>
              <div className='flex items-center justify-between gap-12px'>
                <Typography.Text className='text-14px font-medium'>{t('settings.localAgent.runtime')}</Typography.Text>
                <Tag color={status ? statusColor[status.runtimeState] : 'gray'} size='small'>
                  {status?.runtimeState || 'unknown'}
                </Tag>
              </div>
              <InfoRow
                label={t('settings.localAgent.installed')}
                value={status?.installed ? t('settings.localAgent.yes') : t('settings.localAgent.no')}
              />
              <InfoRow label={t('settings.localAgent.auth')} value={status?.authState || 'unknown'} />
              {status?.version && <InfoRow label={t('settings.aionrs.version')} value={status.version} />}
              {status?.cliPath && <InfoRow label={t('settings.aionrs.path')} value={status.cliPath} mono />}
              {status?.acpArgs && status.acpArgs.length > 0 && (
                <InfoRow label={t('settings.localAgent.acpArgs')} value={status.acpArgs.join(' ')} mono />
              )}
              {status?.message && (
                <Typography.Text type='secondary' className='text-12px'>
                  {status.message}
                </Typography.Text>
              )}
            </div>

            <div className='flex flex-col gap-10px rounded-8px bg-aou-1 p-16px'>
              <div className='flex items-center justify-between gap-12px'>
                <Typography.Text className='text-14px font-medium'>{t('settings.localAgent.history')}</Typography.Text>
                <Tag
                  color={historySupport === 'supported' ? 'green' : historySupport === 'empty' ? 'gray' : 'orange'}
                  size='small'
                >
                  {historySupport || 'unknown'}
                </Tag>
              </div>
              <InfoRow label={t('settings.localAgent.historySource')} value={status?.history.sourceLabel || '-'} />
              {status?.history.sourcePath && (
                <InfoRow label={t('settings.localAgent.historyPath')} value={status.history.sourcePath} mono />
              )}
              <InfoRow
                label={t('settings.localAgent.historySessions')}
                value={String(status?.history.totalSessions ?? 0)}
              />
              <Button
                size='small'
                type='secondary'
                icon={<History size='14' />}
                loading={importing}
                disabled={importDisabled}
                onClick={() => void handleImport()}
              >
                {t('settings.localAgent.importRecent')}
              </Button>
            </div>
          </div>
        )}

        {chatCheckResult && (
          <Alert
            type={chatCheckResult.ok ? 'success' : 'warning'}
            icon={chatCheckResult.ok ? <CheckOne size='16' /> : <Caution size='16' />}
            content={
              <div className='flex flex-col gap-4px'>
                <Typography.Text className='text-13px font-medium'>
                  {chatCheckResult.ok
                    ? t('settings.localAgent.chatCheckReady')
                    : t('settings.localAgent.chatCheckNotReady')}
                </Typography.Text>
                <Typography.Text type='secondary' className='text-12px'>
                  {chatCheckResult.message}
                </Typography.Text>
              </div>
            }
          />
        )}

        {warnings.length > 0 && (
          <Alert
            type='warning'
            icon={<Caution size='16' />}
            content={
              <div className='flex flex-col gap-4px'>
                {warnings.slice(0, 4).map((warning) => (
                  <Typography.Text key={warning} className='text-12px'>
                    {warning}
                  </Typography.Text>
                ))}
              </div>
            }
          />
        )}

        {status?.remediation && (
          <Alert
            type={status.runtimeState === 'unavailable' ? 'error' : 'warning'}
            icon={<Caution size='16' />}
            content={
              <div className='flex flex-col gap-10px'>
                <div className='flex flex-col gap-2px'>
                  <Typography.Text className='text-13px font-medium'>{status.remediation.title}</Typography.Text>
                  <Typography.Text type='secondary' className='text-12px'>
                    {status.remediation.description}
                  </Typography.Text>
                </div>
                <CommandList
                  label={t('settings.localAgent.repairCommands')}
                  copyLabel={t('common.copy')}
                  commands={status.remediation.commands}
                  onCopy={() => void handleCopyCommands(status.remediation?.commands ?? [])}
                />
                {status.remediation.verifyCommands.length > 0 && (
                  <CommandList
                    label={t('settings.localAgent.verifyCommands')}
                    copyLabel={t('common.copy')}
                    commands={status.remediation.verifyCommands}
                    onCopy={() => void handleCopyCommands(status.remediation?.verifyCommands ?? [])}
                  />
                )}
              </div>
            }
          />
        )}

        <div className='flex flex-col gap-8px rounded-8px bg-aou-1 p-16px'>
          <div className='flex items-center justify-between gap-12px'>
            <Typography.Text className='text-14px font-medium'>
              {t('settings.localAgent.recentSessions')}
            </Typography.Text>
            {sessionsLoading && <Spin size={16} />}
          </div>
          {sessions.length > 0 ? (
            <div className='flex flex-col gap-6px'>
              {sessions.map((session) => (
                <div
                  key={session.sourceSessionId}
                  className='flex items-center justify-between gap-12px rounded-8px bg-[var(--color-bg-2)] px-12px py-9px'
                >
                  <div className='min-w-0'>
                    <Typography.Text className='block truncate text-13px'>{session.title}</Typography.Text>
                    <Typography.Text type='secondary' className='block truncate text-11px'>
                      {session.workspace || session.sourceSessionId}
                    </Typography.Text>
                  </div>
                  <div className='flex shrink-0 items-center gap-8px'>
                    <Typography.Text type='secondary' className='text-11px'>
                      {session.messageCount}
                    </Typography.Text>
                    {session.resumable && <CheckOne theme='filled' size='14' className='text-success-6' />}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty description={t('settings.localAgent.noSessions')} />
          )}
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

const InfoRow: React.FC<{ label: string; value?: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className='grid grid-cols-[120px_minmax(0,1fr)] gap-10px text-12px'>
    <Typography.Text type='secondary'>{label}</Typography.Text>
    <Typography.Text className={mono ? 'break-all font-mono text-12px' : 'break-words text-12px'}>
      {value || '-'}
    </Typography.Text>
  </div>
);

const CommandList: React.FC<{ label: string; copyLabel: string; commands: string[]; onCopy: () => void }> = ({
  label,
  copyLabel,
  commands,
  onCopy,
}) => {
  if (commands.length === 0) return null;

  return (
    <div className='flex flex-col gap-6px'>
      <div className='flex items-center justify-between gap-8px'>
        <Typography.Text className='text-12px font-medium'>{label}</Typography.Text>
        <Button size='small' icon={<Copy size='14' />} onClick={onCopy}>
          {copyLabel}
        </Button>
      </div>
      <div className='flex flex-col gap-4px rounded-6px bg-[var(--color-bg-2)] p-8px'>
        {commands.map((command) => (
          <Typography.Text key={command} className='break-all font-mono text-12px'>
            {command}
          </Typography.Text>
        ))}
      </div>
    </div>
  );
};

export default LocalAgentSettings;
