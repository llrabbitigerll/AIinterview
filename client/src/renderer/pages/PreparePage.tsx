/**
 * PreparePage — Interview preparation & configuration.
 *
 * User uploads resume, selects company/position, optionally runs pre-research, then starts interview.
 */
import React, { useState, useCallback } from 'react';
import {
  App,
  Select,
  Upload,
  Form,
  Tag,
  Switch,
  Tooltip,
  Progress,
  Input,
  Popover,
} from 'antd';
import {
  UploadOutlined,
  RobotOutlined,
  FileTextOutlined,
  CheckCircleFilled,
  BankOutlined,
  ThunderboltOutlined,
  AudioOutlined,
  BookOutlined,
  TrophyOutlined,
  TeamOutlined,
  LockOutlined,
  SearchOutlined,
  ReloadOutlined,
  WarningOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import type { UploadFile } from 'antd/es/upload/interface';
import { useInterviewStore } from '../stores/interviewStore';
import { getInterviewService } from '../services/InterviewService';
import { getResearchService, RESEARCH_PHASE_LABELS, RESEARCH_PHASE_PROGRESS } from '../services/ResearchService';
import type { ResearchStatus } from '../services/ResearchService';
import type { StructuredResume, InterviewRound } from '../types';

const SERVER_URL = import.meta.env.VITE_API_BASE_URL;

const COMPANIES = [
  { label: '字节跳动', value: '字节跳动', icon: '🎵' },
  { label: '腾讯', value: '腾讯', icon: '🐧' },
  { label: '阿里巴巴', value: '阿里巴巴', icon: '🛒' },
  { label: '美团', value: '美团', icon: '🛵' },
  { label: '自定义', value: 'custom', icon: '✏️' },
];

const POSITION_TYPES = [
  { label: '推荐算法', value: 'recommendation_algorithm' },
  { label: '后端开发', value: 'backend' },
  { label: '前端开发', value: 'frontend' },
  { label: '云架构', value: 'cloud_architecture' },
];

const ROUND_OPTIONS = [
  { value: 1, label: '一面', color: '#22c55e' },
  { value: 2, label: '二面', color: '#3b82f6' },
  { value: 3, label: '三面', color: '#8b5cf6' },
  { value: 4, label: 'HR面', color: '#f59e0b' },
];

const FEATURES = [
  { icon: <BookOutlined />, color: '#3b82f6', bg: '#eff6ff', text: '大厂真实题库，覆盖一二三面' },
  { icon: <ThunderboltOutlined />, color: '#8b5cf6', bg: '#f5f3ff', text: 'AI 实时追问，模拟真实对话' },
  { icon: <AudioOutlined />, color: '#10b981', bg: '#f0fdf4', text: '语音识别，全程语音交互' },
  { icon: <TrophyOutlined />, color: '#f59e0b', bg: '#fffbeb', text: '面试结束生成完整能力报告' },
];

const PreparePage: React.FC = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [resumeParsed, setResumeParsed] = useState<StructuredResume | null>(null);
  const [starting, setStarting] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const setResume = useInterviewStore((s) => s.setResume);
  const setAppView = useInterviewStore((s) => s.setAppView);

  // ── Research State ─────────────────────────────────────
  const [researchStatus, setResearchStatus] = useState<ResearchStatus>('not_started');
  const [summaryPreview, setSummaryPreview] = useState<string>('');
  const [researchError, setResearchError] = useState<string>('');
  const [researching, setResearching] = useState(false);
  const [researchInterviewId, setResearchInterviewId] = useState<string>('');

  // ── Resume Upload & Parse ──────────────────────────────
  const handleUpload = useCallback(async (file: UploadFile) => {
    setUploading(true);
    // Reset research state when resume changes
    setResearchStatus('not_started');
    setSummaryPreview('');
    setResearchError('');
    setResearchInterviewId('');
    try {
      const formData = new FormData();
      formData.append('file', file as unknown as Blob);

      const resp = await fetch(`${SERVER_URL}/api/resume/parse`, {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        throw new Error(`Upload failed: ${resp.statusText}`);
      }

      const data = await resp.json();
      const structured = data.structured_json as StructuredResume;
      setResumeParsed(structured);
      setResume(structured);
      message.success('简历解析成功！请检查解析结果');
    } catch (err) {
      message.error(`简历上传失败: ${err}`);
    } finally {
      setUploading(false);
    }
    return false; // prevent antd default upload
  }, [setResume]);

  // ── Start Research ─────────────────────────────────────
  const handleStartResearch = async () => {
    try {
      const values = await form.validateFields(['company', 'positionType']);
      if (!resumeParsed) {
        message.warning('请先上传并解析简历');
        return;
      }
      const allValues = form.getFieldsValue();
      const interviewId = uuidv4();
      setResearchInterviewId(interviewId);
      setResearching(true);
      setResearchStatus('pending');
      setResearchError('');

      const svc = getResearchService();
      await svc.startResearch({
        interviewId,
        company: values.company,
        businessUnit: allValues.businessUnit || values.company,
        positionType: values.positionType,
        candidateTechStack: allValues.techStack || [],
      });

      await svc.pollUntilDone(
        interviewId,
        (status) => {
          setResearchStatus(status.status);
          if (status.summary_preview) setSummaryPreview(status.summary_preview);
          if (status.error) setResearchError(status.error);
        },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setResearchStatus('failed');
      setResearchError(errMsg);
      message.error(`预调研失败: ${errMsg}`);
    } finally {
      setResearching(false);
    }
  };

  // ── Start Interview ────────────────────────────────────
  const handleStart = async () => {
    try {
      const values = await form.validateFields();
      if (!resumeParsed) {
        message.warning('请先上传并解析简历');
        return;
      }

      setStarting(true);
      const service = getInterviewService();
      await service.startInterview({
        company: values.company,
        businessUnit: values.businessUnit || '',
        team: values.team || '',
        positionType: values.positionType,
        round: selectedRound as InterviewRound,
        resume: resumeParsed,
      }, researchInterviewId || undefined);
    } catch (err) {
      // Reset phase back to idle so the user stays on the prepare page
      const { useInterviewStore } = await import('../stores/interviewStore');
      useInterviewStore.getState().setPhase('idle');
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Connection timeout')) {
        message.error('连接服务器超时，请确认后端服务已启动（端口 8000）');
      } else if (errMsg.includes('404') || errMsg.includes('rejected')) {
        message.error('服务器 WebSocket 路由未找到，请重启后端服务');
      } else {
        message.error(`启动面试失败: ${errMsg}`);
      }
      setStarting(false);
    }
  };

  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [roundEnabled, setRoundEnabled] = useState(false);
  const [uploadHover, setUploadHover] = useState(false);

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100%',
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #f0f4ff 0%, #f8f5ff 50%, #f0fdf9 100%)',
    }}>

      {/* ══ LEFT PANEL — Brand & Features ══ */}
      <div style={{
        width: '400px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '48px 40px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative blobs */}
        <div style={{
          position: 'absolute', top: '-60px', left: '-60px',
          width: '280px', height: '280px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '60px', right: '-40px',
          width: '220px', height: '220px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(16,185,129,0.10) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Logo + Brand */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '60px',
            height: '60px',
            borderRadius: '18px',
            background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
            boxShadow: '0 8px 24px rgba(37,99,235,0.28)',
            color: '#fff',
            fontSize: '28px',
            marginBottom: '20px',
          }}>
            <RobotOutlined />
          </div>
          <h1 style={{
            margin: '0 0 6px',
            fontSize: '26px',
            fontWeight: 800,
            color: '#1e1b4b',
            letterSpacing: '-0.5px',
          }}>
            AI Interviewer
          </h1>
          <p style={{
            margin: '0 0 40px',
            fontSize: '14px',
            color: '#6b7280',
            lineHeight: '1.6',
          }}>
            大厂真题模拟 · AI 实时面试官<br />让每次练习都像真实面试
          </p>

          {/* Divider */}
          <div style={{
            height: '1px',
            background: 'linear-gradient(90deg, rgba(99,102,241,0.2), transparent)',
            marginBottom: '32px',
          }} />

          {/* Feature list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '40px' }}>
            {FEATURES.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: '10px',
                  background: f.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: f.color, fontSize: '16px', flexShrink: 0,
                  border: `1px solid ${f.color}22`,
                }}>
                  {f.icon}
                </div>
                <span style={{ fontSize: '13.5px', color: '#374151', lineHeight: '1.5' }}>
                  {f.text}
                </span>
              </div>
            ))}
          </div>

          {/* Stats row */}
          <div style={{
            display: 'flex',
            gap: '12px',
          }}>
            {[
              { num: '5+', label: '大厂岗位' },
              { num: '3', label: '面试轮次' },
              { num: '∞', label: '练习次数' },
            ].map((s, i) => (
              <div key={i} style={{
                flex: 1,
                padding: '14px 12px',
                background: 'rgba(255,255,255,0.7)',
                borderRadius: '12px',
                textAlign: 'center',
                border: '1px solid rgba(99,102,241,0.12)',
                backdropFilter: 'blur(8px)',
              }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#3730a3', lineHeight: 1 }}>{s.num}</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Settings button (bottom-left) ── */}
        <Popover
          open={settingsMenuOpen}
          onOpenChange={setSettingsMenuOpen}
          placement="topLeft"
          trigger="click"
          arrow={false}
          content={
            <div style={{ padding: '4px 0', minWidth: '160px' }}>
              <button
                onClick={() => { setSettingsMenuOpen(false); setAppView('settings'); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  width: '100%', padding: '10px 14px', border: 'none',
                  background: 'transparent', cursor: 'pointer', borderRadius: '6px',
                  fontSize: '14px', color: '#374151', fontWeight: 500,
                  transition: 'background 150ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <SettingOutlined style={{ color: '#6366f1' }} />
                API 设置
              </button>
            </div>
          }
        >
          <button
            style={{
              position: 'absolute', bottom: '24px', left: '40px',
              width: '36px', height: '36px', borderRadius: '10px', border: 'none',
              background: settingsMenuOpen ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: settingsMenuOpen ? '#4f46e5' : '#6b7280',
              fontSize: '16px',
              transition: 'background 150ms, color 150ms',
              zIndex: 10,
            }}
            onMouseEnter={(e) => {
              if (!settingsMenuOpen) {
                e.currentTarget.style.background = 'rgba(99,102,241,0.14)';
                e.currentTarget.style.color = '#4f46e5';
              }
            }}
            onMouseLeave={(e) => {
              if (!settingsMenuOpen) {
                e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
                e.currentTarget.style.color = '#6b7280';
              }
            }}
          >
            <SettingOutlined />
          </button>
        </Popover>
      </div>

      {/* ══ RIGHT PANEL — Config Form ══ */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 48px 24px 24px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: '100%',
          maxWidth: '560px',
          height: '100%',
          maxHeight: '720px',
          background: 'rgba(255,255,255,0.92)',
          borderRadius: '24px',
          boxShadow: '0 20px 60px rgba(37,99,235,0.10), 0 4px 16px rgba(0,0,0,0.06)',
          border: '1px solid rgba(99,102,241,0.10)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Card Header */}
          <div style={{
            padding: '28px 32px 20px',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            background: 'linear-gradient(135deg, rgba(239,246,255,0.8) 0%, rgba(245,243,255,0.8) 100%)',
          }}>
            <h2 style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 700,
              color: '#1e1b4b',
              letterSpacing: '-0.3px',
            }}>
              配置你的面试
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
              填写信息，AI 将为你量身定制面试场景
            </p>
          </div>

          {/* Scrollable form body */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}>
            <Form
              form={form}
              layout="vertical"
              initialValues={{ round: 1 }}
              requiredMark={false}
              style={{ display: 'contents' }}
            >
              {/* ── Section 1: Resume ── */}
              <div>
                <SectionLabel icon={<FileTextOutlined />} color="#3b82f6" title="上传简历" step="01" />
                <Upload
                  accept=".pdf,.docx"
                  maxCount={1}
                  beforeUpload={handleUpload}
                  showUploadList={false}
                >
                  <div
                    onMouseEnter={() => setUploadHover(true)}
                    onMouseLeave={() => setUploadHover(false)}
                    style={{
                      border: `2px dashed ${resumeParsed ? '#22c55e' : uploadHover ? '#3b82f6' : 'rgba(99,102,241,0.25)'}`,
                      borderRadius: '14px',
                      padding: resumeParsed ? '14px 18px' : '22px 18px',
                      background: resumeParsed ? '#f0fdf4' : uploadHover ? '#eff6ff' : '#fafbff',
                      cursor: uploading ? 'wait' : 'pointer',
                      transition: 'all 0.25s ease',
                    }}
                  >
                    {resumeParsed ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '40px', height: '40px', borderRadius: '10px',
                          background: '#dcfce7', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: '#16a34a', fontSize: '18px', flexShrink: 0,
                        }}>
                          <CheckCircleFilled />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: '14px', color: '#15803d' }}>
                              {resumeParsed.candidateProfile?.name || '简历已解析'}
                            </span>
                            {resumeParsed.candidateProfile?.yearsExp && (
                              <Tag color="green" style={{ margin: 0, fontSize: '11px' }}>{resumeParsed.candidateProfile.yearsExp}</Tag>
                            )}
                            {resumeParsed.candidateProfile?.education && (
                              <Tag color="cyan" style={{ margin: 0, fontSize: '11px' }}>{resumeParsed.candidateProfile.education}</Tag>
                            )}
                          </div>
                          <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {resumeParsed.candidateProfile?.currentRole} · 检测到 {resumeParsed.projects?.length || 0} 个项目 · 点击重新上传
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{
                          width: '44px', height: '44px', borderRadius: '12px',
                          background: uploadHover ? '#dbeafe' : '#eff6ff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#3b82f6', fontSize: '20px', margin: '0 auto 10px',
                          transition: 'all 0.2s',
                        }}>
                          {uploading ? <span style={{ fontSize: '14px' }}>···</span> : <UploadOutlined />}
                        </div>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: '#374151' }}>
                          {uploading ? '正在解析简历...' : '点击上传简历'}
                        </p>
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                          支持 PDF · DOCX 格式
                        </p>
                      </div>
                    )}
                  </div>
                </Upload>
              </div>

              {/* ── Section 2: Target Job ── */}
              <div>
                <SectionLabel icon={<BankOutlined />} color="#8b5cf6" title="目标职位" step="02" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <Form.Item
                    name="company"
                    rules={[{ required: true, message: '请选择目标公司' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      placeholder="选择公司"
                      size="large"
                      style={{ width: '100%' }}
                      options={COMPANIES.map(c => ({ label: c.label, value: c.value }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name="positionType"
                    rules={[{ required: true, message: '请选择岗位方向' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      placeholder="选择岗位方向"
                      size="large"
                      style={{ width: '100%' }}
                      options={POSITION_TYPES}
                    />
                  </Form.Item>
                </div>
                <div style={{ marginTop: '12px' }}>
                  <Form.Item name="businessUnit" style={{ marginBottom: 0 }}>
                    <Input
                      placeholder="业务线 / BU（如：抖音电商、飞书、云原生），用于预调研"
                      size="large"
                      style={{ width: '100%' }}
                      allowClear
                    />
                  </Form.Item>
                </div>
                <div style={{ marginTop: '12px' }}>
                  <Form.Item name="techStack" style={{ marginBottom: 0 }}>
                    <Select
                      mode="tags"
                      placeholder="技术栈标签，如 React · Go · MySQL（可选）"
                      size="large"
                      style={{ width: '100%' }}
                      options={[
                        'C', 'C++', 'C#', 'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Golang', 'Rust', 'Kotlin', 'Swift',
                        'Ruby', 'PHP', 'Scala', 'SQL', 'MySQL', 'PostgreSQL', 'Redis', 'Kafka', 'Docker', 'Kubernetes',
                        'Node.js', 'React', 'Vue', 'Angular', 'Flutter', 'Dart', 'Elixir', 'Scala'
                      ].map(v => ({ value: v, label: v }))}
                    />
                  </Form.Item>
                </div>
              </div>

              {/* ── Section 3: Round ── */}
              <div>
                {/* Toggle Row — color follows selected round via IIFE */}
                {(() => {
                  const ac = roundEnabled
                    ? (ROUND_OPTIONS.find(r => r.value === selectedRound)?.color ?? '#6b7280')
                    : '#6b7280';
                  const hex2rgb = (h: string) => {
                    const v = parseInt(h.replace('#',''), 16);
                    return `${(v>>16)&255},${(v>>8)&255},${v&255}`;
                  };
                  const rgb = hex2rgb(ac);
                  return (
                    <>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  background: roundEnabled
                    ? `linear-gradient(135deg, rgba(${rgb},0.07) 0%, rgba(${rgb},0.14) 100%)`
                    : '#f9fafb',
                  borderRadius: roundEnabled ? '14px 14px 0 0' : '14px',
                  borderTop: `1px solid ${roundEnabled ? `rgba(${rgb},0.28)` : 'rgba(0,0,0,0.06)'}`,
                  borderRight: `1px solid ${roundEnabled ? `rgba(${rgb},0.28)` : 'rgba(0,0,0,0.06)'}`,
                  borderBottom: roundEnabled ? 'none' : `1px solid rgba(0,0,0,0.06)`,
                  borderLeft: `1px solid ${roundEnabled ? `rgba(${rgb},0.28)` : 'rgba(0,0,0,0.06)'}`,
                  transition: 'background 0.3s ease, border-color 0.3s ease, border-radius 0.25s ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '10px',
                      background: roundEnabled ? `rgba(${rgb},0.18)` : '#f3f4f6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: roundEnabled ? ac : '#9ca3af',
                      fontSize: '16px',
                      transition: 'background 0.3s ease, color 0.3s ease',
                    }}>
                      <TeamOutlined />
                    </div>
                    <div>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#1f2937' }}>指定面试轮次</div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                        {roundEnabled
                          ? `已选：${ROUND_OPTIONS.find(r => r.value === selectedRound)?.label}`
                          : '从一面开始，进行完整的三轮面试'}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={roundEnabled}
                    onChange={(v) => {
                      setRoundEnabled(v);
                      if (v) form.setFieldValue('round', selectedRound);
                    }}
                    style={{ background: roundEnabled ? ac : undefined, transition: 'background 0.3s ease' }}
                  />
                </div>

                {/* Collapsible Round Buttons */}
                <div style={{
                  maxHeight: roundEnabled ? '80px' : '0px',
                  overflow: 'hidden',
                  opacity: roundEnabled ? 1 : 0,
                  transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease, border-color 0.3s ease, background 0.3s ease',
                  borderTop: 'none',
                  borderRight: roundEnabled ? `1px solid rgba(${rgb},0.28)` : '1px solid transparent',
                  borderBottom: roundEnabled ? `1px solid rgba(${rgb},0.28)` : '1px solid transparent',
                  borderLeft: roundEnabled ? `1px solid rgba(${rgb},0.28)` : '1px solid transparent',
                  borderRadius: '0 0 14px 14px',
                  background: roundEnabled ? `rgba(${rgb},0.04)` : '#fff',
                }}>
                  <div style={{ display: 'flex', gap: '10px', padding: '12px 16px 14px' }}>
                    {ROUND_OPTIONS.map(r => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => {
                          setSelectedRound(r.value);
                          form.setFieldValue('round', r.value);
                        }}
                        style={{
                          flex: 1,
                          padding: '9px 6px',
                          border: `2px solid ${selectedRound === r.value ? r.color : 'rgba(0,0,0,0.08)'}`,
                          borderRadius: '12px',
                          background: selectedRound === r.value ? `${r.color}15` : '#fff',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span style={{
                          width: '22px', height: '22px', borderRadius: '50%',
                          background: selectedRound === r.value ? r.color : '#e5e7eb',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700,
                          color: selectedRound === r.value ? '#fff' : '#9ca3af',
                          transition: 'all 0.2s',
                        }}>
                          {r.value}
                        </span>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: selectedRound === r.value ? 600 : 400,
                          color: selectedRound === r.value ? r.color : '#6b7280',
                          transition: 'all 0.2s',
                        }}>
                          {r.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                    </>
                  );
                })()}
              </div>

            </Form>
          </div>

          {/* ── Card Footer: Research + Start Button ── */}
          <div style={{
            padding: '20px 32px 24px',
            borderTop: '1px solid rgba(0,0,0,0.05)',
            background: 'rgba(255,255,255,0.6)',
          }}>

            {/* === State: researching (in progress) === */}
            {researching && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', color: '#4338ca', fontWeight: 500 }}>
                    🔍 {RESEARCH_PHASE_LABELS[researchStatus]}
                  </span>
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                    {RESEARCH_PHASE_PROGRESS[researchStatus]}%
                  </span>
                </div>
                <Progress
                  percent={RESEARCH_PHASE_PROGRESS[researchStatus]}
                  status="active"
                  strokeColor={{ from: '#2563eb', to: '#7c3aed' }}
                  showInfo={false}
                  size="small"
                />
              </div>
            )}

            {/* === State: completed — show summary preview card === */}
            {researchStatus === 'completed' && summaryPreview && (
              <div style={{
                marginBottom: '14px',
                padding: '12px 14px',
                background: 'linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)',
                borderRadius: '12px',
                border: '1px solid rgba(34,197,94,0.25)',
                maxHeight: '100px',
                overflowY: 'auto',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <CheckCircleFilled style={{ color: '#16a34a', fontSize: '13px' }} />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#15803d' }}>预调研完成 — 情报摘要</span>
                </div>
                <p style={{ margin: 0, fontSize: '11.5px', color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                  {summaryPreview}
                </p>
              </div>
            )}

            {/* === State: failed === */}
            {researchStatus === 'failed' && (
              <div style={{
                marginBottom: '12px',
                padding: '10px 12px',
                background: '#fef2f2',
                borderRadius: '10px',
                border: '1px solid rgba(239,68,68,0.2)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}>
                <WarningOutlined style={{ color: '#dc2626', marginTop: '1px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#dc2626' }}>调研失败</div>
                  <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>{researchError || '未知错误'}</div>
                </div>
              </div>
            )}

            {/* === Primary Action Button === */}
            {researchStatus === 'not_started' || researchStatus === 'failed' ? (
              // Research button
              <>
                <Tooltip title={!resumeParsed ? '请先上传简历' : ''}>
                  <button
                    type="button"
                    onClick={handleStartResearch}
                    disabled={!resumeParsed || researching}
                    style={{
                      width: '100%',
                      height: '50px',
                      border: 'none',
                      borderRadius: '14px',
                      background: resumeParsed
                        ? 'linear-gradient(135deg, #059669 0%, #2563eb 100%)'
                        : '#e5e7eb',
                      color: resumeParsed ? '#fff' : '#9ca3af',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: resumeParsed ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      boxShadow: resumeParsed ? '0 4px 20px rgba(5,150,105,0.28)' : 'none',
                      transition: 'all 0.25s ease',
                    }}
                  >
                    {researchStatus === 'failed'
                      ? <><ReloadOutlined />重新调研</>
                      : <><SearchOutlined />开始预调研</>}
                  </button>
                </Tooltip>
                <Tooltip title={!resumeParsed ? '请先上传简历' : ''}>
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={!resumeParsed || starting}
                    style={{
                      width: '100%',
                      marginTop: '10px',
                      height: '38px',
                      border: '1px solid rgba(99,102,241,0.25)',
                      borderRadius: '10px',
                      background: 'transparent',
                      color: resumeParsed ? '#6366f1' : '#d1d5db',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: resumeParsed && !starting ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s',
                    }}
                  >
                    <ThunderboltOutlined />跳过调研，直接开始面试
                  </button>
                </Tooltip>
              </>
            ) : researchStatus === 'completed' ? (
              // Start Interview button (research done)
              <Tooltip title={!resumeParsed ? '请先上传简历' : ''}>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!resumeParsed || starting}
                  style={{
                    width: '100%',
                    height: '50px',
                    border: 'none',
                    borderRadius: '14px',
                    background: resumeParsed
                      ? 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)'
                      : '#e5e7eb',
                    color: resumeParsed ? '#fff' : '#9ca3af',
                    fontSize: '15px',
                    fontWeight: 600,
                    cursor: resumeParsed && !starting ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: resumeParsed ? '0 4px 20px rgba(37,99,235,0.30)' : 'none',
                    transition: 'all 0.25s ease',
                  }}
                >
                  {starting ? (
                    <>
                      <span style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                      正在连接 AI 面试官...
                    </>
                  ) : (
                    <><ThunderboltOutlined />开始面试（带情报增强）</>
                  )}
                </button>
              </Tooltip>
            ) : (
              // Researching state — disabled button
              <button
                type="button"
                disabled
                style={{
                  width: '100%',
                  height: '50px',
                  border: 'none',
                  borderRadius: '14px',
                  background: '#e5e7eb',
                  color: '#9ca3af',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.15)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                预调研进行中...
              </button>
            )}

            {!resumeParsed && researchStatus === 'not_started' && (
              <p style={{ margin: '10px 0 0', textAlign: 'center', fontSize: '12px', color: '#d1d5db' }}>
                <LockOutlined style={{ marginRight: '4px' }} />
                上传简历后解锁预调研
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Helper: Section Label ── */
const SectionLabel: React.FC<{
  icon: React.ReactNode;
  color: string;
  title: string;
  step: string;
}> = ({ icon, color, title, step }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
    <div style={{
      width: '24px', height: '24px', borderRadius: '7px',
      background: `${color}18`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: color, fontSize: '13px',
    }}>
      {icon}
    </div>
    <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#374151' }}>{title}</span>
    <span style={{ fontSize: '11px', color: '#d1d5db', fontWeight: 500, marginLeft: 'auto' }}>
      STEP {step}
    </span>
  </div>
);

/* Inject spin keyframe for loading spinner */
if (typeof document !== 'undefined' && !document.getElementById('pp-spin-style')) {
  const s = document.createElement('style');
  s.id = 'pp-spin-style';
  s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}

export default PreparePage;
