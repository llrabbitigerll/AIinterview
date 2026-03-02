# Quick Start — 5步新增公司流程

## 概览

本系统使用三层YAML知识库生成面试官人设。新增一家公司只需5步。

## 步骤

### Step 1: 在 `level_config.yaml` 添加级别映射

```yaml
company_level_mapping:
  your_company:
    L1: T1
    L2: T2
    # ...
```

### Step 2: 创建公司文化文件

在 `companies/` 目录下创建 `your_company.yaml`：

```yaml
company_name: 你的公司
company_key: your_company
culture_style: "公司文化描述"
values: [价值观1, 价值观2]
interview_common_traits:
  - "面试特点1"
level_patches:
  T1:
    extra_concerns: ["关注点1"]
```

### Step 3: 创建BU技术知识文件

在 `bu_knowledge/` 目录下创建 `your_company_bu_position.yaml`：

```yaml
company: 你的公司
company_key: your_company
bu: 事业部名称
bu_key: bu_name
position_type: backend  # 或 frontend

context_intro: "BU简介"
tech_stack:
  primary_languages: [Go, Java]
core_domains:
  - name: 核心域
    high_frequency_questions:
      - "高频面试题"
```

### Step 4: 验证YAML可加载

```bash
cd server
python -c "
import yaml
yaml.safe_load(open('app/knowledge/companies/your_company.yaml', encoding='utf-8'))
print('✅ OK')
"
```

### Step 5: 测试面试官生成

```bash
python -c "
from app.agents.persona_builder import DynamicPersonaBuilder
from app.models.schemas import InterviewConfig
cfg = InterviewConfig(
    interview_id='test', company='你的公司',
    business_unit='事业部', bu_key='bu_name',
    position_type='backend', target_level='T3', round=1
)
p = DynamicPersonaBuilder()
prompt = p.build(cfg, interviewer_level='T3', agent_role='agent_b')
print(prompt[:500])
"
```

## 最小可用配置

只需 Layer 2（公司文件）即可运行。Layer 3（BU知识）为可选增强。
如果缺少某层YAML，系统会使用上一层的默认值。
