/**
 * SettingsPage — API configuration for all AI components.
 *
 * 文字类 API: 4 LLM modules (resume / interview / research / eval)
 * 语音类 API: ASR (iFlytek) + TTS (Qwen)
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  App,
  Select,
  Input,
  Button,
  Spin,
  Alert,
  Tag,
} from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  CustomerServiceOutlined,
  SearchOutlined,
  StarOutlined,
  LockOutlined,
  CheckCircleOutlined,
  KeyOutlined,
  SoundOutlined,
  AudioOutlined,
} from '@ant-design/icons';
import { useInterviewStore } from '../stores/interviewStore';
import {
  getSettings,
  saveSettings,
  getModelsForProvider,
  getDefaultModel,
  PROVIDER_OPTIONS,
  type LLMProvider,
  type SettingsData,
  type SettingsSavePayload,
} from '../services/SettingsService';

// ── Types ──────────────────────────────────────────────────

type NavSection = 'text' | 'voice';

interface ModuleConfig {
  provider: LLMProvider;
  model: string;
}

interface LocalSettings {
  resume: ModuleConfig;
  interview: ModuleConfig;
  research: ModuleConfig;
  eval: ModuleConfig;
  qwenApiKey: string;       // plain; empty = don't update
  moonshotApiKey: string;   // plain; empty = don't update
  iflytekAppId: string;
  iflytekApiKey: string;    // plain; empty = don't update
  iflytekApiSecret: string; // plain; empty = don't update
  ttsEnabled: boolean;
}

// ── Constants ─────────────────────────────────────────────

const MODULE_META = [
  {
    key: 'resume' as const,
    icon: <FileTextOutlined />,
    color: '#6366f1',
    title: '简历解析 AI',
    desc: '上传简历后的结构化解析与信息提取',
  },
  {
    key: 'interview' as const,
    icon: <CustomerServiceOutlined />,
    color: '#2563eb',
    title: '面试官 AI',
    desc: '实时流式生成面试问题与追问',
  },
  {
    key: 'research' as const,
    icon: <SearchOutlined />,
    color: '#7c3aed',
    title: '调研 AI',
    desc: '公司技术情报调研（四阶段分析）',
    researchWarning: true,
  },
  {
    key: 'eval' as const,
    icon: <StarOutlined />,
    color: '#10b981',
    title: '评估 AI',
    desc: '答案质量评估、流程决策、赛后复盘',
  },
];

// ── Helpers ───────────────────────────────────────────────

function initLocalFromServer(data: SettingsData): LocalSettings {
  return {
    resume: { provider: data.resume_llm_provider as LLMProvider, model: data.resume_llm_model },
    interview: { provider: data.interview_llm_provider as LLMProvider, model: data.interview_llm_model },
    research: { provider: data.research_llm_provider as LLMProvider, model: data.research_llm_model },
    eval: { provider: data.eval_llm_provider as LLMProvider, model: data.eval_llm_model },
    qwenApiKey: '',
    moonshotApiKey: '',
    iflytekAppId: data.iflytek_app_id,
    iflytekApiKey: '',
    iflytekApiSecret: '',
    ttsEnabled: data.tts_enabled,
  };
}

// ── Sub-component: Module Card ─────────────────────────────

const ModuleCard: React.FC<{
  meta: typeof MODULE_META[0];
  config: ModuleConfig;
  onChange: (config: ModuleConfig) => void;
}> = ({ meta, config, onChange }) => {
  const modelOptions = getModelsForProvider(config.provider);

  const handleProviderChange = (provider: LLMProvider) => {
    onChange({ provider, model: getDefaultModel(provider) });
  };

  const handleModelChange = (model: string) => {
    onChange({ ...config, model });
  };

  return (
    <div style={{
      background: '#fff',
      borderRadius: '12px',
      padding: '20px',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      transition: 'box-shadow 180ms',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '16px' }}>
        <div style={{
          width: '34px', height: '34px', borderRadius: '9px',
          background: `${meta.color}14`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: meta.color, fontSize: '16px', flexShrink: 0,
        }}>
          {meta.icon}
        </div>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{meta.title}</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{meta.desc}</div>
        </div>
      </div>

      {/* Provider select */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
          供应商
        </div>
        <Select
          value={config.provider}
          onChange={handleProviderChange}
          options={PROVIDER_OPTIONS}
          style={{ width: '100%' }}
          size="middle"
        />
      </div>

      {/* Model select */}
      <div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
          模型
        </div>
        <Select
          value={config.model}
          onChange={handleModelChange}
          options={modelOptions}
          style={{ width: '100%' }}
          size="middle"
        />
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────

