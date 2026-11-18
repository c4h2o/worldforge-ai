# WorldForge AI — Phase 1 MVP 服务端骨架

> 目标：**Tripo 风格异步任务 API + 资产库 + 世界画布(Three.js)**，跑通"愿景 → 语义 → 生图/生3D 任务 → 资产库 → 世界画布 → 场景"。
> 当前实现：**零依赖 Node http**（`apps/api/src/server.mjs`），默认 Mock Provider（程序化资产），**开箱即跑**；生产可换 Fastify + BullMQ + Postgres/Redis（见 §6）。

## 1. 快速开始

```bash
npm run dev        # = node apps/api/src/server.mjs  （零依赖，无需 install）
# 打开 http://localhost:3000  →  世界画布（自动创建默认场景）
```

## 2. 异步任务模型（学 Tripo）

- `POST /api/generation/*` → 立即返回 `{ task_id }`，异步处理。
- `GET /api/tasks/:id` → 轮询状态：`queued → running → success/failed`，含 `progress` 与 `result`。
- 提交即计费/记账；链式复用上游 `task_id`；产物 URL 短时过期需尽快取回（真实 Provider）。

## 3. API 契约

| 方法 | 路径 | 说明 | 请求体 | 返回 |
|---|---|---|---|---|
| GET | `/api/health` | 健康检查 | — | `{ok, provider, tasks, assets, scenes}` |
| POST | `/api/generation/image-to-model` | 单图生 3D | `{input, category?, face_limit?}` | `{task_id}` |
| POST | `/api/generation/multiview-to-model` | 多视图生 3D | `{inputs[], category?}` | `{task_id}` |
| GET | `/api/tasks/:id` | 任务状态 | — | Task |
| GET | `/api/tasks` | 任务列表 | — | `{tasks[]}` |
| GET | `/api/assets` | 资产库 | — | `{assets[]}` |
| POST | `/api/scenes` | 创建世界场景（语义→任务→摆放） | `{brief}` | WorldScene |
| GET | `/api/scenes` | 场景列表 | — | `{scenes[]}` |
| GET | `/api/scenes/:id` | 场景详情 | — | WorldScene |
| GET | `/` | 世界画布（Three.js） | — | HTML |
| GET | `/assets/*` · `/images/*` · `/scenes/*` | 静态产物 | — | 文件 |

**Task 结构**：`{id, type, status, progress, params, result, createdAt}`；`result = {model_url, thumbnail, asset_id, category}`。
**WorldScene**：`{id, name, brief, spec_id, style, seed, scene_graph{environment, lights, cameras, zones, entities[]}, status}`。

## 4. 目录

```
apps/api/src/server.mjs   # HTTP 服务 + 路由 + 任务队列(内存) + 资产库 + 场景 + 世界画布
apps/demo/src/            # 复用的语义解析 / GLB / PNG 生成器（零依赖）
packages/core/            # 类型 + AI 工具定义
packages/providers/       # ImageTo3DProvider 抽象 + Mock/Tripo/TripoSR
packages/orchestrator/    # AI 编排 + 审美批评
```

## 5. 实现要点

- **Provider 抽象**：`createApp({provider})` 或 `IMG3D_PROVIDER=mock|tripo|triposr`。默认 `mock`（程序化 GLB）；填 `TRIPO_API_KEY` 切 `tripo`。
- **任务队列**：当前为**内存 Map + 异步处理**（`enqueue` → `processTask`）；生产替换为 BullMQ/Redis。
- **资产库**：`Map<id, Asset>`，含语义标签、来源链、缩略图；生产持久化到 Postgres + S3。
- **世界画布**：`POST /api/scenes` 内部对每个语义实体提交生 3D 任务并摆放（网格/分区），前端 Three.js 加载 GLB 呈现。

## 6. 生产路径（升级为 Fastify + BullMQ + Postgres/Redis）

当前零依赖版本适合 Demo/联调；规模化为生产时按以下结构替换（**接口已抽象，业务不动**）：

```
apps/api/        # Fastify：路由不变，注入 BullMQ 队列代替内存队列
  src/server.ts          # Fastify 装配 + OpenAPI
  src/routes/generation.ts
  src/routes/tasks.ts
  src/queue.ts           # BullMQ Producer (connection: Redis)
  src/store.ts           # Postgres (元数据) + S3/MinIO (资产)
apps/worker/     # BullMQ Worker（消费生成任务，调 ImageTo3DProvider，写对象存储）
  src/worker.ts
  src/handlers.ts
```

- 队列：`BullMQ + Redis`（docker-compose 已含 redis/postgres/minio）。
- 存储：`PostgreSQL`（任务/资产/场景元数据）+ `S3/MinIO`（GLB/PNG/渲染）。
- 一致性：`idempotency_key` 防重复提交；失败对账；`Webhook` 回调（可选）。

## 7. 下一步

- [ ] 接真实 `TripoProvider`（`TRIPO_API_KEY`）或 `SelfHostProvider`（TripoSR/SG/SF）验证质量。
- [ ] 编排智能体接 LLM Function Calling / MCP（`packages/orchestrator` 已就绪）。
- [ ] 前端世界画布增强：拖拽摆放、环境/光照编辑、资产复用搜索。
- [ ] 影视镜头序列（`export.film`）与渲染。
