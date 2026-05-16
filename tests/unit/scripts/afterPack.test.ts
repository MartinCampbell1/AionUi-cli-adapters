import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('../../../scripts/afterPack.js') as (context: unknown) => Promise<void>;

function makeContext(root: string, withBetterSqliteBinary: boolean): unknown {
  const appOutDir = join(root, 'mac-arm64');
  const resourcesDir = join(appOutDir, 'AionUi.app', 'Contents', 'Resources');
  const moduleRoot = join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'better-sqlite3');
  mkdirSync(moduleRoot, { recursive: true });

  if (withBetterSqliteBinary) {
    const binaryDir = join(moduleRoot, 'build', 'Release');
    mkdirSync(binaryDir, { recursive: true });
    writeFileSync(join(binaryDir, 'better_sqlite3.node'), '');
  }

  return {
    arch: process.arch,
    electronPlatformName: 'darwin',
    appOutDir,
    packager: {
      appInfo: { productFilename: 'AionUi' },
    },
  };
}

describe('afterPack native module verification', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aionui-afterpack-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('fails same-architecture packaging when better-sqlite3 binary is missing', async () => {
    await expect(afterPack(makeContext(root, false))).rejects.toThrow(
      'Packaged native module verification failed for darwin'
    );
  });

  it('allows same-architecture packaging when better-sqlite3 binary is present', async () => {
    await expect(afterPack(makeContext(root, true))).resolves.toBeUndefined();
  });
});