const SettingsPage: React.FC = () => {
  const { notification } = App.useApp();
  const setAppView = useInterviewStore((s) => s.setAppView);

  const [section, setSection] = useState<NavSection>('text');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverData, setServerData] = useState<SettingsData | null>(null);
  const [local, setLocal] = useState<LocalSettings | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Fetch settings on mount ──────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await getSettings();
        setServerData(data);
        setLocal(initLocalFromServer(data));
      } catch (e: unknown) {
        setFetchError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Helpers ──────────────────────────────────────────────
  const updateModule = useCallback((key: keyof Pick<LocalSettings, 'resume' | 'interview' | 'research' | 'eval'>, config: ModuleConfig) => {
    setLocal((prev) => prev ? { ...prev, [key]: config } : prev);
  }, []);

  // ── Save ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!local) return;
    setSaving(true);
    try {
      const payload: SettingsSavePayload = {
        resume_llm_provider: local.resume.provider,
        resume_llm_model: local.resume.model,
        interview_llm_provider: local.interview.provider,
        interview_llm_model: local.interview.model,
        research_llm_provider: local.research.provider,
        research_llm_model: local.research.model,
        eval_llm_provider: local.eval.provider,
        eval_llm_model: local.eval.model,
        tts_enabled: local.ttsEnabled,
      };
      if (local.qwenApiKey) payload.qwen_api_key = local.qwenApiKey;
      if (local.moonshotApiKey) payload.moonshot_api_key = local.moonshotApiKey;
      if (local.iflytekAppId !== undefined) payload.iflytek_app_id = local.iflytekAppId;
      if (local.iflytekApiKey) payload.iflytek_api_key = local.iflytekApiKey;
      if (local.iflytekApiSecret) payload.iflytek_api_secret = local.iflytekApiSecret;

      await saveSettings(payload);

      // Refresh masked keys from server
      const fresh = await getSettings();
      setServerData(fresh);
      setLocal(initLocalFromServer(fresh));

      notification.success({
        message: '设置已保存',
        description: 'AI 配置已立即生效，无需重启服务。',
        duration: 3,
      });
    } catch (e: unknown) {
      notification.error({
        message: '保存失败',
        description: e instanceof Error ? e.message : String(e),
        duration: 5,
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Render helpers ───────────────────────────────────────
  const renderApiKeyStatus = (masked: string) => {
    if (!masked) return <Tag color="warning">未配置</Tag>;
    return (
      <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#6b7280' }}>
        <CheckCircleOutlined style={{ color: '#10b981', marginRight: '4px' }} />
        {masked}
      </span>
    );
  };

  // ── Sections ─────────────────────────────────────────────
  const renderTextSection = () => {
    if (!local || !serverData) return null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Module cards grid */}
        <div>
          <SectionLabel icon="🤖" title="模型配置" subtitle="为每个功能模块独立配置 AI 供应商和模型" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '14px',
          }}>
            {MODULE_META.map((meta) => (
              <ModuleCard
                key={meta.key}
                meta={meta}
                config={local[meta.key]}
                onChange={(c) => updateModule(meta.key, c)}
              />
            ))}
          </div>
        </div>

        {/* API Keys */}
        <div>
          <SectionLabel icon="🔑" title="API 密钥" subtitle="密钥仅写入服务端配置，不会上云存储" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Qwen */}
            <ApiKeyCard
              providerColor="#ff6a00"
              providerName="阿里巴巴 (Qwen)"
              hint="DashScope API Key，同时用于 TTS"
              masked={serverData.qwen_api_key_masked}
              value={local.qwenApiKey}
              onChange={(v) => setLocal((p) => p ? { ...p, qwenApiKey: v } : p)}
              placeholder="sk-..."
              renderStatus={renderApiKeyStatus}
            />
            {/* Moonshot */}
            <ApiKeyCard
              providerColor="#6366f1"
              providerName="月之暗面 (Kimi)"
              hint="Moonshot API Key"
              masked={serverData.moonshot_api_key_masked}
              value={local.moonshotApiKey}
              onChange={(v) => setLocal((p) => p ? { ...p, moonshotApiKey: v } : p)}
              placeholder="sk-..."
              renderStatus={renderApiKeyStatus}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderVoiceSection = () => {
    if (!local || !serverData) return null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* ASR */}
        <div>
          <SectionLabel icon="🎙️" title="ASR — 语音转文字" subtitle="当前仅支持科大讯飞大模型接口" />
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '20px',
            border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            {/* Provider locked */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#2563eb', fontSize: '18px', flexShrink: 0,
              }}>
                <AudioOutlined />
              </div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>
                  科大讯飞 ASR（大模型接口）
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  WebSocket 实时识别，PCM 16kHz / 16-bit
                </div>
              </div>
              <Tag icon={<LockOutlined />} color="default" style={{ marginLeft: 'auto' }}>
                固定供应商
              </Tag>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {/* App ID */}
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                  App ID
                  {serverData.iflytek_app_id
                    ? <span style={{ marginLeft: '8px', fontSize: '11px', color: '#10b981', fontWeight: 400 }}>已配置</span>
                    : <span style={{ marginLeft: '8px', fontSize: '11px', color: '#f59e0b', fontWeight: 400 }}>未配置</span>
                  }
                </div>
                <Input
                  value={local.iflytekAppId}
                  onChange={(e) => setLocal((p) => p ? { ...p, iflytekAppId: e.target.value } : p)}
                  placeholder={serverData.iflytek_app_id || '请填写 App ID'}
                  size="middle"
                />
              </div>
              {/* Placeholder for layout balance */}
              <div />

              {/* API Key */}
              <div>
                <KeyLabel label="API Key" masked={serverData.iflytek_api_key_masked} renderStatus={renderApiKeyStatus} />
                <Input.Password
                  value={local.iflytekApiKey}
                  onChange={(e) => setLocal((p) => p ? { ...p, iflytekApiKey: e.target.value } : p)}
                  placeholder={serverData.iflytek_api_key_masked || '留空保持不变'}
                  size="middle"
                />
              </div>

              {/* API Secret */}
              <div>
                <KeyLabel label="API Secret" masked={serverData.iflytek_api_secret_masked} renderStatus={renderApiKeyStatus} />
                <Input.Password
                  value={local.iflytekApiSecret}
                  onChange={(e) => setLocal((p) => p ? { ...p, iflytekApiSecret: e.target.value } : p)}
                  placeholder={serverData.iflytek_api_secret_masked || '留空保持不变'}
                  size="middle"
                />
              </div>
            </div>
          </div>
        </div>

        {/* TTS */}
        <div>
          <SectionLabel icon="🔊" title="TTS — 文字转语音" subtitle="使用阿里云 DashScope 语音合成服务" />
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '20px',
            border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#d97706', fontSize: '18px', flexShrink: 0,
              }}>
                <SoundOutlined />
              </div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>
                  qwen3-tts-flash
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  阿里云语音合成，复用文字类 Qwen API Key
                </div>
              </div>
              <Tag icon={<LockOutlined />} color="default" style={{ marginLeft: 'auto' }}>
                固定模型
              </Tag>
            </div>

            <div style={{
              display: 'flex', gap: '8px', padding: '12px',
              background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0',
              fontSize: '13px', color: '#166534',
            }}>
              <KeyOutlined style={{ marginTop: '2px', flexShrink: 0 }} />
              <span>TTS 服务直接使用上方文字类 API 中配置的 <strong>Qwen API Key</strong>，无需单独设置。</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Root render ──────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100%',
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #f0f4ff 0%, #f8f5ff 50%, #f0fdf9 100%)',
    }}>
      {/* ── LEFT NAV ── */}
      <div style={{
        width: '220px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '32px 20px',
        borderRight: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(255,255,255,0.55)',
        backdropFilter: 'blur(8px)',
      }}>
        {/* Back button */}
        <button
          onClick={() => setAppView('main')}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', borderRadius: '8px', border: 'none',
            background: 'transparent', cursor: 'pointer',
            color: '#6b7280', fontSize: '13px', fontWeight: 500,
            transition: 'background 150ms, color 150ms',
            marginBottom: '24px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
            e.currentTarget.style.color = '#4f46e5';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#6b7280';
          }}
        >
          <ArrowLeftOutlined />
          返回
        </button>

        {/* Title */}
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 4px', marginBottom: '8px' }}>
          设置
        </div>

        {/* Nav items */}
        {([
          { key: 'text' as NavSection, icon: '🤖', label: '文字类 API' },
          { key: 'voice' as NavSection, icon: '🎙️', label: '语音类 API' },
        ] as const).map((item) => (
          <NavItem
            key={item.key}
            active={section === item.key}
            onClick={() => setSection(item.key)}
            icon={item.icon}
            label={item.label}
          />
        ))}
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '28px 36px 20px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#111827' }}>
            {section === 'text' ? '文字类 API 设置' : '语音类 API 设置'}
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
            {section === 'text'
              ? '为每个 AI 功能模块独立配置供应商和模型，修改立即生效'
              : '配置语音识别（ASR）与语音合成（TTS）服务'}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '28px 36px',
        }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '80px' }}>
              <Spin size="large" tip="加载配置中...">
                <div style={{ padding: '20px 60px' }} />
              </Spin>
            </div>
          ) : fetchError ? (
            <Alert
              type="error"
              message="无法连接到后端服务"
              description={fetchError}
              showIcon
              style={{ marginBottom: '16px' }}
            />
          ) : (
            <>
              {section === 'text' && renderTextSection()}
              {section === 'voice' && renderVoiceSection()}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !fetchError && (
          <div style={{
            padding: '16px 36px',
            borderTop: '1px solid rgba(0,0,0,0.06)',
            background: 'rgba(255,255,255,0.4)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
          }}>
            <Button onClick={() => setAppView('main')} size="large">
              取消
            </Button>
            <Button
              type="primary"
              size="large"
              onClick={handleSave}
              loading={saving}
              style={{ minWidth: '100px' }}
            >
              保存设置
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Tiny helper components ────────────────────────────────

const NavItem: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 12px', borderRadius: '8px', border: 'none',
      background: active ? 'rgba(99,102,241,0.1)' : 'transparent',
      cursor: 'pointer', width: '100%', textAlign: 'left',
      color: active ? '#4f46e5' : '#374151',
      fontSize: '14px', fontWeight: active ? 700 : 500,
      transition: 'background 150ms, color 150ms',
      marginBottom: '4px',
    }}
    onMouseEnter={(e) => {
      if (!active) e.currentTarget.style.background = 'rgba(99,102,241,0.06)';
    }}
    onMouseLeave={(e) => {
      if (!active) e.currentTarget.style.background = 'transparent';
    }}
  >
    <span style={{ fontSize: '16px' }}>{icon}</span>
    {label}
    {active && (
      <div style={{
        marginLeft: 'auto', width: '4px', height: '18px',
        borderRadius: '2px', background: '#4f46e5',
      }} />
    )}
  </button>
);

