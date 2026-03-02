# Architecture — 三层知识库继承体系

## 架构概览

```
Layer 1: levels/backend.yaml (或 frontend.yaml)
    ↓ 基础行为模板（T1~T8 通用面试官人设）
Layer 2: companies/{company}.yaml
    ↓ 公司文化补丁（覆盖/增强 Layer 1）
Layer 3: bu_knowledge/{company}_{bu}_{position}.yaml
    ↓ BU技术知识（注入具体技术语境）
    
最终输出 → 面试官 System Prompt
```

## 合并顺序

`PersonaBuilder.build()` 的合并逻辑：

1. **加载 Layer 1**：根据 `position_type` 和 `interviewer_level` 从 `levels/backend.yaml` 或 `levels/frontend.yaml` 中取出对应级别块
2. **加载 Layer 2**：根据 `company_key` 从 `companies/` 目录加载公司文件，提取 `level_patches[interviewer_level]` 中的覆盖字段
3. **合并 Layer 1 + Layer 2**：Layer 2 的 `*_override` 字段替换 Layer 1 同名字段，`extra_*` 字段追加到 Layer 1 对应列表
4. **加载 Layer 3**（可选）：根据 `company_key + bu_key + position_type` 查找 BU 文件
5. **注入 Layer 3**：将 BU 的 `tech_stack`、`core_domains`、`current_pain_points` 等注入到最终 prompt

## 字段覆盖规则

| Layer 2 字段后缀 | 行为 |
|----------------|------|
| `*_override` | 完全替换 Layer 1 同名字段 |
| `extra_*` | 追加到 Layer 1 同名列表 |
| `*_note` | 作为面试官的额外注意事项 |
| 其他 | 作为新字段直接注入 |

## 缺失处理

- 缺少 Layer 2：使用 Layer 1 默认值，无公司特色
- 缺少 Layer 3：使用 Layer 1 + Layer 2 合并结果，无 BU 技术细节
- 缺少某个字段：使用 Layer 1 中的默认值

## 文件命名约定

- Layer 2: `companies/{company_key}.yaml`
- Layer 3: `bu_knowledge/{company_key}_{bu_key}_{position_type}.yaml`

## 数据流图

```
InterviewConfig
    ├── company_key ──→ companies/{key}.yaml
    ├── bu_key       ──→ bu_knowledge/{company}_{bu}_{pos}.yaml  
    ├── position_type ──→ levels/{pos}.yaml
    └── target_level  ──→ level_config.yaml (查轮次规则)
                              ↓
                    interviewer_level + is_double_agent_mode
                              ↓
                    PersonaBuilder.build(...)
                              ↓
                    合并后的 System Prompt
```
