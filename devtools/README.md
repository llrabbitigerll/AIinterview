# AI Interview DevTools

**完全独立的开发者监控窗口** — 以"外挂"方式运行，不修改主项目任何文件，可随时删除。

## 目录结构

```
devtools/
  start.ps1                 ← 一键启动（替代主项目 start.ps1）
  stop.ps1                  ← 停止所有 DevTools 进程
  README.md                 ← 本文件
  __init__.py
  server/
    __init__.py
    event_bus.py            ← 异步事件总线（pub/sub）
    event_archive.py        ← 事件永久归档（独立目录 JSONL）
    spy.py                  ← 所有 Monkey-Patch 拦截点（核心）
    devtools_app.py         ← FastAPI app on port 8001
    launcher.py             ← 入口：patch → 双端口服务器
  vscode-extension/
    package.json
    tsconfig.json
    src/
      extension.ts          ← VS Code 扩展入口
      devtools_proxy.ts     ← WS → postMessage 转发
    webview/
      index.html
      package.json
      vite.config.ts
      tsconfig.json
      src/
        main.tsx
        App.tsx             ← 8-tab 主布局
        store.ts            ← Zustand 事件存储
        types.ts            ← 所有事件类型定义
        styles.css
        components/
          TimelinePanel.tsx  ← 全事件时间轴（可筛选）
          WSPanel.tsx        ← WS 双向消息流
          LLMPanel.tsx       ← LLM 调用详情（prompt全文/响应/耗时）
          AgentPanel.tsx     ← Agent A GateDecision 历史
          BlackboardPanel.tsx ← Blackboard 状态快照+diff
          EvalPanel.tsx      ← 每题评估分
          ResearchPanel.tsx  ← 调研阶段进度+文件浏览
          LogPanel.tsx       ← Python 日志流
```

## 启动方式（首次）

```powershell
# 在 d:\APP 目录下
.\devtools\start.ps1
```

脚本会自动：
1. 检测 `.venv` 虚拟环境
2. 终止 8000/8001 端口残留进程
3. 新 PowerShell 窗口启动 Python 后端（双端口）
4. 等待 8000/8001 健康检查通过
5. 新 PowerShell 窗口启动 Electron 前端
6. 首次运行自动构建 VS Code Extension（`npm install + build`）
7. 打开 VS Code Extension Development Host 窗口

Extension 激活后自动弹出 DevTools 面板。  
如未自动弹出，按 `Ctrl+Shift+P` → `AI Interview: Open DevTools Panel`

## 首次构建（如需手动）

```powershell
# 在 devtools/vscode-extension 目录下
npm install
cd webview && npm install && npm run build && cd ..
npx tsc -p tsconfig.json
```

## 停止

```powershell
.\devtools\stop.ps1
```

或直接关闭各 PowerShell 窗口。

## 监控内容

| 面板 | 内容 |
|---|---|
| **Timeline** | 所有事件时间轴，支持类型筛选和全文搜索 |
| **WS 消息** | 客户端↔服务端全部 JSON 消息（C2S/S2C分色） |
| **LLM 调用** | 每次 complete/stream 的完整 prompt、模型、响应时间、响应全文 |
| **Agent 决策** | Agent A 每轮 GateDecision（action/mode/type/reasoning）+ 决策时Blackboard状态 |
| **Blackboard** | 每轮对话后的状态快照，相邻快照 diff 高亮 |
| **评估** | 每题后台评估结果（5/10分、维度分、缺陷、流利度、耗时） |
| **调研** | Research Agent 各阶段进度 + 调研结果文件浏览器 |
| **日志** | Python `app.*` 命名空间全部日志（可按 level 筛选） |

## 工作原理（零侵入）

DevTools 运行在**同一 Python 进程**中，通过 `spy.py` 对以下函数做 Monkey-Patch：

- `llm_service.llm_complete / llm_stream` — 捕获每次 LLM 调用
- `OrchestratorAgent.decide` — 捕获 GateDecision
- `InterviewSession._send_json` — 捕获所有 S2C 消息
- `InterviewSession.on_user_text` — 捕获 C2S 文字输入
- `InterviewSession.feed_audio` — 捕获音频帧大小
- `InterviewSession._background_evaluate` — 捕获评估结果
- `InterviewSession._sync_state` — 捕获 Blackboard 快照
- `SessionManager.create_session` — 捕获 Session 生命周期
- `ResearchAgent.run_phase1/2/3/4` — 捕获调研各阶段
- Python `logging` Handler — 捕获所有 `app.*` 日志

所有捕获的事件通过 `event_bus.py`（asyncio.Queue）广播到 
port 8001 的 `/devtools/ws` WebSocket 端点，再由 VS Code Extension 转发到 WebView 面板。

## 事件永久归档（回放）

- 归档目录：`devtools/event_archive/`（独立文件夹，便于管理）
- 写入格式：JSONL（append-only）
  - 全局流：`devtools/event_archive/global/YYYY-MM-DD.jsonl`
  - 面试分流：`devtools/event_archive/interviews/{interview_id}/events.jsonl`
- 元数据：`devtools/event_archive/interviews/{interview_id}/meta.json`

### 行为约定

- 每场面试事件会永久保存在归档目录，可随时复盘。
- **新启动程序时不会自动读取历史归档**，只接收新的实时流。
- 仅在你显式调用回放接口时才读取历史文件。

### 回放接口（手动查询）

```http
GET /devtools/archive/interviews
GET /devtools/archive/{interview_id}?limit=3000
```

## 删除 DevTools

直接删除 `devtools/` 目录即可。无需修改任何主项目文件。  
使用主项目原有的 `start.ps1` 正常启动，完全不受影响。