const SectionLabel: React.FC<{ icon: string; title: string; subtitle: string }> = ({ icon, title, subtitle }) => (
  <div style={{ marginBottom: '14px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '16px' }}>{icon}</span>
      <span style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>{title}</span>
    </div>
    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '3px', paddingLeft: '24px' }}>
      {subtitle}
    </div>
  </div>
);

const KeyLabel: React.FC<{
  label: string;
  masked: string;
  renderStatus: (m: string) => React.ReactNode;
}> = ({ label, masked, renderStatus }) => (
  <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
    {label}
    {renderStatus(masked)}
  </div>
);

const ApiKeyCard: React.FC<{
  providerColor: string;
  providerName: string;
  hint: string;
  masked: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  renderStatus: (m: string) => React.ReactNode;
}> = ({ providerColor, providerName, hint, masked, value, onChange, placeholder, renderStatus }) => (
  <div style={{
    background: '#fff', borderRadius: '12px', padding: '18px 20px',
    border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', alignItems: 'center',
  }}>
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <div style={{
          width: '10px', height: '10px', borderRadius: '50%', background: providerColor, flexShrink: 0,
        }} />
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{providerName}</span>
      </div>
      <div style={{ fontSize: '12px', color: '#6b7280' }}>{hint}</div>
      <div style={{ marginTop: '6px' }}>{renderStatus(masked)}</div>
    </div>
    <div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
        {masked ? '更新 API Key（留空保持不变）' : '填写 API Key'}
      </div>
      <Input.Password
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={masked ? '留空保持不变' : placeholder}
        size="middle"
      />
    </div>
  </div>
);

export default SettingsPage;
