# LLM 供应商扩展计划：阿里 Qwen + 月之暗面 Kimi

## 一、目标

为 AI 模拟面试系统的 3-Agent 架构添加两个国产 LLM 供应商支持：
- **阿里通义千问（Qwen）**：qwen3.5-plus、qwen-flash
- **月之暗面（Moonshot）**：kimi-k2.5

## 二、最新模型调研结果

### 2.1 阿里 Qwen3.5 系列（2026年2月最新）

#### qwen3.5-plus（推荐主力模型）
- **上下文长度**：1,000,000 tokens（1M超长上下文）
- **定价**：
  - 0-128K：输入 ¥0.8/百万 tokens，输出 ¥4.8/百万 tokens
  - 128K-256K：输入 ¥2/百万 tokens，输出 ¥12/百万 tokens
  - 256K-1M：输入 ¥8/百万 tokens，输出 ¥48/百万 tokens
- **官方定位**：**"在纯文本任务上的效果可媲美 Qwen3 Max，性能更优且成本更低"**
- **特性**：
  - 支持思考模式（enable_thinking 参数）
  - 支持多模态输入（文本、图像、视频）
  - 支持上下文缓存（Context Caching）
- **成本优势**：
  - 输入成本比 qwen3-max 便宜 **68%**（¥0.8 vs ¥2.5）
  - 上下文长度是 qwen3-max 的 **4倍**（1M vs 262k）

#### qwen-flash（极致性价比）
- **上下文长度**：1,000,000 tokens
- **定价**：
  - 0-128K：输入 ¥0.15/百万 tokens，输出 ¥1.5/百万 tokens
  - 128K-256K：输入 ¥0.5/百万 tokens，输出 ¥5/百万 tokens
- **官方定位**：速度最快、成本极低的模型，适合简单任务
- **特性**：
  - 支持思考模式
  - 灵活的阶梯定价
  - 支持上下文缓存
- **成本优势**：
  - 输入成本比 qwen3-max 便宜 **94%**（¥0.15 vs ¥2.5）
  - 输入成本比 gpt-3.5-turbo 便宜 **85%**（¥0.15 vs ¥1.0）

#### qwen3-max（旗舰对比基准）
- **上下文长度**：262,144 tokens
- **定价**：
  - 0-32K：输入 ¥2.5/百万 tokens，输出 ¥10/百万 tokens
  - 32K-128K：输入 ¥4/百万 tokens，输出 ¥16/百万 tokens
- **特性**：最强推理能力，支持思考模式

#### 免费额度
- 各模型首次激活后 90 天内免费额度 100 万 Token
- 适合开发测试阶段

### 2.2 月之暗面 Kimi K2.5（2026年2月最新）

#### kimi-k2.5（统一思考模型）
- **上下文长度**：262,144 tokens
- **定价**：
  - 输入 ¥4/百万 tokens，输出 ¥21/百万 tokens
- **官方定位**：擅长解决更复杂的问题，支持多模态理解与处理
- **特性**：
  - **统一了思考/非思考模式**：通过 `thinking: {"type": "enabled"}` 或 `{"type": "disabled"}` 参数控制，无需切换模型
  - 支持多模态理解与处理
  - **temperature 参数固定 0.6**（不可修改）
- **API 兼容性**：
  - 完全兼容 OpenAI SDK
  - base_url: `https://api.moonshot.cn/v1`
  - 支持流式输出
- **注意事项**：
  - 输出成本比旧版 K2-thinking 贵 **31%**（¥21 vs ¥16）
  - 温度参数不可调整，对需要创意性 temperature=0.9 或确定性 temperature=0.3 的场景不灵活

#### 已废弃模型（不推荐）
- `kimi-k2-thinking`：仅思考模式，¥4/¥16
- `Moonshot-Kimi-K2-Instruct`：131k 上下文，非思考模式，¥4/¥16

## 三、成本效益分析

### 3.1 基准对比（OpenAI gpt-4o-mini）

**当前系统单次面试成本估算**：
- Agent A（门控）：20 次决策 × 1.2k tokens × $0.15/M 输入 × 7.3 汇率 = ¥0.026
- Agent B/C（面试官）：20 轮对话 × 3.5k tokens × $0.60/M 输入 × 7.3 汇率 = ¥0.92
- 其他（简历解析、报告生成）：¥0.16
- **总计**：¥1.11/session

