# TradingAgents Web UI

基于 FastAPI + WebSocket 的实时分析 Web 界面，可视化展示多智能体协同分析过程。

## 功能

- **实时流式展示**：通过 WebSocket 实时推送每个 Agent 的分析结果
- **多面板布局**：左侧执行进度 → 中间分析内容 → 右侧历史记录
- **6 大分析师报告**：市场 / 舆情 / 新闻 / 基本面 / 年报 / 产业链
- **投资辩论可视化**：多头 vs 空头实时对辩
- **风险评估三方博弈**：激进 / 保守 / 中性三方观点
- **最终决策展示**：带评级标签的投资决策卡片
- **历史记录**：SQLite 持久化，可回溯任何一次分析

## 快速开始

### 1. 安装依赖

```bash
cd /path/to/TradingAgents-Ashare-Wind
source .venv/bin/activate
pip install fastapi uvicorn aiosqlite python-dotenv
```

或使用 requirements.txt：

```bash
pip install -r web/requirements.txt
```

### 2. 确保 .env 配置正确

项目根目录的 `.env` 文件应包含 LLM 和 Wind API 配置：

```env
OPENAI_COMPATIBLE_API_KEY=your-key
TRADINGAGENTS_LLM_PROVIDER=openai_compatible
TRADINGAGENTS_LLM_BACKEND_URL=https://your-endpoint/v1
TRADINGAGENTS_DEEP_THINK_LLM=claude-sonnet-4-6
TRADINGAGENTS_QUICK_THINK_LLM=gpt-5.4-mini
TRADINGAGENTS_OUTPUT_LANGUAGE=Chinese
```

Wind API key 应配置在 `.agents/skills/wind-mcp-skill/config.json`。

### 3. 启动服务

```bash
cd web
python server.py
```

服务默认绑定 `0.0.0.0:8501`，打开浏览器访问 `http://localhost:8501`。

也可以使用 uvicorn 启动（支持热重载）：

```bash
cd web
uvicorn server:app --host 0.0.0.0 --port 8501 --reload
```

## 架构

```
web/
├── server.py           # FastAPI 后端（WebSocket + REST API + SQLite）
├── static/
│   └── index.html      # 单页前端（vanilla JS + CSS Grid）
├── requirements.txt    # Python 依赖
├── analysis.db         # SQLite 数据库（自动创建）
└── README.md           # 本文件
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 主页面 |
| `POST` | `/api/analyze` | 启动分析（`{"ticker": "600519.SH", "date": "2026-07-31"}`） |
| `WS` | `/ws/{job_id}` | WebSocket 实时事件流 |
| `GET` | `/api/history` | 历史记录列表 |
| `GET` | `/api/history/{job_id}` | 单次分析详情 |

### WebSocket 事件类型

| 事件类型 | 说明 |
|----------|------|
| `status` | 状态更新（初始化、运行中） |
| `node_start` | Agent 开始执行 |
| `node_complete` | Agent 完成执行 |
| `report` | 分析师报告内容 |
| `debate` | 辩论发言（投资辩论 / 风险评估） |
| `debate_decision` | 裁决结果 |
| `trader_plan` | 交易员方案 |
| `decision` | 最终投资决策 |
| `complete` | 分析完成 |
| `error` | 分析失败 |

## 注意事项

- 分析过程在后台线程中运行，不阻塞 Web 服务
- 每次分析耗时取决于 LLM API 响应速度，通常 3-10 分钟
- SQLite 数据库文件 `analysis.db` 自动创建在 `web/` 目录下
- 已自动清除代理环境变量（`http_proxy` 等），确保 LLM 调用直连
