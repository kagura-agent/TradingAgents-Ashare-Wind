# TradingAgents Web UI

实时可视化多智能体协同分析过程：FastAPI + WebSocket 后端，React + TypeScript 前端。

- **左栏**执行进度 —— 14 个图节点的实时状态
- **中栏**分析内容 —— 6 份分析师报告、投资辩论、交易计划、风控三方博弈、最终决策
- **右栏**历史记录 —— SQLite 持久化，可回溯任何一次分析
- 报告按 Markdown 渲染（含 GFM 表格）；评级徽章直接消费后端 `signal` 的 5 档评级，不从文本猜
- 断线自动重连：服务端回放事件历史，前端 reducer 幂等，补齐期间不会重复渲染

## 快速开始

### 1. 安装 Python 依赖

```bash
pip install -e ".[web]"
```

### 2. 构建前端

前端产物不入库，需要先构建一次（Node 20+）：

```bash
cd web/frontend
npm ci
npm run build          # 输出到 web/static/
```

未构建就启动服务时，`/` 会返回 503 并提示这一步。

### 3. 配置 `.env`

项目根目录的 `.env` 需包含 LLM 与 Wind 配置：

```env
OPENAI_COMPATIBLE_API_KEY=your-key
TRADINGAGENTS_LLM_PROVIDER=openai_compatible
TRADINGAGENTS_LLM_BACKEND_URL=https://your-endpoint/v1
TRADINGAGENTS_DEEP_THINK_LLM=claude-sonnet-4-6
TRADINGAGENTS_QUICK_THINK_LLM=gpt-5.4-mini
TRADINGAGENTS_OUTPUT_LANGUAGE=Chinese
```

Wind API key 配置在 `.agents/skills/wind-mcp-skill/config.json`。

### 4. 启动

```bash
python -m web.server
```

默认绑定 `0.0.0.0:8501`，浏览器访问 `http://localhost:8501`。

也可以直接用 uvicorn（后端热重载）：

```bash
uvicorn web.server:app --host 0.0.0.0 --port 8501 --reload
```

## 开发

前端开发用 Vite dev server，`/api` 与 `/ws` 已代理到 `127.0.0.1:8501`：

```bash
# 终端 A —— 后端
TRADINGAGENTS_WEB_DEMO=1 python -m web.server

# 终端 B —— 前端（热更新）
cd web/frontend && npm run dev
```

### 演示模式

`TRADINGAGENTS_WEB_DEMO=1` 时不调用 LLM / Wind，改为回放一份固定 fixture
（`web/demo.py`）。它走的是与生产完全相同的事件推导与持久化路径，因此适合调 UI、
跑前端联调、以及不烧配额地演示。

### 测试

```bash
pytest -q tests/test_web_*.py        # 后端 + 前后端事件契约
cd web/frontend && npm run test      # Vitest + Testing Library
cd web/frontend && npm run lint      # ESLint
```

## 架构

```
web/
├── events.py           # 纯事件推导状态机（无 I/O，可直接单测）
├── jobs.py             # 线程安全 job 注册表 + 发布订阅
├── store.py            # SQLite 持久化（路径可注入）
├── runner.py           # 图执行编排
├── demo.py             # 演示模式 fixture
├── server.py           # FastAPI 路由 + 入口
├── static/             # 前端构建产物（不入库）
└── frontend/           # React + TypeScript + Vite 源码
    └── src/
        ├── types/events.ts             # 事件的 discriminated union
        ├── hooks/useAnalysisStream.ts  # WS 连接 + 指数退避重连
        ├── lib/                        # reducer / 评级 / 节点 / 视图模型
        ├── components/                 # Timeline / ReportCard / DebatePanel / …
        └── styles/                     # 设计 token（深浅色）
```

图以 `stream_mode="values"` 流式执行，**每个 chunk 都是完整累积 state**，
`events.py` 负责与已发射内容做差分，把它变成只追加的事件流。

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/meta` | 运行模式（`{"demo": bool}`） |
| `POST` | `/api/analyze` | 启动分析（`{"ticker": "600519.SH", "date": "2026-07-31"}`） |
| `WS` | `/ws/{job_id}` | 实时事件流；新订阅者先收到完整历史回放 |
| `GET` | `/api/history` | 历史记录列表 |
| `GET` | `/api/history/{job_id}` | 单次分析详情 |

### 事件类型

`web/events.py` 的 `EVENT_TYPES` 是唯一来源，
`web/frontend/src/types/events.ts` 是它的 TypeScript 镜像，
`tests/test_web_event_contract.py` 保证两者不漂移。

| 事件类型 | 说明 |
|----------|------|
| `status` | 状态更新（初始化、运行中） |
| `node_start` / `node_complete` | Agent 开始 / 完成执行 |
| `report` | 分析师报告内容 |
| `debate` | 辩论发言（投资辩论 / 风险评估） |
| `debate_decision` | 裁决结果 |
| `trader_plan` | 交易员方案 |
| `decision` | 最终投资决策 |
| `complete` | 分析完成，附权威 `signal` |
| `error` | 分析失败 |

`ping` 是 WebSocket 保活帧，不属于分析事件，前端会忽略它（否则会打乱回放的下标）。

## 注意事项

- 分析在后台线程运行，不阻塞事件循环；一次通常耗时 3-10 分钟
- SQLite 数据库 `web/analysis.db` 自动创建（WAL 模式，另有 `-wal`/`-shm` 附属文件）
- 启动时会清除代理环境变量（`http_proxy` 等），确保 LLM 调用直连
- 无认证、无多用户隔离 —— 这是本地单机工具，不要直接暴露到公网
