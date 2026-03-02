DEVTOOLS SHIMS — 卸载说明

这些 shim 文件仅用于开发/编辑器静态分析（Pylance）。在发布或彻底移除 devtools 支持时，请删除以下路径下的所有文件：

- d:/APP/app/__init__.py
- d:/APP/app/services/__init__.py
- d:/APP/app/services/llm_service.py
- d:/APP/app/services/evaluation_engine.py
- d:/APP/app/services/research_service.py
- d:/APP/app/services/session_manager.py
- d:/APP/app/agents/__init__.py
- d:/APP/app/agents/interview_agent.py
- d:/APP/app/agents/orchestrator.py
- d:/APP/app/agents/resume_agent.py
- d:/APP/app/agents/research_agent.py
- d:/APP/app/agents/persona_builder.py

这些文件最初位于 `devtools_shims/app/...`，现在已恢复到 `app/...`，若要彻底移除 devtools 相关 shim，直接删除 `devtools_shims` 目录（如果还存在）。

PowerShell 一键删除命令（在项目根运行）：
```
Remove-Item -Recurse -Force .\devtools_shims
```

Git 删除示例（如果这些文件已被提交且需要从仓库中移除）：
```
git rm -r app/__init__.py app/services app/agents
git commit -m "Remove devtools shim files"
```

注意：在删除 shim 之前，请确认你的生产环境或打包流程不会需要这些文件。更安全的做法是将它们加入 `.gitignore` 并从发布包中排除。
