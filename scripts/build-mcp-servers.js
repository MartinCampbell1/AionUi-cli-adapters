#!/usr/bin/env node
/**
 * Build builtin MCP server scripts as fully self-contained CJS bundles.
 *
 * electron-vite's externalizeDepsPlugin leaves all npm packages as require()
 * calls, which works for Electron's main process (ASAR virtual FS patches
 * require()) but fails when an external `node` process runs the script from
 * app.asar.unpacked — there is no ASAR support there.
 *
 * This script uses Vite/Rollup instead of esbuild.build(entryPoints). On some
 * local macOS Codex Desktop sessions the native esbuild build API can hang
 * while opening file entrypoints, while Vite's transform pipeline remains
 * healthy. Rollup still produces self-contained CJS output for the external
 * node processes that cannot rely on Electron's ASAR-aware require().
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

const mainAliases = {
  '@': path.resolve(ROOT, 'src'),
  '@common': path.resolve(ROOT, 'src/common'),
  '@renderer': path.resolve(ROOT, 'src/renderer'),
  '@process': path.resolve(ROOT, 'src/process'),
  '@worker': path.resolve(ROOT, 'src/process/worker'),
  '@xterm/headless': path.resolve(ROOT, 'src/common/utils/shims/xterm-headless.ts'),
};

const targets = [
  {
    entry: 'src/process/resources/builtinMcp/imageGenServer.ts',
    generatedFileName: 'imageGenServer.js',
    fileName: 'builtin-mcp-image-gen.js',
  },
  {
    entry: 'src/process/team/mcp/team/teamMcpStdio.ts',
    generatedFileName: 'teamMcpStdio.js',
    fileName: 'team-mcp-stdio.js',
  },
  {
    entry: 'src/process/team/mcp/guide/teamGuideMcpStdio.ts',
    generatedFileName: 'teamGuideMcpStdio.js',
    fileName: 'team-guide-mcp-stdio.js',
  },
];

function emptyWasmPlugin() {
  return {
    name: 'empty-wasm',
    load(id) {
      if (id.endsWith('.wasm')) return 'module.exports = {}';
      return null;
    },
  };
}

async function buildTarget(build, target) {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: 'warn',
    resolve: {
      alias: mainAliases,
      extensions: ['.ts', '.tsx', '.js', '.json'],
    },
    plugins: [emptyWasmPlugin()],
    define: {
      // @office-ai/aioncli-core uses import.meta.url for version detection.
      // Provide a valid file: URL so fileURLToPath() does not throw at startup.
      'import.meta.url': JSON.stringify('file:///C:/placeholder'),
    },
    build: {
      ssr: true,
      outDir: path.join(ROOT, 'out/main'),
      emptyOutDir: false,
      target: 'node20',
      sourcemap: false,
      minify: false,
      reportCompressedSize: false,
      lib: {
        entry: path.join(ROOT, target.entry),
        formats: ['cjs'],
        fileName: () => target.fileName,
      },
      rollupOptions: {
        external: ['electron'],
        output: {
          inlineDynamicImports: true,
          exports: 'auto',
        },
      },
    },
  });

  const generatedPath = path.join(ROOT, 'out/main', target.generatedFileName);
  const desiredPath = path.join(ROOT, 'out/main', target.fileName);
  if (generatedPath !== desiredPath && fs.existsSync(generatedPath)) {
    fs.rmSync(desiredPath, { force: true });
    fs.renameSync(generatedPath, desiredPath);
  }
}

async function main() {
  const { build } = await import('vite');
  for (const target of targets) {
    await buildTarget(build, target);
  }
}

main().catch((err) => {
  console.error('MCP server build failed:', err);
  process.exit(1);
});
