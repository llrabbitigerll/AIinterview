# AI Interview Server — 仓库说明

**产品简介**
本应用是一款面向互联网技术岗求职者的 AI 面试训练平台，旨在帮助应届毕业生、同行业跳槽者以及有意转行到互联网的候选人在真实面试前进行模拟练习、获得客观评估并针对性提升面试表现。当前版本聚焦互联网技术岗位场景，后续将逐步扩展更多岗位类型。

**核心功能与特色（面向用户）**
- 简历解析：在面试开始时上传简历，HR Agent 会自动解析项目经历、职责与技术点，为后续问答与评估提供结构化输入。
- 个性化预调研：根据候选人简历与目标公司，自动采集业务线产品/技术更新与招聘信号，生成结构化面试情报与短报告，并注入 AI 面试官提示以提升针对性。
- 实时 AI 面试：AI 面试官基于简历与预调研结果生成贴合互联网企业风格的问题，并通过 TTS 输出语音；候选人通过麦克风回答时由 ASR 实时转写，系统对流畅度与回答质量进行实时监控并动态调整后续问题，模拟真实面试互动节奏。
- 面试复盘报告：会话结束后生成详尽复盘，包括答题质量、技术深度与语言表现的量化评分，指出薄弱项并给出可执行的改善建议。

**目录结构（重要）**
- `server/`：Python 后端，包含 `pyproject.toml` 与 `server/.env.example`。
- `client/`：前端（Vite + React）。
- `scripts/`：辅助脚本，例如 `scripts/remove_secrets.ps1`。

```markdown
# AI Interview Server — 仓库说明

一句话概览：基于实时语音流、可插拔 ASR/LLM 与多 agent 协作的 AI 面试与简历评估平台（桌面客户端 + 后端 + 开发者 DevTools）。

**目录结构（重要）**
- `server/`：Python 后端，包含 `pyproject.toml` 与 `server/.env.example`。
- `client/`：前端（Vite + React）。
- `scripts/`：辅助脚本，例如 `scripts/remove_secrets.ps1`。

**快速开始（Windows — 从零到运行，使用 start.ps1）**

先决条件：
- Git
- Python 3.10+（建议 3.10/3.11）
- Node.js 16+（含 npm）

概览：仓库根提供 `start.ps1` 启动脚本，会在新窗口启动后端（uvicorn, http://localhost:8000）和 Electron 客户端。下面的步骤保证一台“全新” Windows 机器在安装必要依赖后能够直接运行 `start.ps1`。

步骤（在 PowerShell 中执行）：

1. 克隆仓库并进入目录

```powershell
# 使用 SSH（需要配置 SSH key）
git clone git@github.com:llrabbitigerll/AIinterview.git
cd AIinterview

# 或使用 HTTPS（不需要 SSH 配置）
git clone https://github.com/llrabbitigerll/AIinterview.git
cd AIinterview
```

2. 后端：创建虚拟环境并安装依赖

```powershell
cd .\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# 若项目提供 requirements.txt：
pip install -r requirements.txt
# 或基于 pyproject.toml 安装可编辑包：
pip install -e .

# 复制示例 env 并填入你的 API keys（不要提交 .env 到远端）
copy .env.example .env
notepad .env   # 编辑并保存
```

3. 前端：安装依赖（回到仓库根或执行下面）

```powershell
cd ..\client
npm install
# TypeScript 主进程编译会在 start.ps1 中执行，但可以手动编译检查：
npx tsc -p tsconfig.main.json
```

4. 回到仓库根并运行启动脚本

```powershell
cd ..\
# 在 PowerShell（不是 CMD）运行：
.\start.ps1
```

说明：
- `start.ps1` 会（1）检查 `server/.venv`，（2）在新窗口启动后端（端口 8000），（3）等待后端健康检查 `/health`，（4）编译 Electron 主进程并在新窗口启动客户端（`npm run dev`）。
- 若 `start.ps1` 提示找不到虚拟环境，请先在 `server` 目录按上述步骤创建 `.venv` 并安装依赖。
- 若未使用 SSH 克隆，可改用 HTTPS 克隆地址。

5. 停止服务

关闭 `start.ps1` 打开的两个 PowerShell 窗口即可停止后端与客户端。

（可选）如果你希望先手动启动后端或前端：
- 手动启动后端：在 `server` 虚拟环境激活后运行 `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
- 手动启动前端（Electron dev）：在 `client` 目录运行 `npm run dev`

