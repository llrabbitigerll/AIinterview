# AI Interview Server — 仓库说明

简要：这是一个用于 AI 模拟面试与简历评估的项目，包含 Python 后端（在 `server/`）与前端客户端（在 `client/`）。

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