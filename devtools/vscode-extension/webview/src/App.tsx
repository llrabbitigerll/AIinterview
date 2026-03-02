import React, { useEffect } from 'react';
import { useStore } from './store.ts';
import TimelinePanel from './components/TimelinePanel';
import WSPanel from './components/WSPanel';
import LLMPanel from './components/LLMPanel';
import AgentPanel from './components/AgentPanel';
import BlackboardPanel from './components/BlackboardPanel';
import EvalPanel from './components/EvalPanel';
import ResearchPanel from './components/ResearchPanel';
import LogPanel from './components/LogPanel';
import ReplayPanel from './components/ReplayPanel';
import type { DevToolsEvent } from './types';

type TabStoreKey = 'events' | 'wsMessages' | 'llmCalls' | 'agentDecisions' | 'blackboardSnapshots' | 'evalResults' | 'researchEvents' | 'logRecords';
type TabDef = { id: string; label: string; storeKey?: TabStoreKey };

const TABS: TabDef[] = [
  { id: 'timeline', label: '📋 Timeline', storeKey: 'events' },
  { id: 'ws', label: '🔌 WS 消息', storeKey: 'wsMessages' },
  { id: 'llm', label: '🤖 LLM 调用', storeKey: 'llmCalls' },
  { id: 'agent', label: '🧠 Agent决策', storeKey: 'agentDecisions' },
  { id: 'blackboard', label: '📊 Blackboard', storeKey: 'blackboardSnapshots' },
  { id: 'eval', label: '🎯 评估', storeKey: 'evalResults' },
  { id: 'research', label: '🔍 调研', storeKey: 'researchEvents' },
  { id: 'logs', label: '📝 日志', storeKey: 'logRecords' },
  { id: 'replay', label: '📚 历史复盘' },
];

export default function App() {
  const { connected, activeTab, setActiveTab, handleEvent, clearAll, setConnected } = useStore();
  const counts = useStore((s) => ({
    events: s.events.length,
    wsMessages: s.wsMessages.length,
    llmCalls: s.llmCalls.length,
    agentDecisions: s.agentDecisions.length,
    blackboardSnapshots: s.blackboardSnapshots.length,
    evalResults: s.evalResults.length,
    researchEvents: s.researchEvents.length,
    logRecords: s.logRecords.length,
  }));

  useEffect(() => {
    // Listen for messages from VS Code extension host
    const handler = (event: MessageEvent) => {
      const raw = event.data as Partial<DevToolsEvent> & { type?: string };
      const msg: DevToolsEvent = {
        type: raw.type ?? '',
        timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now() / 1000,
        session_id: typeof raw.session_id === 'string' ? raw.session_id : '',
        payload: raw.payload ?? {},
      };
      if (!msg || !msg.type) return;

      if (msg.type === 'devtools_clear') {
        clearAll();
        return;
      }
      if (msg.type === 'devtools_connected') {
        setConnected(true);
      } else if (msg.type === 'devtools_disconnected') {
        setConnected(false);
      }
      handleEvent(msg);
    };

    window.addEventListener('message', handler);

    // Signal to extension that webview is ready
    const vscode = window.acquireVsCodeApi?.();
    vscode?.postMessage({ type: 'webview_ready' });

    return () => window.removeEventListener('message', handler);
  }, [handleEvent, clearAll, setConnected]);

  const requestReconnect = () => {
    const vscode = window.acquireVsCodeApi?.();
    vscode?.postMessage({ type: 'devtools_request_reconnect' });
  };

  return (
    <div className="devtools-root">
      <div className="toolbar">
        <h1>🔍 DevTools</h1>
        <span className={`conn-badge ${connected ? 'connected' : ''}`}>
          {connected ? '● 已连接 :8001' : '○ 未连接'}
        </span>
        {!connected && (
          <button className="btn" onClick={requestReconnect}>重连</button>
        )}
        <div className="toolbar-gap" />
        <button className="btn danger" onClick={clearAll}>清空</button>
      </div>

      <div className="tabs">
        {TABS.map((tab) => {
          const count = tab.storeKey ? (counts[tab.storeKey as keyof typeof counts] ?? 0) : 0;
          return (
            <div
              key={tab.id}
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.storeKey && count > 0 && <span className="badge">{count > 999 ? '999+' : count}</span>}
            </div>
          );
        })}
      </div>

      <div className="panel-body">
        {activeTab === 'timeline' && <TimelinePanel />}
        {activeTab === 'ws' && <WSPanel />}
        {activeTab === 'llm' && <LLMPanel />}
        {activeTab === 'agent' && <AgentPanel />}
        {activeTab === 'blackboard' && <BlackboardPanel />}
        {activeTab === 'eval' && <EvalPanel />}
        {activeTab === 'research' && <ResearchPanel />}
        {activeTab === 'logs' && <LogPanel />}
        {activeTab === 'replay' && <ReplayPanel />}
      </div>
    </div>
  );
}
