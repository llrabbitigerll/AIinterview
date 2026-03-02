import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DevToolsProxy } from './devtools_proxy';

let panel: vscode.WebviewPanel | undefined;
let proxy: DevToolsProxy | undefined;
let panelReady = false;

const MAX_BUFFERED_EVENTS = 1000;
const bufferedEvents: Record<string, unknown>[] = [];
let lastConnectionEvent: Record<string, unknown> | null = null;

function bufferEvent(event: Record<string, unknown>): void {
  bufferedEvents.push(event);
  if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
    bufferedEvents.splice(0, bufferedEvents.length - MAX_BUFFERED_EVENTS);
  }
}

function flushBufferedEvents(): void {
  if (!panel || !panelReady) return;

  if (lastConnectionEvent) {
    panel.webview.postMessage(lastConnectionEvent);
  }

  for (const event of bufferedEvents) {
    panel.webview.postMessage(event);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('[AI Interview DevTools] Extension activated');

  // Auto-open panel when extension loads
  openPanel(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('aiInterviewDevTools.open', () => {
      openPanel(context);
    }),
    vscode.commands.registerCommand('aiInterviewDevTools.clear', () => {
      panel?.webview.postMessage({ type: 'devtools_clear' });
    })
  );
}

function openPanel(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Two);
    if (panelReady) {
      flushBufferedEvents();
    }
    return;
  }

  panelReady = false;

  panel = vscode.window.createWebviewPanel(
    'aiInterviewDevTools',
    '🔍 AI Interview DevTools',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist')),
      ],
    }
  );

  panel.webview.html = getWebviewContent(panel.webview, context);

  // Create proxy to connect to devtools backend
  proxy = new DevToolsProxy('ws://localhost:8001/devtools/ws', (event) => {
    const evType = String(event.type ?? '');
    if (evType === 'devtools_connected' || evType === 'devtools_disconnected') {
      lastConnectionEvent = event;
    }

    bufferEvent(event);
    if (panelReady) {
      panel?.webview.postMessage(event);
    }
  });

  // Connect immediately to avoid race with early webview_ready message.
  proxy.connect();

  panel.webview.onDidReceiveMessage(
    (message) => {
      if (message.type === 'webview_ready') {
        if (!panelReady) {
          panelReady = true;
          flushBufferedEvents();
        }
      } else if (message.type === 'devtools_request_reconnect') {
        proxy?.reconnect();
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(() => {
    panelReady = false;
    proxy?.dispose();
    proxy = undefined;
    panel = undefined;
  }, null, context.subscriptions);
}

function getWebviewContent(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const distPath = path.join(context.extensionPath, 'webview', 'dist');
  const indexPath = path.join(distPath, 'index.html');

  // If built webview exists, serve it
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');

    // Rewrite asset paths to use vscode-resource URIs
    const distUri = webview.asWebviewUri(vscode.Uri.file(distPath));
    html = html.replace(/(src|href)="\/([^"]+)"/g, `$1="${distUri}/$2"`);
    html = html.replace(/(src|href)="\.\//g, `$1="${distUri}/`);

    // Inject CSP
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">`;
    html = html.replace('<head>', `<head>\n  ${cspMeta}`);

    return html;
  }

  // Fallback dev UI (shown before first build)
  return getDevFallbackHtml(webview, context);
}

function getDevFallbackHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const nonce = getNonce();
  const extensionUri = context.extensionUri;
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>AI Interview DevTools</title>
  <style>
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; padding: 20px; }
    h2 { color: #4ec9b0; }
    .status { color: #ce9178; margin: 8px 0; }
    .events { background: #252526; padding: 12px; border-radius: 4px; max-height: 80vh; overflow-y: auto; }
    .event { border-bottom: 1px solid #333; padding: 6px 0; font-size: 11px; }
    .event .type { color: #569cd6; font-weight: bold; }
    .event .time { color: #6a9955; margin-right: 8px; }
    .event .session { color: #9cdcfe; margin-right: 8px; }
    button { background: #0e639c; color: white; border: none; padding: 6px 14px; cursor: pointer; border-radius: 3px; margin: 4px; }
    button:hover { background: #1177bb; }
  </style>
</head>
<body>
  <h2>🔍 AI Interview DevTools</h2>
  <p class="status" id="status">⏳ 等待 WebView 构建... (<code>cd devtools/vscode-extension && npm run install:all && npm run build</code>)</p>
  <p class="status">如已构建，请等待连接到 <code>ws://localhost:8001/devtools/ws</code></p>
  <div>
    <button onclick="connect()">重新连接</button>
    <button onclick="clearEvents()">清空</button>
    <span id="conn-status" style="color:#f44747; margin-left:10px;">● 未连接</span>
  </div>
  <div class="events" id="events"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let eventCount = 0;
    const MAX_EVENTS = 500;

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'devtools_connected' || msg.type === 'keepalive') {
        document.getElementById('conn-status').textContent = '● 已连接';
        document.getElementById('conn-status').style.color = '#4ec9b0';
        return;
      }
      if (msg.type === 'devtools_disconnected') {
        document.getElementById('conn-status').textContent = '● 已断开';
        document.getElementById('conn-status').style.color = '#f44747';
        return;
      }
      addEvent(msg);
    });

    function addEvent(msg) {
      eventCount++;
      const container = document.getElementById('events');
      const d = document.createElement('div');
      d.className = 'event';
      const t = new Date(msg.timestamp * 1000).toLocaleTimeString('zh', {hour12:false});
      d.innerHTML = '<span class="time">' + t + '</span>'
        + '<span class="session">[' + (msg.session_id || '-') + ']</span>'
        + '<span class="type">' + msg.type + '</span>'
        + '<pre style="margin:2px 0;white-space:pre-wrap;font-size:10px;color:#d4d4d4">'
        + JSON.stringify(msg.payload, null, 2).slice(0, 400) + '</pre>';
      container.insertBefore(d, container.firstChild);
      if (eventCount > MAX_EVENTS) container.lastChild?.remove();
    }

    function connect() {
      vscode.postMessage({ type: 'devtools_request_reconnect' });
    }
    function clearEvents() {
      document.getElementById('events').innerHTML = '';
      eventCount = 0;
    }

    // Signal ready
    vscode.postMessage({ type: 'webview_ready' });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function deactivate(): void {
  proxy?.dispose();
}
