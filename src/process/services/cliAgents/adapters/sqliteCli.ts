/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'child_process';

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function runSqliteJson<T extends Record<string, unknown>>(databasePath: string, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-readonly', '-json', databasePath, sql],
      { timeout: 5000, maxBuffer: 5_000_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        const trimmed = String(stdout || '').trim();
        if (!trimmed) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          resolve(Array.isArray(parsed) ? (parsed as T[]) : []);
        } catch (parseError) {
          reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
        }
      }
    );
  });
}
