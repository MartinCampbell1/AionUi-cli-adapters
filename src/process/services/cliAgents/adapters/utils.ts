/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!isRecord(item)) return undefined;
        const text = item.text;
        if (typeof text === 'string') return text;
        return undefined;
      })
      .filter((item): item is string => Boolean(item?.trim()));
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  if (isRecord(value) && typeof value.text === 'string') return value.text;
  return undefined;
}

export async function fileExists(pathname: string): Promise<boolean> {
  try {
    await fs.promises.access(pathname, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(root: string, extension: string, maxFiles = 5000): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    if (result.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.length >= maxFiles) return;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        result.push(entryPath);
      }
    }
  }
  await visit(root);
  return result;
}

export function isContextOnlyMessage(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('<environment_context>') ||
    trimmed.startsWith('# AGENTS.md instructions') ||
    trimmed.startsWith('<INSTRUCTIONS>') ||
    trimmed.startsWith('# Files mentioned by the user:')
  );
}

export function truncateMessage(text: string): string {
  const maxLength = 80_000;
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n[Truncated during CLI history import]` : text;
}
