/**
 * ReportPage — Post-interview report & analysis.
 * Displays full backend posthoc report (density, per-question feedback,
 * fluency summary, efficiency matrix, position fit) + client-side fluency data.
 */
import React from 'react';
import {
  Button, Card, Typography, Descriptions, Tag, Progress,
  Space, Table, Alert, Collapse, Divider, Badge,
} from 'antd';
import type { CollapseProps } from 'antd';
import { RedoOutlined, CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useInterviewStore } from '../stores/interviewStore';

const { Title, Text, Paragraph } = Typography;

// ── helpers ────────────────────────────────────────────────

const scoreColor = (s: number) =>
  s >= 80 ? '#52c41a' : s >= 60 ? '#faad14' : '#ff4d4f';

const questionTypeLabel = (t: string) =>
  t === 'P' || t === 'project_drill'  ? '项目' :
  t === 'T' || t === 'general_tech'   ? '技术' :
  t === 'C' || t === 'coding'         ? '编程' : t;

const densityConfig: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
  sufficient:   { color: 'success', icon: <CheckCircleOutlined />, text: '题量充足' },
  insufficient: { color: 'warning', icon: <WarningOutlined />,     text: '题量不足' },
  veto:         { color: 'error',   icon: <CloseCircleOutlined />, text: '题量严重不足' },
};

// ── Component ──────────────────────────────────────────────

