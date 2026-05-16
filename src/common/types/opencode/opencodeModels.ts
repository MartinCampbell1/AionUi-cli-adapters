/**
 * Default OpenCode model list maintained by AionUi.
 *
 * OpenCode can expose a very large provider/model catalogue. On first launch
 * its ACP bridge may not return a model list before the first prompt, so AionUi
 * keeps a small known-good fallback list for CLI-first conversations.
 */
export const DEFAULT_OPENCODE_MODELS: Array<{ id: string; label: string; description: string }> = [
  {
    id: 'opencode/qwen3.6-plus-free',
    label: 'qwen3.6-plus-free',
    description: 'OpenCode-hosted free coding model',
  },
  {
    id: 'opencode/deepseek-v4-flash-free',
    label: 'deepseek-v4-flash-free',
    description: 'OpenCode-hosted free fast coding model',
  },
  {
    id: 'opencode/minimax-m2.5-free',
    label: 'minimax-m2.5-free',
    description: 'OpenCode-hosted free general coding model',
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'gpt-5.4-mini',
    description: 'OpenAI model routed through OpenCode',
  },
];

export const DEFAULT_OPENCODE_MODEL_ID = DEFAULT_OPENCODE_MODELS[0].id;
