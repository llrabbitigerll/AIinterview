/**
 * FluencyDashboard — Real-time fluency metrics sidebar widget.
 */
import React, { useMemo } from 'react';
import { Progress, Space, Typography, Tag, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { FluencySnapshot } from '../types';

const { Text } = Typography;

const PAUSE_TOOLTIP = (
  <div style={{ fontSize: 11, lineHeight: 1.7 }}>
    <b>停顿判定标准</b><br />
    · 静音 600ms → 潜在停顿（记录，不扣分）<br />
    · 静音 ≥ 2100ms → <b>确认停顿</b>（计入统计）<br />
    · 静音 ≥ 4000ms → <b>长停顿</b>（思路中断标记）<br />
    · 仅含填充词的片段 → 填充词停顿
  </div>
);

const RATE_TOOLTIP = (
  <div style={{ fontSize: 11, lineHeight: 1.7 }}>
    <b>语速判定标准</b><br />
    · 理想范围：120–180 字/分钟<br />
    · 中文每字计为1词，英文按空格分词<br />
    · 低于 100 → 偏慢；高于 180 → 偏快
  </div>
);

const FILLER_TOOLTIP = (
  <div style={{ fontSize: 11, lineHeight: 1.7 }}>
    <b>填充词列表</b><br />
    中文：嗯、啊、呃、那个、然后、就是、所以、<br />
    其实、对吧、这样、的话、可能、大概、反正、<br />
    总之、怎么说、就是说<br />
    英文：um, uh, like, you know, basically,<br />
    actually, so, well, I mean
  </div>
);

interface FluencyDashboardProps {
  snapshot: FluencySnapshot | null;
}

const FluencyDashboard: React.FC<FluencyDashboardProps> = ({ snapshot }) => {
  if (!snapshot) {
    return (
      <div className="fluency-dashboard" style={{ textAlign: 'center', padding: '12px 0' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>等待语音输入…</Text>
      </div>
    );
  }

  const scoreColor = useMemo(() => {
    if (snapshot.overallScore >= 80) return '#52c41a';
    if (snapshot.overallScore >= 60) return '#faad14';
    return '#ff4d4f';
  }, [snapshot.overallScore]);

  const speechRateLabel = useMemo(() => {
    const rate = snapshot.speechRate;
    if (rate === 0) return '未检测';
    if (rate < 100) return '偏慢';
    if (rate > 180) return '偏快';
    return '适中';
  }, [snapshot.speechRate]);

  const speechRateDisplay = snapshot.speechRate === 0 ? '--' : `${snapshot.speechRate} wpm`;

  // Pause display: "N次" + long pause badge if any
  const pauseDisplay = `${snapshot.pauseCount} 次`;
  const hasLongPauses = snapshot.longPauseCount > 0;
  const hasFillerPauses = snapshot.fillerPauseCount > 0;

  return (
    <div className="fluency-dashboard" style={{ padding: '4px 0' }}>
      {/* Overall score ring */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <Progress
          type="circle"
          percent={snapshot.overallScore}
          size={64}
          strokeColor={scoreColor}
          format={(p) => <span style={{ fontSize: 16, fontWeight: 700 }}>{p}</span>}
        />
        <div style={{ marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>综合流畅度</Text>
        </div>
      </div>

      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        {/* Speech Rate */}
        <MetricRow
          label="语速"
          tooltip={RATE_TOOLTIP}
          value={speechRateDisplay}
          score={snapshot.speechRateScore}
          tag={speechRateLabel}
        />

        {/* Pause — with long/filler badges */}
        <MetricRow
          label="停顿"
          tooltip={PAUSE_TOOLTIP}
          value={pauseDisplay}
          score={snapshot.pauseScore}
          extra={
            <>
              {hasLongPauses && (
                <Tag color="red" style={{ marginLeft: 4, fontSize: 10, lineHeight: '14px' }}>
                  长停顿×{snapshot.longPauseCount}
                </Tag>
              )}
              {hasFillerPauses && (
                <Tag color="orange" style={{ marginLeft: 4, fontSize: 10, lineHeight: '14px' }}>
                  填充停顿×{snapshot.fillerPauseCount}
                </Tag>
              )}
            </>
          }
        />

        {/* Fillers */}
        <MetricRow
          label="填充词"
          tooltip={FILLER_TOOLTIP}
          value={`${snapshot.fillerCount} 次`}
          score={snapshot.fillerScore}
        />
      </Space>

      {/* Top fillers */}
      {Object.keys(snapshot.fillerBreakdown).length > 0 && (
        <div style={{ marginTop: 8, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
          <Text style={{ fontSize: 10, color: 'var(--text-secondary)' }}>高频：</Text>
          <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(snapshot.fillerBreakdown)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 4)
              .map(([word, count]) => (
                <Tag key={word} style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
                  {word}×{count}
                </Tag>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ---- Metric row with optional tooltip and extra badges ---- */
const MetricRow: React.FC<{
  label: string;
  value: string;
  score: number;
  tag?: string;
  tooltip?: React.ReactNode;
  extra?: React.ReactNode;
}> = ({ label, value, score, tag, tooltip, extra }) => {
  const color = score >= 70 ? '#52c41a' : score >= 50 ? '#faad14' : '#ff4d4f';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Text style={{ color: 'var(--text-secondary)' }}>{label}</Text>
          {tooltip && (
            <Tooltip title={tooltip} placement="left">
              <QuestionCircleOutlined style={{ fontSize: 10, color: 'var(--text-secondary)', cursor: 'help' }} />
            </Tooltip>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Text style={{ fontWeight: 600 }}>{value}</Text>
          {tag && (
            <Tag
              color={score >= 70 ? 'green' : score >= 50 ? 'orange' : 'red'}
              style={{ marginLeft: 4, fontSize: 10, lineHeight: '14px' }}
            >
              {tag}
            </Tag>
          )}
          {extra}
        </span>
      </div>
      <Progress
        percent={score}
        size="small"
        showInfo={false}
        strokeColor={color}
        style={{ marginTop: 2 }}
      />
    </div>
  );
};

export default FluencyDashboard;
