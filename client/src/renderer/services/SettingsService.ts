/**
 * SettingsService — reads and writes API configuration via the backend REST API.
 */

const SERVER_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// ── Types ────────────────────────────────────────────────────

export type LLMProvider = 'qwen' | 'moonshot';

export const QWEN_MODELS = [
  { label: 'qwen3.5-flash', value: 'qwen3.5-flash' },
  { label: 'qwen3.5-plus', value: 'qwen3.5-plus' },
  { label: 'qwen-plus', value: 'qwen-plus' },
  { label: 'qwen-turbo', value: 'qwen-turbo' },
  { label: 'qwen-max', value: 'qwen-max' },
  { label: 'qwen-flash', value: 'qwen-flash' },
] as const;

export const MOONSHOT_MODELS = [
  { label: 'Kimi K2.5', value: 'kimi-k2.5' },
  { label: 'Kimi K2', value: 'kimi-k2' },
] as const;

export const PROVIDER_OPTIONS = [
  { label: '阿里巴巴 (Qwen)', value: 'qwen' as LLMProvider },
  { label: '月之暗面 (Kimi)', value: 'moonshot' as LLMProvider },
];

export interface SettingsData {
  // Per-module LLM
  resume_llm_provider: LLMProvider;
  resume_llm_model: string;
  interview_llm_provider: LLMProvider;
  interview_llm_model: string;
  research_llm_provider: LLMProvider;
  research_llm_model: string;
  eval_llm_provider: LLMProvider;
  eval_llm_model: string;
  // API keys (masked from server)
  qwen_api_key_masked: string;
  moonshot_api_key_masked: string;
  // iFlytek ASR
  iflytek_app_id: string;
  iflytek_api_key_masked: string;
  iflytek_api_secret_masked: string;
  // TTS
  tts_enabled: boolean;
  tts_model: string;
}

export interface SettingsSavePayload {
  resume_llm_provider?: LLMProvider;
  resume_llm_model?: string;
  interview_llm_provider?: LLMProvider;
  interview_llm_model?: string;
  research_llm_provider?: LLMProvider;
  research_llm_model?: string;
  eval_llm_provider?: LLMProvider;
  eval_llm_model?: string;
  // Plain keys — only sent when actually changed
  qwen_api_key?: string;
  moonshot_api_key?: string;
  iflytek_app_id?: string;
  iflytek_api_key?: string;
  iflytek_api_secret?: string;
  tts_enabled?: boolean;
}

// ── API calls ────────────────────────────────────────────────

export async function getSettings(): Promise<SettingsData> {
  const res = await fetch(`${SERVER_URL}/api/settings`);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to load settings: ${text}`);
  }
  return res.json();
}

export async function saveSettings(payload: SettingsSavePayload): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to save settings: ${text}`);
  }
}

/** Return model options for a given provider. */
export function getModelsForProvider(provider: LLMProvider): Array<{ label: string; value: string }> {
  return provider === 'qwen' ? [...QWEN_MODELS] : [...MOONSHOT_MODELS];
}

/** Return default model for a given provider (first in list). */
export function getDefaultModel(provider: LLMProvider): string {
  return provider === 'qwen' ? 'qwen-max' : 'kimi-k2.5';
}
