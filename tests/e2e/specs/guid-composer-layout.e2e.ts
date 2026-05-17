import { test, expect, type Page } from '../fixtures';
import { goToGuid } from '../helpers/navigation';

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

type ComposerLayoutSnapshot = {
  overflowX: string | null;
  scrollable: boolean;
  scrollWidth: number;
  clientWidth: number;
  visibleOverlaps: Array<{ label: string; visible: Rect; sendRect: Rect }>;
};

async function composerLayoutSnapshot(page: Page): Promise<ComposerLayoutSnapshot> {
  return page.evaluate(() => {
    const rectOf = (element: Element | null): Rect | null => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };

    const tools = document.querySelector('[data-testid="guid-action-tools"]');
    const send = document.querySelector('.send-button-custom');
    const toolsRect = rectOf(tools);
    const sendRect = rectOf(send);
    const toolsStyle = tools ? getComputedStyle(tools) : null;
    const buttons = [...document.querySelectorAll('[data-testid="guid-action-tools"] button.sendbox-model-btn')];
    const visibleOverlaps: Array<{ label: string; visible: Rect; sendRect: Rect }> = [];

    if (toolsRect && sendRect) {
      for (const button of buttons) {
        const buttonRect = rectOf(button);
        if (!buttonRect) continue;

        const visible = {
          left: Math.max(buttonRect.left, toolsRect.left),
          right: Math.min(buttonRect.right, toolsRect.right),
          top: Math.max(buttonRect.top, toolsRect.top),
          bottom: Math.min(buttonRect.bottom, toolsRect.bottom),
          width: Math.max(0, Math.min(buttonRect.right, toolsRect.right) - Math.max(buttonRect.left, toolsRect.left)),
          height: Math.max(0, Math.min(buttonRect.bottom, toolsRect.bottom) - Math.max(buttonRect.top, toolsRect.top)),
        };
        const hasVisibleArea = visible.width > 0 && visible.height > 0;
        const overlapsSend =
          visible.right > sendRect.left &&
          visible.left < sendRect.right &&
          visible.bottom > sendRect.top &&
          visible.top < sendRect.bottom;

        if (hasVisibleArea && overlapsSend) {
          visibleOverlaps.push({
            label: (button.textContent || '').trim(),
            visible,
            sendRect,
          });
        }
      }
    }

    return {
      overflowX: toolsStyle?.overflowX ?? null,
      scrollable: Boolean(tools && tools.scrollWidth > tools.clientWidth),
      scrollWidth: tools?.scrollWidth ?? 0,
      clientWidth: tools?.clientWidth ?? 0,
      visibleOverlaps,
    };
  });
}

test.describe('Guid composer layout', () => {
  test('keeps overflowing model and profile controls scrollable away from send button', async ({ page }) => {
    await goToGuid(page);
    await page.waitForSelector('[data-testid="guid-action-tools"]');

    for (const viewport of [
      { width: 2048, height: 1280 },
      { width: 1280, height: 800 },
      { width: 900, height: 760 },
    ]) {
      await page.setViewportSize(viewport);
      const snapshot = await composerLayoutSnapshot(page);

      expect(snapshot.overflowX).toBe('auto');
      expect(snapshot.scrollWidth).toBeGreaterThanOrEqual(snapshot.clientWidth);
      expect(snapshot.visibleOverlaps).toEqual([]);
    }
  });
});