const ReportPage: React.FC = () => {
  const { messages, latestFluency, blackboard, config, report, reset } = useInterviewStore();

  // Use the last user message's fluency snapshot as the definitive report source.
  // latestFluency can be overwritten to 0 by VAD speechEnd events that fire after
  // the answer is sent and fluency.reset() clears speechRateHistory.
  const reportFluency = messages
    .filter((m) => m.role === 'user' && m.fluency)
    .at(-1)?.fluency ?? latestFluency;

  // Safely access nested report fields
  const posthoc     = (report?.posthoc_analysis ?? {}) as Record<string, unknown>;
  const qReports    = (posthoc.question_reports  ?? []) as Array<Record<string, unknown>>;
  const fluSummary  = (posthoc.fluency_summary   ?? {}) as Record<string, unknown>;
  const effMatrix   = (posthoc.efficiency_matrix ?? []) as Array<Record<string, unknown>>;
  const posFit      = (posthoc.position_fit      ?? {}) as Record<string, unknown>;
  const conCheck    = (posthoc.consistency_check ?? {}) as Record<string, unknown>;
  const qSummary    = (report?.question_summary  ?? []) as Array<Record<string, unknown>>;
  const densityVerdict = (report?.density_verdict ?? '') as string;
  const densityDetails = (report?.density_details ?? {}) as Record<string, unknown>;
  const totalDurationMin = (report?.total_duration_minutes ?? 0) as number;

  const totalUserMessages  = messages.filter((m) => m.role === 'user').length;
  const totalAgentMessages = messages.filter((m) => m.role === 'agent_b' || m.role === 'agent_c').length;

  // Overall score: derive from normal/warning/critical counts, fall back to client snapshot
  const fluTotal = (fluSummary.total_questions as number | undefined) ?? 0;
  const fluAvg = fluTotal > 0
    ? Math.round(
        (((fluSummary.normal   as number) ?? 0) * 100
        + ((fluSummary.warning  as number) ?? 0) *  60
        + ((fluSummary.critical as number) ?? 0) *  20) / fluTotal
      )
    : undefined;
  const overallScore = Math.round(fluAvg != null ? fluAvg : (reportFluency?.overallScore ?? 0));
  const topColor = scoreColor(overallScore);

  const densityCfg = densityConfig[densityVerdict] ?? densityConfig['insufficient'];

  return (
    <div style={{ padding: '32px 48px', maxWidth: 860, margin: '0 auto', overflowY: 'auto', height: '100%', flex: 1, minHeight: 0 }}>

      {/* ── Header ── */}
      <Title level={2} style={{ marginBottom: 4 }}>📊 面试复盘报告</Title>
      <Text type="secondary">
        {config?.company}{config?.businessUnit ? ` · ${config.businessUnit}` : ''}{config?.positionType ? ` · ${config.positionType}` : ''}
        {totalDurationMin > 0 && <span>  &nbsp;·&nbsp; 共 {totalDurationMin.toFixed(1)} 分钟</span>}
      </Text>

      {/* ── No report data fallback ── */}
      {!report && (
        <Alert
          type="warning"
          showIcon
          message="报告数据不完整"
          description="服务端深度分析暂不可用，以下仅展示客户端基础统计数据。"
          style={{ marginTop: 16 }}
        />
      )}

      {/* ── Row 1: score + density ── */}
      <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
        <Card style={{ flex: 1, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>综合流畅度</Text>
          <Progress
            type="circle"
            percent={overallScore}
            size={110}
            strokeColor={topColor}
            style={{ marginTop: 12 }}
            format={(pct) => (
              <span style={{ fontSize: 26, fontWeight: 700, color: topColor }}>{pct}</span>
            )}
          />
        </Card>

        <Card style={{ flex: 2 }}>
          <Descriptions column={2} size="small" title="题量概览">
            <Descriptions.Item label="总题数">
              {blackboard?.totalQuestions ?? totalAgentMessages}
            </Descriptions.Item>
            <Descriptions.Item label="你的回答">
              {totalUserMessages}
            </Descriptions.Item>
            <Descriptions.Item label="项目题(P)">
              {(densityDetails.p_count as number | undefined) ?? blackboard?.projectDrillCount ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="技术题(T)">
              {(densityDetails.t_count as number | undefined) ?? blackboard?.generalTechCount ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="编程题(C)">
              {(densityDetails.c_count as number | undefined) ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="题量评估">
              {densityVerdict ? (
                <Badge
                  status={densityCfg.color as 'success' | 'warning' | 'error'}
                  text={densityCfg.text}
                />
              ) : '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </div>

      {/* ── Per-question feedback ── */}
      {qReports.length > 0 && (
        <Card title="逐题反馈" style={{ marginTop: 16 }}>
          <Collapse
            ghost
            items={qReports.map((qr, idx) => {
              const score = (qr.quality_score_5 as number | undefined) ?? 0;
              const feedbackRaw = qr.feedback as { text?: string } | string | undefined;
              const feedback = typeof feedbackRaw === 'string' ? feedbackRaw : (feedbackRaw?.text ?? '');
              const qs = qSummary[idx];
              const qtText = (qr.question_text as string | undefined) ?? '';
              const qType = qtText
                ? (qtText.length > 15 ? qtText.slice(0, 15) + '…' : qtText)
                : qs ? questionTypeLabel(qs.type as string) : `第 ${idx + 1} 题`;
              const duration = qs ? `${(((qs.duration_seconds as number) ?? 0) / 60).toFixed(1)} min` : '';
              const overtime = qs?.overtime as boolean | undefined;
              const fluency = (qr.fluency as Record<string, unknown> | undefined);
              const sc = scoreColor(score * 20);
              const fTag = (fluency?.fluency_tag as string | undefined) ?? 'normal';
              const allAlerts = [
                ...((fluency?.danger_flags     as string[] | undefined) ?? []),
                ...((fluency?.suggestion_flags as string[] | undefined) ?? []),
              ];
              return {
                key: idx,
                label: (
                  <Space>
                    <Tag color={sc} style={{ fontWeight: 600 }}>{score}/5</Tag>
                    <Text strong>{qType}</Text>
                    {duration && <Text type="secondary" style={{ fontSize: 12 }}>{duration}</Text>}
                    {overtime && <Tag color="orange">超时</Tag>}
                  </Space>
                ),
                children: (
                  <div>
                    {/* 题目内容 */}
                    {(qr.question_text as string | undefined) && (
                      <div style={{ marginBottom: 8, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>题目：</Text>
                        <Paragraph style={{ margin: '4px 0 0', fontSize: 13 }}>{qr.question_text as string}</Paragraph>
                      </div>
                    )}
                    {/* 面试者回答 */}
                    {(qr.answer_text as string | undefined) && (
                      <div style={{ marginBottom: 8, padding: '8px 12px', background: '#e6f4ff', borderRadius: 6 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>你的回答：</Text>
                        <Paragraph style={{ margin: '4px 0 0', fontSize: 13 }}>{qr.answer_text as string}</Paragraph>
                      </div>
                    )}
                    {feedback && <Paragraph style={{ marginBottom: 8 }}>{feedback}</Paragraph>}
                    {fluency && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        流畅度：
                        <Tag
                          color={fTag === 'critical' ? 'red' : fTag === 'warning' ? 'orange' : 'green'}
                          style={{ marginLeft: 4 }}
                        >
                          {fTag}
                        </Tag>
                        {allAlerts.length > 0 ? `  ⚠ ${allAlerts.join('；')}` : ''}
                      </Text>
                    )}
                  </div>
                ),
              } as NonNullable<CollapseProps['items']>[number];
            })}
          />
        </Card>
      )}

      {/* ── Efficiency matrix ── */}
      {effMatrix.length > 0 && (
        <Card title="思考效率矩阵" style={{ marginTop: 16 }}>
          <Table
            dataSource={effMatrix.map((row, i) => ({ ...row, key: i }))}
            size="small"
            pagination={false}
            columns={[
              { title: '题型', dataIndex: 'category', render: (v: string) =>
                  v === 'scenario' ? '项目' : v === 'design' ? '编程' : '技术' },
              { title: '效率标签', dataIndex: 'tag', render: (v: string) => <Tag>{v}</Tag> },
              { title: '思考时长(s)', dataIndex: 'thinking_time_seconds', render: (v: number) => v?.toFixed(1) ?? '—' },
              { title: '得分', dataIndex: 'quality_score_5', render: (v: number) => {
                if (v == null) return '—';
                return <Tag color={scoreColor(v * 20)}>{v}/5</Tag>;
              }},
            ]}
          />
        </Card>
      )}

      {/* ── Fluency summary ── */}
      {(fluTotal > 0 || reportFluency) && (
        <Card title="表达流畅度" style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {/* Server-side summary (derived from normal/warning/critical counts) */}
            {fluTotal > 0 && fluAvg != null && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text>整场综合流畅度</Text>
                  <Text strong>{fluAvg} / 100</Text>
                </div>
                <Progress
                  percent={fluAvg}
                  strokeColor={scoreColor(fluAvg)}
                  size="small"
                />
                {(fluSummary.alerts as string[] | undefined)?.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="流畅度警告"
                    description={(fluSummary.alerts as string[]).join('；')}
                    style={{ marginTop: 8 }}
                  />
                ) : null}
                <Divider style={{ margin: '8px 0' }} />
              </>
            )}
            {/* Client-side snapshot (from last sent answer, immune to post-reset VAD events) */}
            {reportFluency && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text>语速</Text>
                  <Text>{reportFluency.speechRate} 词/分钟</Text>
                </div>
                <Progress percent={reportFluency.speechRateScore} strokeColor={reportFluency.speechRateScore >= 70 ? '#52c41a' : '#faad14'} size="small" />

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text>停顿质量</Text>
                  <Text>{reportFluency.pauseCount} 次长停顿</Text>
                </div>
                <Progress percent={reportFluency.pauseScore} strokeColor={reportFluency.pauseScore >= 70 ? '#52c41a' : '#faad14'} size="small" />

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text>填充词</Text>
                  <Text>{reportFluency.fillerCount} 次</Text>
                </div>
                <Progress percent={reportFluency.fillerScore} strokeColor={reportFluency.fillerScore >= 70 ? '#52c41a' : '#faad14'} size="small" />

                {Object.keys(reportFluency.fillerBreakdown).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>高频填充词：</Text>
                    {Object.entries(reportFluency.fillerBreakdown)
                      .sort(([, a], [, b]) => b - a).slice(0, 5)
                      .map(([word, count]) => <Tag key={word}>{word} ×{count}</Tag>)}
                  </div>
                )}
              </>
            )}
          </Space>
        </Card>
      )}

      {/* ── Consistency check ── */}
      {conCheck.flagged != null && (
        <Card
          title="反背诵检测"
          style={{ marginTop: 16 }}
          extra={
            <Tag color={(conCheck.flagged as boolean) ? 'orange' : 'green'}>
              {(conCheck.flagged as boolean) ? '疑似背诵' : '正常'}
            </Tag>
          }
        >
          {(conCheck.flagged as boolean) ? (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              {(conCheck.message as string | undefined) || '疑似背诵，建议加强项目复盘深度'}
            </Paragraph>
          ) : (
            <Paragraph type="secondary" style={{ margin: 0 }}>未发现明显背诵特征：知识题反应速度与项目题深度表现均在合理范围内。</Paragraph>
          )}
        </Card>
      )}

      {/* ── Position fit ── */}
      {(posFit.company_focus || posFit.suggestion) && (
        <Card title="岗位匹配分析" style={{ marginTop: 16 }}>
          {(posFit.company_focus as string | undefined) && (
            <Tag color="blue" style={{ marginBottom: 8, fontSize: 13, padding: '2px 10px' }}>
              {posFit.company_focus as string}
            </Tag>
          )}
          {(posFit.suggestion as string | undefined) && (
            <Paragraph style={{ margin: '8px 0 0' }}>{posFit.suggestion as string}</Paragraph>
          )}
        </Card>
      )}

      {/* ── Conversation review ── */}
      <Card title="对话回顾" style={{ marginTop: 16 }}>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {messages.length === 0 ? (
            <Text type="secondary">暂无对话记录</Text>
          ) : (
            messages.map((msg, i) => (
              <div key={msg.id || i} style={{ marginBottom: 12 }}>
                <Tag
                  color={
                    msg.role === 'user'    ? 'blue'    :
                    msg.role === 'agent_b' ? 'purple'  :
                    msg.role === 'agent_c' ? 'magenta' : 'default'
                  }
                >
                  {msg.role === 'user'    ? '你'    :
                   msg.role === 'agent_b' ? '技术官' :
                   msg.role === 'agent_c' ? '业务官' : '系统'}
                </Tag>
                <Paragraph
                  style={{ margin: '4px 0 0 0', fontSize: 13 }}
                  ellipsis={{ rows: 3, expandable: true }}
                >
                  {msg.content}
                </Paragraph>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* ── Actions ── */}
      <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', paddingBottom: 32 }}>
        <Button type="primary" icon={<RedoOutlined />} onClick={reset}>
          重新开始
        </Button>
      </div>
    </div>
  );
};

export default ReportPage;
