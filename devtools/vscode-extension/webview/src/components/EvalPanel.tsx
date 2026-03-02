import React, { useState } from 'react';
import { useStore } from '../store';
import type { EvalResultPayload } from '../types';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false });
}

function scoreClass(score: number): string {
  if (score >= 5) return 'score-5';
  if (score >= 4) return 'score-4';
  if (score >= 3) return 'score-3';
  if (score >= 2) return 'score-2';
  return 'score-1';
}

const FLUENCY_COLORS: Record<string, string> = {
  smooth: '#4ec9b0',
  normal: '#9cdcfe',
  hesitant: '#dcdcaa',
  poor: '#f44747',
};

function EvalRecord({ item }: { item: { timestamp: number; session_id: string; payload: EvalResultPayload } }) {
  const [expanded, setExpanded] = useState(false);
  const p = item.payload;
  const fc = FLUENCY_COLORS[p.fluency_tag] ?? '#808080';

  return (
    <div className="eval-record">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <span style={{ color: '#808080', minWidth: 80 }}>{fmt(item.timestamp)}</span>
        <span className={`eval-score-5 ${scoreClass(p.quality_score_5)}`}>{p.quality_score_5}/5</span>
        <span style={{ color: '#b5cea8', minWidth: 40 }}>{p.quality_score_10_raw.toFixed(1)}/10</span>
        <span style={{ color: '#dcdcaa', minWidth: 60 }}>{p.question_type}</span>
        <span style={{ color: fc, minWidth: 70 }}>{p.fluency_tag}</span>
        <span style={{ color: '#808080', minWidth: 60 }}>{Math.round(p.duration_seconds)}s</span>
        <span style={{ color: '#9cdcfe', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.question_text}
        </span>
        <span style={{ color: '#555' }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 8 }}>
          {/* Question */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#808080', fontSize: 10, marginBottom: 2 }}>问题</div>
            <div style={{ color: '#d4d4d4', lineHeight: 1.5 }}>{p.question_text}</div>
          </div>

          {/* Answer */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#808080', fontSize: 10, marginBottom: 2 }}>候选人回答 (前300字)</div>
            <div style={{ color: '#dcdcaa', lineHeight: 1.5 }}>{p.answer_text}</div>
          </div>

          {/* Rubric scores */}
          {Object.keys(p.rubric_scores ?? {}).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#808080', fontSize: 10, marginBottom: 4 }}>评分维度</div>
              <div className="bb-grid">
                {(Object.entries(p.rubric_scores) as [string, number][]).map(([dim, score]) => (
                  <div key={dim} className="bb-field">
                    <div className="bb-field-key">{dim}</div>
                    <div className={`bb-field-val ${scoreClass(score)}`}>{score}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live judgment */}
          {p.live_judgment && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#808080', fontSize: 10, marginBottom: 2 }}>实时判断</div>
              <div style={{ color: '#ce9178', lineHeight: 1.5 }}>{p.live_judgment}</div>
            </div>
          )}

          {/* Key defects */}
          {p.key_defects?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#f44747', fontSize: 10, marginBottom: 2 }}>关键缺陷</div>
              {p.key_defects.map((d, i) => (
                <div key={i} style={{ color: '#f44747', paddingLeft: 8 }}>• {d}</div>
              ))}
            </div>
          )}

          {/* Follow-up hints */}
          {p.follow_up_hints?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#dcdcaa', fontSize: 10, marginBottom: 2 }}>追问建议</div>
              {p.follow_up_hints.map((h, i) => (
                <div key={i} style={{ color: '#dcdcaa', paddingLeft: 8 }}>• {h}</div>
              ))}
            </div>
          )}

          {/* Timing */}
          <div style={{ color: '#808080', fontSize: 10 }}>
            作答 {Math.round(p.duration_seconds)}s
            &nbsp;|&nbsp;
            开口延迟 {p.thinking_time_to_first_word_seconds.toFixed(1)}s
            &nbsp;|&nbsp;
            {p.question_id}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EvalPanel() {
  const evalResults = useStore((s) => s.evalResults);
  const [search, setSearch] = useState('');

  const filtered = [...evalResults]
    .reverse()
    .filter((e) => !search || JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));

  // Stats
  const avg = evalResults.length > 0
    ? (evalResults.reduce((sum, e) => sum + e.payload.quality_score_5, 0) / evalResults.length).toFixed(1)
    : '-';

  return (
    <>
      <div className="search-bar">
        <input
          placeholder="搜索评估记录..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div style={{ padding: '4px 8px', background: '#252526', borderBottom: '1px solid #333', fontSize: 10, color: '#808080' }}>
        共 {evalResults.length} 题已评估
        &nbsp;|&nbsp;
        平均分 <span style={{ color: '#4ec9b0' }}>{avg}/5</span>
      </div>
      <div className="panel-scroll">
        {filtered.length === 0 && <div className="empty-state">暂无评估结果</div>}
        {filtered.map((item, i) => (
          <EvalRecord key={`${item.timestamp}-${i}`} item={item} />
        ))}
      </div>
    </>
  );
}