4. 移除或检查敏感信息

在提交代码前，运行仓库内的脚本来移除或列出敏感信息：

```powershell
.\scripts\remove_secrets.ps1
```

**关键特性（技术视角）**
- 多 agent 架构（Orchestrator + Interview/Research/Resume），将会话流与任务拆分并并行处理（参考 `server/app/agents/`）。
- 可插拔的 ASR/LLM 提供者（Azure、iFlytek，以及多种 LLM 提供商），便于替换或做 A/B 测试（参考 `server/app/providers/` 与 `server/app/services/llm_service.py`）。
- 内置 DevTools（独立服务 + VSCode webview），支持事件归档、回放与实时监控（参考 `devtools/`）。

**架构概览（Mermaid 源码，可直接渲染）**
```mermaid
flowchart LR
	Client[Electron 客户端\n(PCM capture)]
	Client -->|WebSocket (PCM/事件)| Backend[FastAPI 后端]
	Backend --> SessionMgr[SessionManager]
	SessionMgr --> Orchestrator[Orchestrator Agent]
	Orchestrator --> InterviewAgent[Interview/Resume/Research Agents]
	Orchestrator -->|调用| LLM[LLM Service]
	Orchestrator -->|调用| ASR[ASR Provider]
	Orchestrator -->|调用| TTS[TTS Service]
	Backend -->|事件/归档| DevTools[DevTools / VSCode webview]
```

**快速演示（Windows）**
- 一键演示（使用仓库根脚本）：
```powershell
.\start.ps1
```
- 或单独启动后端/前端（示例）：
```bash
# 后端 (示例)
python -m server.app.main

# 客户端 (示例)
cd client
npm install
npm run dev
```

**示例会话（面向产品/非技术用户）**
- 用户说一句话 → 客户端捕获音频并实时发送 → 后端 ASR 把语音转成文字片段 → Interview Agent 根据上下文用 LLM 生成下一句提问或评估反馈 → 系统返回文本/语音给用户。
- 示例（简化）：
	- 用户（口语）："请问你最近做过的项目是什么？"
	- 系统（转写）："你最近做过的项目是什么？"
	- Agent（提问）："能否描述你在该项目中的具体责任与一项关键技术挑战？"
	- 评估（会话结束后）："该候选人在沟通上得分 8/10；技术细节说明不足。"

**`.env` 说明**
项目已包含 `server/.env.example`，请复制为 `server/.env` 并填写 API keys（不要将 `.env` 提交到 git）。

**配置说明（摘要）**
- 必要环境变量：`OPENAI_API_KEY`（或其他 LLM provider key）及所选 ASR 提供商的 key。
- 支持的提供者与切换参考：见 `server/LLM_PROVIDERS.md` 与 `server/app/providers`。

**开发与调试**
- 后端入口： `server/app/main.py`
- 客户端入口： `client/src/main/index.ts`
- 运行测试示例： `server/app/test_llm_providers.py`
- DevTools：运行 `devtools/server/devtools_app.py` 并在 VSCode 扩展中打开 webview

**隐私与安全**
- 语音与简历数据可能含敏感信息；在生产部署时请务必：
	- 使用安全的密钥管理（不要将密钥写入仓库）
	- 开启网络与存储加密
	- 定期清理或归档敏感记录（参见 `scripts/remove_secrets.ps1`）

**示例场景与价值主张（面向产品经理）**
- 快速搭建面试演示：用真实语音交互模拟结构化面试，提高候选人体验与评估一致性。
- 企业端可扩展的评估管线：可替换 LLM/ASR，便于做 A/B 测试或切换供应商。
- 开发者友好：内置 DevTools 与 VSCode webview，支持事件回放与调试。

**常见问题**
- 模块缺失：确认激活了虚拟环境并在 `server/` 安装依赖。
- 前端端口冲突：修改 `client/vite.config.ts` 或在 `package.json` 的脚本中指定端口。
- API keys 无效：确认 `server/.env` 路径与后端代码读取路径一致。

**贡献与许可证**
欢迎提 issue/PR。 本项目使用 MIT 许可证，详见 `LICENSE` 文件。

——
如果你希望我：
- 将这些文件提交到 git（需在你的机器上安装并配置 Git）；
- 或生成一个示例 GitHub Actions CI 配置（例如安装依赖并运行静态检查），请告诉我。
```