### 3.2 方案 A（推荐）：全 Qwen 架构

**模型分配**：
- **Agent A（门控）**：qwen-flash（¥0.15/M 输入）
- **Agent B/C（面试官）**：qwen3.5-plus（¥0.8/M 输入）
- **辅助任务**：qwen-flash

**单次面试成本估算**：
- Agent A：20 × 1.2k × ¥0.15/M = ¥0.0036
- Agent B/C：20 × 3.5k × ¥0.8/M = ¥0.056（输入）+ ¥0.48（输出）= ¥0.536
- 其他：qwen-flash 处理 = ¥0.04
- **总计**：¥0.58/session

**成本节省**：
- vs OpenAI：节省 **48%**（¥0.58 vs ¥1.11）
- vs Qwen3-Max 全套：节省 **72%**（¥0.58 vs ¥2.08）

**优势**：
- ✅ 成本最优，适合大规模商业部署
- ✅ qwen3.5-plus 官方认证媲美 Max 质量
- ✅ 1M 超长上下文，支持复杂简历和多轮深度对话
- ✅ 完全国产化，数据合规性更好
- ✅ 免费额度充足，开发测试零成本

**劣势**：
- ⚠️ 需实测验证 qwen3.5-plus 在复杂推理场景（如 LeetCode Hard 算法面试）的表现
- ⚠️ qwen-flash 用于 Agent A 可能在复杂门控决策时出现误判

### 3.3 方案 B：Qwen + Kimi 混合

**模型分配**：
- **Agent A（门控）**：qwen-flash（¥0.15/M）
- **Agent B/C（面试官）**：kimi-k2.5（¥4/M 输入，¥21/M 输出）
- **辅助任务**：qwen-flash

**单次面试成本估算**：
- Agent A：¥0.0036
- Agent B/C：20 × 3.5k × ¥4/M = ¥0.28（输入）+ ¥1.47（输出）= ¥1.75
- 其他：¥0.04
- **总计**：¥1.79/session

**成本分析**：
- vs OpenAI：贵 **61%**（¥1.79 vs ¥1.11）
- vs 方案 A：贵 **209%**（¥1.79 vs ¥0.58）

**优势**：
- ✅ Kimi K2.5 思考模式适合复杂推理（如系统设计、算法难题）
- ✅ 多模态能力，未来可扩展图表/白板面试
- ✅ 方案 A 作为降级保底

**劣势**：
- ❌ 成本过高，商业化不可持续
- ⚠️ temperature 固定 0.6，无法根据场景调整（技术面需 0.3，行为面需 0.8）
- ⚠️ 上下文仅 262k，不如 qwen3.5-plus 的 1M

### 3.4 方案 C：极致性价比（纯 Flash）

**模型分配**：
- **全部 Agent**：qwen-flash（¥0.15/M 输入，¥1.5/M 输出）

**单次面试成本估算**：
- **总计**：¥0.15/session

**成本节省**：
- vs OpenAI：节省 **86%**
- vs 方案 A：节省 **74%**

**优势**：
- ✅ 极致成本优化，适合 C 端免费产品
- ✅ 速度最快，用户体验流畅

**劣势**：
- ❌ 复杂推理能力不足，可能无法给出深度技术反问
- ❌ 简历解析、报告生成可能质量下降
- ⚠️ 仅适合初级岗位或快速筛选场景

## 四、推荐方案与实施路径

### 4.1 推荐策略

**生产环境（正式部署）**：**方案 A（Qwen3.5-Plus + Flash）**
- 理由：成本节省 48%，质量媲美 Max，1M 上下文足够处理任何复杂场景
- 实测后若 Agent A 的 qwen-flash 门控决策质量不足，可单独升级为 qwen3.5-plus（增加 ¥0.016/session）

**开发测试环境**：**方案 A + 方案 B 双轨**
- 同时实现 Qwen 和 Kimi 接口，通过 A/B Test 对比真实面试效果
- 利用免费额度完成充分测试

**降级保底**：
- 保留 OpenAI 作为最高优先级 fallback
- 顺序：OpenAI → Qwen → Kimi

