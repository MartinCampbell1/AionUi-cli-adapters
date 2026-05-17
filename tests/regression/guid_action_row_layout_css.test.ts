import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '../..');
const guidCss = fs.readFileSync(path.join(rootDir, 'src/renderer/pages/guid/index.module.css'), 'utf8');
const guidActionRow = fs.readFileSync(
  path.join(rootDir, 'src/renderer/pages/guid/components/GuidActionRow.tsx'),
  'utf8'
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = guidCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

describe('GuidActionRow layout contract', () => {
  it('keeps welcome composer controls scrollable instead of overlapping the send button', () => {
    const actionTools = ruleBody('.actionTools');
    expect(actionTools).toContain('overflow-x: auto');
    expect(actionTools).toContain('overflow-y: hidden');
    expect(actionTools).toContain('white-space: nowrap');
    expect(actionTools).toContain('touch-action: pan-x');

    const actionToolsChildren = ruleBody('.actionTools > *');
    expect(actionToolsChildren).toContain('flex: 0 0 auto');

    const configGroup = ruleBody('.actionConfigGroup');
    expect(configGroup).toContain('flex: 0 0 auto');

    const submit = ruleBody('.actionSubmit');
    expect(submit).toContain('flex-shrink: 0');
  });

  it('exposes stable hooks for live composer geometry QA', () => {
    expect(guidActionRow).toContain("data-testid='guid-action-row'");
    expect(guidActionRow).toContain("data-testid='guid-action-tools'");
    expect(guidActionRow).toContain("data-testid='guid-action-submit'");
  });
});
