# 事后复盘报告：讯飞 ASR 语音识别完全失效

**Bug 编号**: ASR-001  
**影响功能**: 面试会话启动、实时语音识别、字幕显示、语音转文字填入  
**修复轮数**: 6 轮  
**修复日期**: 2026-02-24  

---

## 一、现象描述

用户描述：
> "面试官没有开场，我发消息他也没回，语音错误消失，但仍然没有识别我的语音出现字幕和输入进文本框"

表面上是两个独立问题：
1. 面试官不说话，消息也无回应
2. 语音识别无字幕、不填入输入框

实际上是**同一个根因**引发的连锁失效。

---

## 二、根本原因（Root Cause）

### 根因 1：ASR 初始化阻塞整个 session

```
session.initialize()
  └─ asr.start_stream()          ← 抛出异常
       └─ websockets.connect(错误URL)  ← 404
            └─ 整个 initialize() 失败
                 └─ interview_ready 永远不发送
                      └─ 面试官沉默，消息无回应
```

`session_manager.py` 的 `initialize()` 方法在 ASR 初始化失败时**没有 try/except 保护**，一旦 `asr.start_stream()` 抛异常，整个面试 session 就崩了。

### 根因 2：URL 路径错误（HTTP 404）

`asr_iflytek.py` 中配置的 URL：
```
wss://office-api-ast-dx.iflyaisol.com/     ← 错误（缺少路径）
```
正确 URL：
```
wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1   ← 正确
```

缺少路径段 `/ast/communicate/v1`，导致 WebSocket 握手返回 HTTP 404。

### 根因 3：鉴权算法完全不同（被忽视的服务版本差异）

项目代码沿用了旧版讯飞 RTASR 服务（`rtasr.xfyun.cn`）的鉴权方式：

| 维度 | 旧服务（rtasr.xfyun.cn） | 新服务（大模型版，office-api-ast-dx） |
|------|------------------------|--------------------------------------|
| 签名输入 | `HMAC-SHA1(apiKey, MD5(appid+ts))` | `HMAC-SHA1(accessKeySecret, 全部参数排序后 URL 编码)` |
| 时间格式 | Unix 时间戳（秒） | ISO 8601 `%Y-%m-%dT%H:%M:%S+0800` |
| 响应格式 | `{"action":"...", "code":"0", "data":"..."}` | `{"msg_type":"result", "res_type":"asr", "data":{...}}` |
| 结束信号 | `{"end": true}` | `{"end": true, "sessionId": "server-assigned-id"}` |

新服务的 sessionId 由**服务端握手响应**返回，必须使用服务端返回的值，不能用本地生成的 UUID。

---

## 三、修复过程（六轮迭代）

### 第 1 轮：错误方向（改用旧 API URL）
- **操作**：发现 404 后，将 URL 改为旧版 `rtasr.xfyun.cn/v1/ws`
- **结果**：连接成功但返回错误码 10110（`no license | illegal signa`）
- **原因**：旧服务账号未开通，且鉴权算法也已不匹配

### 第 2 轮：治标——ASR 初始化异步化
- **操作**：给 `session_manager.py` 加 try/except，ASR 初始化改为 fire-and-forget
- **结果**：面试至少能开始（`interview_ready` 正常发出），但 ASR 仍失效
- **价值**：解耦了 ASR 可用性与面试可用性，降低单点故障影响范围
- **增加**：`asr_status` 消息类型，告知前端 ASR 是否可用

### 第 3 轮：确认服务信息
- **操作**：向用户确认实际开通的是哪个服务
- **结论**：是**大模型实时语音转写**（`office-api-ast-dx.iflyaisol.com`），WebAPI 认证用 APIKey/APISecret

### 第 4 轮：查阅官方文档，重新理解协议
- **操作**：读取讯飞官方文档
- **发现**：URL、鉴权算法、响应格式、结束信号全部不同（见根因 3 表格）

### 第 5 轮：完整重写 `asr_iflytek.py`
- 正确 URL（含路径）
- 新鉴权算法（排序参数 + `accessKeySecret` HMAC-SHA1）
- 新响应解析（`msg_type/res_type/data.cn.st`）
- 结束信号使用服务端 sessionId

### 第 6 轮：补充 sessionId 捕获逻辑
- 握手响应 `msg_type:"action"` 中含 `data.sessionId`
- 增加 `_server_session_id` 字段，结束时优先使用服务端返回值
- 直连测试确认：`action: "started"` ✅，端到端测试 `asr_status available=True` ✅

---

## 四、最终修复清单