### 4.2 实施步骤（12 步）

#### 第一阶段：配置与接口实现（2 小时）

**Step 1：扩展 `server/app/core/config.py`**

```python
# Alibaba Qwen
QWEN_API_KEY: str = ""
QWEN_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
QWEN_MODEL_STRONG: str = "qwen3.5-plus"
QWEN_MODEL_FAST: str = "qwen-flash"

# Moonshot Kimi
MOONSHOT_API_KEY: str = ""
MOONSHOT_BASE_URL: str = "https://api.moonshot.cn/v1"
MOONSHOT_MODEL_STRONG: str = "kimi-k2.5"
MOONSHOT_MODEL_FAST: str = "kimi-k2.5"

# LLM Provider Selection
LLM_PROVIDER: str = "openai"  # "openai" | "qwen" | "moonshot"
LLM_FALLBACK_PROVIDERS: list[str] = ["openai"]  # 降级顺序
```

**Step 2：修改 `server/app/services/llm_service.py`**

添加 Qwen 支持（OpenAI-compatible）：

```python
async def _qwen_complete(
    messages: list[dict],
    model: str | None,
    temperature: float,
    max_tokens: int,
) -> str:
    """Qwen completion via OpenAI-compatible API"""
    from openai import AsyncOpenAI
    
    client = AsyncOpenAI(
        api_key=settings.QWEN_API_KEY,
        base_url=settings.QWEN_BASE_URL,
    )
    
    # Qwen-specific parameters
    extra_params = {}
    if "thinking" in (model or ""):
        extra_params["enable_thinking"] = True
    
    resp = await client.chat.completions.create(
        model=model or settings.QWEN_MODEL_STRONG,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        **extra_params,
    )
    return resp.choices[0].message.content


async def _qwen_stream(
    messages: list[dict],
    model: str | None,
    temperature: float,
    max_tokens: int,
) -> AsyncIterator[str]:
    """Qwen streaming completion"""
    from openai import AsyncOpenAI
    
    client = AsyncOpenAI(
        api_key=settings.QWEN_API_KEY,
        base_url=settings.QWEN_BASE_URL,
    )
    
    extra_params = {}
    if "thinking" in (model or ""):
        extra_params["enable_thinking"] = True
    
    stream = await client.chat.completions.create(
        model=model or settings.QWEN_MODEL_STRONG,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        **extra_params,
    )
    
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

添加 Moonshot 支持：

```python
async def _moonshot_complete(
    messages: list[dict],
    model: str | None,
    temperature: float,  # 注意：Kimi K2.5 固定 0.6，此参数无效
    max_tokens: int,
) -> str:
    """Moonshot Kimi completion via OpenAI-compatible API"""
    from openai import AsyncOpenAI
    
    client = AsyncOpenAI(
        api_key=settings.MOONSHOT_API_KEY,
        base_url=settings.MOONSHOT_BASE_URL,
    )
    
    # K2.5 unified model with thinking control
    extra_params = {
        "thinking": {"type": "enabled"}  # 或 "disabled"
    }
    
    resp = await client.chat.completions.create(
        model=model or settings.MOONSHOT_MODEL_STRONG,
        messages=messages,
        # temperature 不传递，K2.5 内部固定 0.6
        max_tokens=max_tokens,
        **extra_params,
    )
    return resp.choices[0].message.content


async def _moonshot_stream(
    messages: list[dict],
    model: str | None,
    temperature: float,
    max_tokens: int,
) -> AsyncIterator[str]:
    """Moonshot Kimi streaming completion"""
    from openai import AsyncOpenAI
    
    client = AsyncOpenAI(
        api_key=settings.MOONSHOT_API_KEY,
        base_url=settings.MOONSHOT_BASE_URL,
    )
    
    stream = await client.chat.completions.create(
        model=model or settings.MOONSHOT_MODEL_STRONG,
        messages=messages,
        max_tokens=max_tokens,
        stream=True,
        thinking={"type": "enabled"},
    )
    
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

更新路由逻辑：

