import React, { useState } from 'react';
import { useStore } from '../store';
import type { DevToolsEvent } from '../types';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false, fractionalSecondDigits: 2 } as Intl.DateTimeFormatOptions);
}

const MSG_COLORS: Record<string, string> = {
  interview_ready: '#4ec9b0',
  agent_response: '#4ec9b0',
  tts_start: '#c586c0',
  tts_audio_chunk: '#555',
  tts_done: '#c586c0',
  transcription: '#dcdcaa',
  state_sync: '#569cd6',
  interview_end: '#f44747',
  init_interview: '#ce9178',
  text_input: '#dcdcaa',
  speech_end: '#dcdcaa',
  control: '#ce9178',
  error: '#f44747',
  ping: '#333',
  pong: '#333',
  asr_status: '#9cdcfe',
  code_challenge: '#c586c0',
  qa_session: '#b5cea8',
};

function WsMsgRow({ ev }: { ev: DevToolsEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isC2S = ev.type === 'ws_c2s';
  const msgType = (ev.payload as Record<string, string>).type ?? ev.type;
  const color = MSG_COLORS[msgType] ?? '#d4d4d4';
  const direction = isC2S ? '→ C2S' : '← S2C';
  const dirColor = isC2S ? '#dcdcaa' : '#4ec9b0';
  const preview = JSON.stringify(ev.payload).slice(0, 150);

  return (
    <div className="event-row" style={{ borderLeft: `3px solid ${dirColor}`, paddingLeft: 8 }}>
      <span className="event-time">{fmt(ev.timestamp)}</span>
      <span style={{ color: dirColor, minWidth: 40, fontWeight: 'bold', flexShrink: 0 }}>{direction}</span>
      <span style={{ color, minWidth: 130, flexShrink: 0, fontWeight: 'bold' }}>{msgType}</span>
      <span className="event-session" title={ev.session_id}>{ev.session_id.slice(0, 8)}</span>
      <span className="event-body">
        <span className="json-preview" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼ ' : '▶ '}{preview}{preview.length === 150 ? '...' : ''}
        </span>
        {expanded && (
          <div className="json-full">{JSON.stringify(ev.payload, null, 2)}</div>
        )}
      </span>
    </div>
  );
}

export default function WSPanel() {
  const wsMessages = useStore((s) => s.wsMessages);
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState<'all' | 'c2s' | 's2c'>('all');

  const filtered = [...wsMessages]
    .reverse()
    .filter((ev) => {
      if (dirFilter === 'c2s' && ev.type !== 'ws_c2s') return false;
      if (dirFilter === 's2c' && ev.type !== 'ws_s2c') return false;
      if (search && !JSON.stringify(ev.payload).toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

  return (
    <>
      <div className="search-bar">
        <input
          placeholder="搜索消息内容 (type/text/agent...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filter-bar">
        {(['all', 'c2s', 's2c'] as const).map((d) => (
          <span
            key={d}
            className={`filter-chip ${dirFilter === d ? 'active' : ''}`}
            onClick={() => setDirFilter(d)}
          >
            {d === 'all' ? '全部' : d === 'c2s' ? '→ 客户端→服务端' : '← 服务端→客户端'}
          </span>
        ))}
      </div>
      <div className="panel-scroll">
        {filtered.length === 0 && <div className="empty-state">暂无 WebSocket 消息</div>}
        {filtered.map((ev, i) => (
          <WsMsgRow key={`${ev.timestamp}-${i}`} ev={ev} />
        ))}
      </div>
    </>
  );
}
