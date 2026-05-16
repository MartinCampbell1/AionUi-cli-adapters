/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isDirectCliTurnBackend } from '@/process/services/cliAgents/directTurn';

describe('direct CLI turn backend routing', () => {
  it('routes one-shot CLI backends away from prewarmed ACP sessions', () => {
    expect(isDirectCliTurnBackend('claude')).toBe(true);
    expect(isDirectCliTurnBackend('droid')).toBe(true);
    expect(isDirectCliTurnBackend('hermes')).toBe(true);
    expect(isDirectCliTurnBackend('gemini')).toBe(true);
  });

  it('keeps ACP-native backends on their normal transport', () => {
    expect(isDirectCliTurnBackend('codex')).toBe(false);
    expect(isDirectCliTurnBackend('opencode')).toBe(false);
    expect(isDirectCliTurnBackend(undefined)).toBe(false);
  });
});
