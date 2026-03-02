# AI Interview Server — 仓库说明

简要：这是一个用于 AI 模拟面试与简历评估的项目，包含 Python 后端（在 `server/`）与前端客户端（在 `client/`）。

**目录结构（重要）**
- `server/`：Python 后端，包含 `pyproject.toml` 与 `server/.env.example`。
- `client/`：前端（Vite + React）。
- `scripts/`：辅助脚本，例如 `scripts/remove_secrets.ps1`。

**快速开始（Windows — 从零到运行）**

先决条件：
- Git（参见下文）
- Python 3.10+（建议 3.10/3.11）
- Node.js 16+（含 npm）

1. 克隆仓库

```powershell
git clone <your-repo-url>
cd <repo-folder>
```

2. 后端（`server/`）

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# 如果项目提供 requirements.txt
pip install -r requirements.txt
# 或基于 pyproject.toml 安装
pip install -e .

# 复制示例 env 并填写密钥
copy .env.example .env
# 编辑 .env，填入 OPENAI/QWEN/ASR 等 API KEY
```

启动后端（示例 — 根据项目实际入口调整）

```powershell
python -m app.main
# 或 uvicorn app.main:app --reload
```

3. 前端（`client/`）

```powershell
cd ../client
npm install
npm run dev
```

页面通常开放在 `http://localhost:5173`（Vite 默认）。

4. 移除或检查敏感信息

在提交代码前，运行仓库内的脚本来移除或列出敏感信息：

```powershell
.\scripts\remove_secrets.ps1
```

5. Git 与推送（SSH 推荐）

生成 SSH key 并添加到 GitHub：

```powershell
# 生成（示例）
ssh-keygen -t ed25519 -C "you@example.com"
Start-Service ssh-agent
ssh-add $env:USERPROFILE\.ssh\id_ed25519
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

常用推送命令：

```powershell
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:yourname/your-repo.git
git branch -M main
git push -u origin main
```

或使用 `gh` 创建并推送：

```powershell
gh repo create your-repo --public --source=. --remote=origin --push
```

**`.env` 说明**
项目已包含 `server/.env.example`，请复制为 `server/.env` 并填写 API keys（不要将 `.env` 提交到 git）。

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