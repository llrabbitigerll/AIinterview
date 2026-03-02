# YAML Format Reference — 字段类型与格式

## level_config.yaml

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| levels.{T}.label | string | ✅ | 级别显示名称 |
| levels.{T}.salary_range | string | ✅ | 薪资范围 |
| levels.{T}.candidate_selectable | bool | ✅ | 候选人是否可选 |
| levels.{T}.years_experience | string | ✅ | 经验年限 |
| levels.{T}.description | string | ✅ | 级别描述 |
| company_level_mapping.{company}.{level} | string | ✅ | 映射到T级别 |
| round_rules.{T}[].round | int | ✅ | 轮次编号(1-3) |
| round_rules.{T}[].interviewer_level | string | ✅ | 面试官T级别 |
| round_rules.{T}[].mode | string | ✅ | "single" 或 "double" |

## levels/backend.yaml & levels/frontend.yaml

每个T级别块的字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| interviewer_identity | string | ✅ | — | 面试官身份描述 |
| years_experience | string | ✅ | — | 工作经验年限 |
| daily_work | list[string] | ✅ | — | 日常工作列表 |
| concerns | list[string] | ✅ | — | 面试关注点 |
| interview_focus.technical | list[string] | ✅ | — | 技术考察重点 |
| interview_focus.behavioral | list[string] | ✅ | — | 行为考察重点 |
| question_difficulty | string | ✅ | — | 难度描述 |
| typical_question_types | list[string] | ✅ | — | 典型题目类型 |
| personality_base | string | ✅ | — | 性格基线 |
| communication_style | string | ✅ | — | 沟通风格 |
| pressure_style | string | ✅ | — | 压力风格 |
| follow_up_depth | int | ✅ | — | 追问层数 |
| follow_up_pattern | list[string] | ✅ | — | 追问模式 |
| evaluation_criteria | map[string, string] | ✅ | — | 评分维度及权重 |
| red_flags | list[string] | ✅ | — | 扣分红线 |
| stress_test_patterns | list[string] | ❌ | [] | 压力测试模式 |
| strategic_perspective | list[string] | ❌ | — | T7/T8特有 |
| senior_candidate_assessment | list[string] | ❌ | — | T7/T8特有 |
| dual_agent_role | string | ❌ | — | T7/T8特有 |
| dual_agent_focus | string | ❌ | — | T7/T8特有 |

## companies/{company}.yaml

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| company_name | string | ✅ | 公司中文名 |
| company_key | string | ✅ | 公司英文key |
| culture_style | string | ✅ | 文化风格 |
| values | list[string] | ✅ | 价值观 |
| interview_common_traits | list[string] | ✅ | 面试通用特点 |
| level_patches.{T}.personality_override | string | ❌ | 覆盖性格 |
| level_patches.{T}.extra_concerns | list[string] | ❌ | 追加关注点 |
| level_patches.{T}.coding_requirement | string | ❌ | 编码要求 |
| level_patches.{T}.interview_style_note | string | ❌ | 面试风格备注 |
| level_patches.{T}.evaluation_weight_override | map | ❌ | 覆盖评分权重 |
| level_patches.{T}.stress_test_patterns_override | list[string] | ❌ | 覆盖压力测试 |
| level_patches.{T}.dual_agent_b_style | string | ❌ | T7/T8双Agent风格 |
| known_hot_topics.backend | list[string] | ❌ | 后端高频话题 |
| known_hot_topics.frontend | list[string] | ❌ | 前端高频话题 |
| interview_process_meta | map | ❌ | 面试流程元信息 |
| offer_culture | map | ❌ | 薪酬文化 |

## bu_knowledge/{company}_{bu}_{position}.yaml

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| company | string | ✅ | 公司中文名 |
| company_key | string | ✅ | 公司英文key |
| bu | string | ✅ | BU中文名 |
| bu_key | string | ✅ | BU英文key |
| position_type | string | ✅ | "backend" 或 "frontend" |
| context_intro | string | ✅ | BU简介 |
| tech_stack | map | ✅ | 技术栈 |
| core_domains | list[Domain] | ✅ | 核心业务域 |
| core_domains[].name | string | ✅ | 域名称 |
| core_domains[].architecture | string | ❌ | 架构描述 |
| core_domains[].keywords | list[string] | ❌ | 关键词 |
| core_domains[].high_frequency_questions | list[string] | ❌ | 高频面试题 |
| interview_depth_by_target_level | map | ❌ | 按级别考察深度 |
| current_pain_points | list[string] | ❌ | 团队痛点 |
| team_specific_culture | list[string] | ❌ | 团队文化 |
| common_interview_topics | list[string] | ❌ | 通用面试话题 |

## 最小可用配置模板

### companies/minimal.yaml

```yaml
company_name: 示例公司
company_key: example
culture_style: "务实高效"
values: [创新, 协作]
interview_common_traits:
  - "注重实战能力"
level_patches: {}
```

### bu_knowledge/minimal.yaml

```yaml
company: 示例公司
company_key: example
bu: 工程部
bu_key: engineering
position_type: backend
context_intro: "核心后端团队"
tech_stack:
  primary_languages: [Java, Go]
core_domains:
  - name: 核心服务
    high_frequency_questions:
      - "系统设计相关问题"
```
