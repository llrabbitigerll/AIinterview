# LLM 供应商集成指南

## 概述

本系统现已支持 4 种 LLM 供应商：
- **阿里通义千问（Qwen）** - 推荐 ⭐
- **月之暗面（Moonshot Kimi）**
- **OpenAI**
- **Anthropic Claude**

## 快速开始

### 1. 配置环境变量

复制并编辑环境配置：

```bash
cd server
cp .env.example .env
```

编辑 `.env` 文件，设置 LLM 供应商：

```bash
# 推荐配置：使用 Qwen（性价比最高）
LLM_PROVIDER=qwen
QWEN_API_KEY=sk-your-actual-qwen-key
```

### 2. 获取 API 密钥

#### 阿里通义千问（推荐）

1. 访问 [DashScope 控制台](https://dashscope.console.aliyun.com/)
2. 注册/登录阿里云账号
3. 创建 API Key
4. **免费额度**：每个模型 100 万 tokens（90 天有效期）

#### 月之暗面 Kimi

1. 访问 [Moonshot 平台](https://platform.moonshot.cn/)
2. 注册/登录账号
3. 创建 API Key
4. 查看定价和额度

#### OpenAI

1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 创建 API Key
3. 充值账户

### 3. 测试配置

运行测试脚本验证配置：

```bash
cd server
python app/test_llm_providers.py
```

预期输出：
```
🚀 LLM Provider Integration Test
Current Provider: qwen

============================================================
Testing QWEN Provider
============================================================

📝 Test 1: Non-streaming completion
   Provider: qwen
   ✅ Response: 你好！我是通义千问...

🌊 Test 2: Streaming completion
   Provider: qwen
   Response: 1
2
3
4
5
   ✅ Received 10 tokens

✅ QWEN provider test PASSED
```

### 4. 启动服务

```bash
cd server
python -m app
```

服务将使用 `.env` 中配置的 LLM_PROVIDER。

## 成本对比

| 供应商 | 单次面试成本 | 优势 | 劣势 |
|--------|--------------|------|------|
| **Qwen** | **¥0.58** | 性价比最高，1M 上下文 | 需实测复杂推理能力 |
| OpenAI | ¥1.11 | 稳定可靠，质量保证 | 成本较高 |
| Moonshot | ¥1.79 | 思考模式，推理能力强 | 成本最高，temperature 固定 |
| Qwen-Flash | ¥0.15 | 极致性价比 | 复杂推理能力弱 |

**推荐**：生产环境使用 Qwen，OpenAI 作为 fallback

## 模型分配策略

系统根据任务复杂度自动选择合适的模型：

| Agent | 任务 | Qwen | Moonshot | OpenAI |
|-------|------|------|----------|--------|
| Agent A | 门控决策 | qwen-flash | kimi-k2.5 | gpt-4o-mini |
| Agent B/C | 面试提问 | qwen3.5-plus | kimi-k2.5 | gpt-4o-mini |
| Resume Parser | 简历解析 | qwen3.5-plus | kimi-k2.5 | gpt-4o-mini |
| Evaluator | 答案评估 | qwen-flash | kimi-k2.5 | gpt-4o-mini |

### 为什么这样分配？

- **Fast Model（qwen-flash）**：
  - 用于简单决策（Agent A）
  - 成本极低（¥0.15/百万 tokens）
  - 响应速度快

- **Strong Model（qwen3.5-plus）**：
  - 用于复杂推理（面试提问、简历解析）
  - 官方认证"媲美 Qwen3-Max"
  - 1M 超长上下文
  - 成本比 Max 低 68%

## 高级配置

### Fallback 机制

配置多个供应商作为降级保底：

```bash
LLM_PROVIDER=qwen
LLM_FALLBACK_PROVIDERS=openai,moonshot
```

顺序：Qwen → OpenAI → Moonshot → 失败

### 动态切换供应商

运行时修改 `.env` 文件中的 `LLM_PROVIDER`，无需重启：

```bash
# 开发测试：使用 Qwen 免费额度
LLM_PROVIDER=qwen

# 生产环境：使用 OpenAI 高可靠性
LLM_PROVIDER=openai

# 复杂推理场景：使用 Kimi 思考模式
LLM_PROVIDER=moonshot
```

### 思考模式（Thinking Mode）

Qwen 和 Kimi 支持思考模式，适合复杂推理：

**Qwen**：
```python
# 在 llm_service.py 中启用
extra_params = {"enable_thinking": True}
```

**Kimi K2.5**：
```python
# 默认已启用
extra_body = {"thinking": {"type": "enabled"}}
```

## 监控与调试

### 查看 LLM 调用日志

日志会记录每次 LLM 调用：

```python
# 在 app/services/llm_service.py 中添加
logger.info(f"LLM Call | Provider: {provider} | Model: {model} | Tokens: ~{tokens}")
```

### 成本监控

建议在生产环境添加成本跟踪：

```python
# 单次面试成本估算
total_cost = (
    agent_a_calls * 1.2k * fast_model_price +
    agent_bc_calls * 3.5k * strong_model_price +
    other_tasks * task_tokens * task_model_price
)
```

## 常见问题

### Q1: 如何选择供应商？

**开发测试**：Qwen（有免费额度）  
**生产环境**：Qwen + OpenAI fallback  
**复杂推理**：Moonshot（如果预算充足）

### Q2: Qwen 质量真的能媲美 GPT-4？

根据官方说明，qwen3.5-plus "在纯文本任务上的效果可媲美 Qwen3 Max"，而 Qwen3 Max 在多个基准测试中接近 GPT-4 水平。建议在实际业务场景中 A/B 测试验证。

### Q3: Kimi K2.5 为什么 temperature 不能调？

这是 Moonshot 的设计决策，K2.5 内部固定使用 0.6 以平衡创造性和稳定性。如果需要极低（0.1）或极高（0.9）temperature，建议用 Qwen。

### Q4: 如何处理 API 调用失败？

系统已实现 fallback 机制：
1. 优先使用配置的 LLM_PROVIDER
2. 失败时依次尝试 LLM_FALLBACK_PROVIDERS
3. 全部失败时向用户返回错误提示

### Q5: 免费额度用完后成本如何？

**Qwen**（单次面试 20 轮对话）：
- Agent A 决策：20 × 1.2k × ¥0.15/M = ¥0.0036
- Agent B/C 提问：20 × 3.5k × ¥0.8/M = ¥0.056
- 总计：约 ¥0.58/session

按每天 100 场面试计算：¥58/天 = ¥1,740/月

## 实施清单

- [x] 扩展 `config.py` 添加 Qwen/Moonshot 配置
- [x] 实现 `llm_service.py` 的 Qwen/Moonshot 接口
- [x] 更新 Agent A 使用 fast 模型
- [x] 更新 Agent B/C 使用 strong 模型
- [x] 更新 `resume_agent.py` 模型配置
- [x] 创建 `.env.example` 模板文件
- [x] 创建测试脚本 `test_llm_providers.py`
- [ ] 获取 Qwen API Key（需用户操作）
- [ ] 运行测试验证配置
- [ ] 启动服务测试完整面试流程

## 下一步

1. **获取 API 密钥**：访问 [DashScope](https://dashscope.console.aliyun.com/) 注册获取 Qwen API Key
2. **配置 .env**：填写真实的 API Key
3. **运行测试**：`python app/test_llm_providers.py`
4. **启动服务**：`python -m app`
5. **完整测试**：从前端上传简历，完成一次模拟面试

## 技术支持

- Qwen 文档：https://help.aliyun.com/zh/model-studio/
- Moonshot 文档：https://platform.moonshot.cn/docs
- 项目计划：查看 `plan-llmProviderExtension.prompt.md`