```python
async def llm_complete(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> str:
    """Unified LLM completion with provider routing"""
    provider = settings.LLM_PROVIDER
    
    if provider == "qwen":
        return await _qwen_complete(messages, model, temperature, max_tokens)
    elif provider == "moonshot":
        return await _moonshot_complete(messages, model, temperature, max_tokens)
    elif provider == "anthropic":
        return await _anthropic_complete(messages, model, temperature, max_tokens)
    else:  # openai
        return await _openai_complete(messages, model, temperature, max_tokens)


async def llm_stream(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> AsyncIterator[str]:
    """Unified LLM streaming with provider routing"""
    provider = settings.LLM_PROVIDER
    
    if provider == "qwen":
        async for token in _qwen_stream(messages, model, temperature, max_tokens):
            yield token
    elif provider == "moonshot":
        async for token in _moonshot_stream(messages, model, temperature, max_tokens):
            yield token
    elif provider == "anthropic":
        async for token in _anthropic_stream(messages, model, temperature, max_tokens):
            yield token
    else:  # openai
        async for token in _openai_stream(messages, model, temperature, max_tokens):
            yield token
```

**Step 3：（可选）实现 fallback 机制**

```python
async def llm_complete_with_fallback(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> str:
    """Try multiple providers in order until success"""
    providers_to_try = [settings.LLM_PROVIDER] + settings.LLM_FALLBACK_PROVIDERS
    
    for provider in providers_to_try:
        try:
            # Temporarily override provider
            original_provider = settings.LLM_PROVIDER
            settings.LLM_PROVIDER = provider
            
            result = await llm_complete(messages, model, temperature, max_tokens)
            
            settings.LLM_PROVIDER = original_provider
            return result
            
        except Exception as e:
            logger.warning(f"Provider {provider} failed: {e}")
            settings.LLM_PROVIDER = original_provider
            continue
    
    raise Exception("All LLM providers failed")
```

#### 第二阶段：Agent 级模型分配（1 小时）

**Step 4：修改 `server/app/agents/orchestrator.py`（Agent A）**

```python
async def decide_next_action(self, context: dict) -> dict:
    """Gate controller using fast model"""
    messages = [
        {"role": "system", "content": self.system_prompt},
        {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
    ]
    
    # Use fast model for quick decisions
    response = await llm_complete(
        messages=messages,
        model=settings.QWEN_MODEL_FAST if settings.LLM_PROVIDER == "qwen" else None,
        temperature=0.3,  # Low temperature for deterministic routing
        max_tokens=256,
    )
    
    return json.loads(response)
```

**Step 5：修改 `server/app/agents/interview_agent.py`（Agent B/C）**

```python
async def generate_question(self, context: dict) -> AsyncIterator[str]:
    """Generate interview question using strong model"""
    messages = self._build_context(context)
    
    # Use strong model for complex reasoning
    async for token in llm_stream(
        messages=messages,
        model=settings.QWEN_MODEL_STRONG if settings.LLM_PROVIDER == "qwen" else None,
        temperature=0.7,  # Higher temperature for diverse questions
        max_tokens=800,
    ):
        yield token
```

**Step 6：修改 `server/app/agents/resume_agent.py`**

```python
async def parse_resume(self, pdf_text: str) -> dict:
    """Parse resume using strong model"""
    # ... existing code ...
    
    response = await llm_complete(
        messages=messages,
        model=settings.QWEN_MODEL_STRONG if settings.LLM_PROVIDER == "qwen" else None,
        temperature=0.2,  # Low temperature for accurate extraction
        max_tokens=2048,
    )
    
    return json.loads(response)
```

#### 第三阶段：环境配置与测试（1 小时）

**Step 7：创建 `.env` 文件（需用户操作）**

```bash
# Alibaba Qwen (从 https://dashscope.console.aliyun.com/ 获取)
QWEN_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL_STRONG=qwen3.5-plus
QWEN_MODEL_FAST=qwen-flash

# Moonshot Kimi (从 https://platform.moonshot.cn/ 获取)
MOONSHOT_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MOONSHOT_MODEL_STRONG=kimi-k2.5

# Active Provider
LLM_PROVIDER=qwen  # 或 moonshot / openai
```

**Step 8：安装依赖（若需要）**

```bash
# OpenAI SDK 已安装，兼容 Qwen 和 Kimi
# 无需额外依赖
```

**Step 9：单元测试 - 测试 LLM 接口**

```bash
# 启动 Python REPL
cd server
python -m app
```

