import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// ── Global error boundary ────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 32, background: '#1a1a2e', color: '#ff6b6b', fontFamily: 'monospace',
          minHeight: '100vh', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          <h2 style={{ color: '#ff4444' }}>React 渲染错误 — 请截图反馈</h2>
          <p><strong>{this.state.error.message}</strong></p>
          <pre style={{ fontSize: 12, color: '#aaa' }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Non-React error fallback ─────────────────────────────────────────────────
window.addEventListener('error', (e) => {
  const pre = document.getElementById('__err');
  if (!pre) {
    document.body.innerHTML =
      `<div style="padding:32px;background:#1a1a2e;color:#ff6b6b;font-family:monospace;white-space:pre-wrap">` +
      `<h2>全局错误</h2><p>${e.message}</p><pre>${e.error?.stack ?? ''}</pre></div>`;
  }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
