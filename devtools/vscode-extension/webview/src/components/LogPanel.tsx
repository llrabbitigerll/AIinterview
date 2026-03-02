import React, { useState } from 'react';
import { useStore } from '../store';
import type { LogRecordPayload } from '../types';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false, fractionalSecondDigits: 2 } as Intl.DateTimeFormatOptions);
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '#808080',
  INFO: '#9cdcfe',
  WARNING: '#dcdcaa',
  ERROR: '#f44747',
  CRITICAL: '#f44747',
};

function LogRow({ item }: { item: { timestamp: number; payload: LogRecordPayload } }) {
  const p = item.payload;
  const color = LEVEL_COLORS[p.level] ?? '#d4d4d4';
  return (
    <div className="event-row">
      <span className="event-time">{fmt(item.timestamp)}</span>
      <span style={{ color, minWidth: 55, flexShrink: 0, fontWeight: 'bold' }}>{p.level}</span>
      <span style={{ color: '#569cd6', minWidth: 120, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, fontSize: 10 }}>
        {p.logger}
      </span>
      <span style={{ color: '#808080', minWidth: 100, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, fontSize: 10 }}>
        {p.module}:{p.lineno}
      </span>
      <span style={{ color: '#d4d4d4', flex: 1, wordBreak: 'break-word' }}>{p.message}</span>
    </div>
  );
}

export default function LogPanel() {
  const logRecords = useStore((s) => s.logRecords);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('ALL');

  const filtered = [...logRecords]
    .reverse()
    .filter((r) => {
      if (levelFilter !== 'ALL' && r.payload.level !== levelFilter) return false;
      if (search && !r.payload.message.toLowerCase().includes(search.toLowerCase()) &&
          !r.payload.logger.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

  const counts = logRecords.reduce((acc, r) => {
    acc[r.payload.level] = (acc[r.payload.level] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <>
      <div className="search-bar">
        <input
          placeholder="搜索日志消息或 logger 名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filter-bar">
        {(['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const).map((level) => (
          <span
            key={level}
            className={`filter-chip ${levelFilter === level ? 'active' : ''}`}
            style={{ borderColor: levelFilter === level ? (LEVEL_COLORS[level] ?? '#0e639c') : undefined }}
            onClick={() => setLevelFilter(level)}
          >
            {level}
            {counts[level] != null && <span style={{ marginLeft: 3, opacity: 0.7 }}>({counts[level]})</span>}
          </span>
        ))}
      </div>
      <div className="panel-scroll">
        {filtered.length === 0 && <div className="empty-state">暂无日志记录</div>}
        {filtered.map((item, i) => (
          <LogRow key={`${item.timestamp}-${i}`} item={item} />
        ))}
      </div>
    </>
  );
}