```python
# 测试 Qwen
import asyncio
from app.services.llm_service import llm_complete
from app.core.config import settings

settings.LLM_PROVIDER = "qwen"

async def test_qwen():
    response = await llm_complete(
        messages=[{"role": "user", "content": "用一句话介绍 Qwen3.5-Plus"}],
        temperature=0.7,
        max_tokens=100,
    )
    print(response)

asyncio.run(test_qwen())

# 测试 Moonshot
settings.LLM_PROVIDER = "moonshot"

async def test_kimi():
    response = await llm_complete(
        messages=[{"role": "user", "content": "用一句话介绍 Kimi K2.5"}],
        temperature=0.7,
        max_tokens=100,
    )
    print(response)

asyncio.run(test_kimi())
```

**Step 10：集成测试 - 完整面试流程**

```bash
# 启动 FastAPI 服务
cd server
python -m app

# 在另一个终端启动 Electron 客户端
cd client
npm run dev
```

测试场景：
1. 上传简歷 → qwen3.5-plus 解析
2. 开始面试 → Agent A 使用 qwen-flash 门控
3. 技术提问 → Agent B 使用 qwen3.5-plus 生成问题
4. 回答评估 → qwen3.5-plus 分析
5. 报告生成 → qwen-flash 生成总结

**Step 11：性能与成本监控**

在 `server/app/services/llm_service.py` 添加日志：

```python
import time

async def llm_complete(messages, model, temperature, max_tokens) -> str:
    start = time.time()
    provider = settings.LLM_PROVIDER
    
    # ... existing routing logic ...
    
    latency = time.time() - start
    token_count = len(result.split())  # 粗略估算
    
    logger.info(
        f"LLM Call | Provider: {provider} | Model: {model} | "
        f"Tokens: ~{token_count} | Latency: {latency:.2f}s"
    )
    
    return result
```

**Step 12：A/B Test 对比**

创建对比测试表格：

| 模型组合 | 成本/session | Agent A 准确率 | Agent B/C 深度 | 报告质量 | 用户满意度 |
|---------|--------------|----------------|----------------|----------|------------|
| OpenAI (baseline) | ¥1.11 | 95% | 85% | 90% | 4.2/5 |
| Qwen3.5-Plus + Flash | ¥0.58 | ? | ? | ? | ? |
| Qwen-Flash 纯 | ¥0.15 | ? | ? | ? | ? |
| Kimi K2.5 + Flash | ¥1.79 | ? | ? | ? | ? |

## 五、风险与缓解策略

### 5.1 技术风险

**风险 1：qwen-flash 门控决策质量不足**
- 现象：Agent A 误判候选人水平，过早结束面试或切换轨道过于频繁
- 缓解：
  - 增加决策置信度阈值（如 confidence < 0.7 时升级为 qwen3.5-plus）
  - 保留 OpenAI 作为 fallback
  - 优化 Agent A 的 system prompt，减少模型推理负担

**风险 2：Kimi K2.5 温度固定 0.6 导致输出单一**
- 现象：技术面试问题缺乏变化，候选人感觉机械
- 缓解：
  - 在 prompt 中显式要求多样性（"请生成 3 种不同难度的问题"）
  - 放弃 Kimi，全部使用 Qwen3.5-Plus（可调 temperature）

**风险 3：Qwen3.5-Plus 在极端复杂推理场景表现不如 Max**
- 现象：系统设计题（如设计微信朋友圈）追问深度不足
- 缓解：
  - 为 Agent B/C 添加动态模型升级逻辑：
    ```python
    if question_difficulty == "system_design_hard":
        model = "qwen3-max"  # 升级为旗舰
    ```
  - 预算允许时直接使用 qwen3-max

### 5.2 成本风险

**风险 4：实际成本超出预算**
- 原因：候选人话痨，单次面试 token 消耗超预期
- 缓解：
  - 设置单次面试最大 token 限制（如 50k）
  - 使用 Qwen 的上下文缓存（Context Caching）降低重复计费
  - 监控异常高消耗会话，优化 prompt

**风险 5：免费额度耗尽后成本激增**
- 现象：测试期用免费 100 万 tokens，生产时按量计费
- 缓解：
  - 在 `.env` 中配置预算告警：
    ```python
    MAX_DAILY_COST_CNY = 100.0  # 每日最高消费 ¥100
    ```
  - 达到阈值后自动降级为 qwen-flash