| 文件 | 修改内容 |
|------|---------|
| `server/app/providers/asr_iflytek.py` | 完整重写：URL、鉴权、响应解析、sessionId 捕获 |
| `server/app/services/session_manager.py` | ASR 初始化异步 fire-and-forget，面试不再因 ASR 失败而阻塞 |
| `client/src/renderer/types/protocol.ts` | 新增 `S2C_ASRStatus` 类型 |
| `client/src/renderer/services/InterviewService.ts` | 处理 `asr_status` 消息，不可用时显示提示 |
| `server/.env` | 删除错误的旧版 URL 配置 |

---

## 五、为什么修了这么多轮？——反思

### 问题 1：没有在接入点验证"连接是否真的成功"
接入第三方 WebSocket API 时，应该**首先跑一个独立的直连测试脚本**，确认：
- URL 可达（无 404）
- 鉴权正确（无 10110）
- 响应格式符合预期

这一步在第 5 轮才做，应该是**第 1 步**。

### 问题 2：混淆了新旧两个讯飞服务
- `rtasr.xfyun.cn`：2019 年老版实时语音转写
- `office-api-ast-dx.iflyaisol.com`：2023 年起大模型版
- 两者接入方式**完全不同**，但代码沿用了旧版实现，注释也没有标注版本

### 问题 3：ASR 初始化异常未隔离
单点故障传播是软件架构问题。ASR 是面试的辅助功能，其失败不应导致整个会话崩溃。

---

## 六、以后该怎么排查这类问题

### 6.1 第三方 API 接入失效排查流程

```
步骤 0：主动联网查文档（优先级最高）
  └─ 遇到 URL 404、鉴权失败、字段解析异常等 API 层错误时
  └─ 立即去官方文档网站查最新接口说明，不依赖代码里的旧注释或记忆
  └─ 重点确认：是否有新版 API？文档地址是否已更新？
  └─ 讯飞示例: https://www.xfyun.cn/doc/  →  找到具体服务的 WebAPI 文档
  └─ 原则: "代码可能过时，文档永远是权威"

步骤 1：隔离测试
  └─ 写最小直连脚本（仅 websocket + 鉴权）
  └─ 确认能连通、收到正常握手
  └─ 用 print(raw_response) 看原始响应

步骤 2：对照官方文档
  └─ 确认 URL（含路径、参数）
  └─ 确认鉴权算法（字段名、顺序、哈希方式）
  └─ 确认响应格式（字段名可能已变）
  └─ 特别注意：服务是否有新旧版本

步骤 3：看服务端日志
  └─ HTTP 状态码（404 = URL 错、403 = 鉴权错、101 = WebSocket 升级成功）
  └─ 错误码含义（查官方文档，不要猜）

步骤 4：排查集成侧
  └─ 异常是否被吞掉（有无 try/except catch-all）
  └─ 初始化失败是否影响下游功能
```

### 6.2 关键日志检查命令
```bash
# 查看 uvicorn 实时日志（重要 - 永远是第一步）
python -m uvicorn app.main:app --log-level debug

# 直接测试 ASR 连接（隔离第三方问题）
python test_asr_direct.py

# 检查端口是否在监听
netstat -ano | findstr ":8000"
```

### 6.3 接入新 API 时的检查清单

- [ ] 是否有新旧版本？查清楚使用的是哪个版本
- [ ] URL 含完整路径（不只是 base domain）
- [ ] 鉴权参数的**排序规则、编码方式、哈希算法**是否与旧版一致
- [ ] 时间字段的格式（Unix 秒 vs ISO 8601）
- [ ] 响应字段名是否变化（`code` vs `msg_type`，`data` 嵌套层级）
- [ ] 会话 ID 是本地生成还是服务端下发
- [ ] 结束信号的格式是否需要携带服务端分配的 ID

### 6.4 架构层面：避免单点故障扩散

辅助功能（ASR、TTS 等）的初始化失败，**不应影响核心功能（面试对话）**：

```python
# 正确做法：fire-and-forget + 降级
asyncio.create_task(self._init_asr_async())   # 不 await
await self._send_json({"type": "interview_ready", ...})  # 立即通知

# 错误做法：串行等待
await self.asr.start_stream(...)              # 失败 → 整个会话挂
await self._send_json({"type": "interview_ready", ...})
```

---

## 七、防止复现

1. **`asr_iflytek.py` 顶部注释** 标明接入的是大模型版（非旧版），URL 来源文档链接
2. **启动时健康检查**：server 启动后主动跑 ASR ping 测试，记录结果
3. **保留 `test_asr_direct.py`**（已删除，下次需要时重建）用于快速排查

---

*报告人：GitHub Copilot | 日期：2026-02-24*