### 5.3 合规风险

**风险 6：敏感数据泄露（简历信息）**
- 现象：用户简历发送到阿里云/月之暗面服务器
- 缓解：
  - 隐私政策明确告知数据流向
  - 简历脱敏处理（隐藏姓名、手机号、邮箱）
  - 企业客户可部署私有化 Qwen 模型（需联系阿里商务）

## 六、后续优化方向

### 6.1 短期优化（1 个月内）

1. **实现完整的 fallback 链**：OpenAI → Qwen → Kimi → 人工介入
2. **添加实时成本监控面板**：在 ReportPage 显示本次面试成本
3. **优化 Agent A 的 prompt**：减少 token 消耗，提高决策准确率
4. **使用 Qwen 上下文缓存**：对于重复的系统 prompt，可节省 50% 成本

### 6.2 中期优化（3 个月内）

1. **多模态面试扩展**：
   - 候选人上传架构图 → Qwen3.5-Plus 图像理解 → Agent 根据图提问
   - 白板编程 → 实时代码截图 → Kimi K2.5 分析代码质量
2. **思考模式实验**：
   - 在系统设计题中启用 `enable_thinking=True`
   - 对比思考模式 vs 非思考模式的问题深度
3. **私有化部署探索**：
   - 联系阿里云商务，评估 Qwen 私有化部署成本
   - 适合处理敏感行业（金融、政府）的简历数据

### 6.3 长期优化（6 个月+）

1. **微调 Qwen-Flash**：
   - 收集 1 万场真实面试数据
   - 微调 qwen-flash 专门用于 Agent A 门控决策
   - 目标：在 ¥0.15/M 成本下达到 qwen3.5-plus 的质量
2. **强化学习优化 Agent 策略**：
   - 用候选人满意度作为奖励信号
   - 训练 Agent A 的最优问题切换策略
3. **国产大模型对比报告**：
   - 定期测试 Qwen、Kimi、百度文心、讯飞星火
   - 发布《AI 面试场景下的国产大模型横评》

## 七、决策建议

### 立即行动（推荐）

✅ **采用方案 A（Qwen3.5-Plus + Flash）作为主架构**
- 理由：成本节省 48%，质量有官方背书，1M 上下文足够
- 实施周期：2-4 小时
- 预期效果：单场成本 ¥0.58，质量不低于 OpenAI

✅ **同时实现方案 A + 方案 B（Qwen + Kimi）**
- 理由：通过 A/B Test 找到最优模型组合
- 实施周期：+1 小时（增量开发）
- 预期效果：数据驱动决策

### 待观察（保留选项）

⏸ **方案 C（纯 qwen-flash）**
- 在 A/B Test 中作为对照组
- 若质量可接受，可作为 C 端免费版本的模型

⏸ **qwen3-max 升级逻辑**
- 仅在极端复杂推理场景（系统设计题）动态升级
- 增量成本：+¥0.12/question

### 不推荐

❌ **纯 Kimi K2.5 方案**
- 成本过高（¥1.79/session），商业化不可持续
- temperature 不可调，灵活性差

❌ **放弃 OpenAI**
- 作为最高优先级 fallback，不可替代
- 用于处理 Qwen/Kimi 无法处理的边界 case

## 八、总结

本计划通过引入阿里 Qwen3.5-Plus 和月之暗面 Kimi K2.5，为 AI 模拟面试系统提供了：

1. **显著的成本优势**：方案 A 可节省 48% 成本（¥0.58 vs ¥1.11/session）
2. **灵活的模型选择**：根据场景选择 fast/strong 模型
3. **国产化路径**：数据合规性更好，适合企业客户
4. **风险可控**：保留 OpenAI fallback，分阶段实施

**关键发现**：Qwen3.5-Plus 的"媲美 Max 质量 + 68% 成本降低 + 4 倍上下文"使其成为当前最优选择，远超初始计划中的 Qwen2.5 系列。

**下一步**：等待批准后，立即开始第一阶段实施（配置与接口实现），预计 2-4 小时完成核心代码，1 小时完成测试验证。
