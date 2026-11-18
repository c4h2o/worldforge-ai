# WorldForge AI — Phase 1 MVP 服务端骨架

> 目标：**自研异步任务 API + 资产库 + 世界画布(Three.js)**，跑通"愿景 → 语义 → 生图/生3D 任务 → 资产库 → 世界画布 → 场景"。
> 当前实现：**零依赖 Node http**（`apps/api/src/server.mjs`），默认 Mock Provider（程序化资产），**开箱即跑**；生产可换 Fastify + BullMQ + Postgres/Redis（见 §6）。

## 1. 快速开始

```bash
npm run dev        # = node apps/api/src/server.mjs  （零依赖，无需 install）
# 打开 http://localhost:4321  →  世界画布（自动创建默认场景）
```

## 2. 异步任务模型（自研）

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

**图像生成 Provider**（Phase 1e）：`image.generateFromSpec` 接真实文生图（SenseNova `sensenova-u1.5-lite`，OpenAI 兼容 `/images/generations`）。`IMG_PROVIDER=mock|sensenova` + `SENSENOVA_API_KEY`；缺 key 优雅回退程序化占位。端点 `POST /api/images/generate {prompt,size}` → `{image_url}`。语义规范 → 提示词（`promptFromSpec`：风格+时段+天气+场景元素+构图）。

**影视产出**（Phase 1d）：`POST | GET /api/scenes/:id/film` → 自动生成镜头序列（环绕开场 + 实体特写）`{film_id, shots[], duration, fps}`；`GET /film.html?id=:sceneId` 为浏览器端**成片播放/录制**（Three.js 相机沿镜头插值 + `MediaRecorder` 录 WebM 可下载）。Agent 工具：`export.film`。

**世界画布编辑**（Phase 1b）：`PATCH /api/scenes/:id/environment`（环境/光照）、`POST /api/scenes/:id/entities`（资产库复用放置）、`PATCH | DELETE /api/scenes/:id/entities/:eid`（移动/删除），均实时落盘 `output/scenes/:id.json`。前端画布支持**拖拽移动 + 资产库搜索复用 + 环境光照面板**。

**Task 结构**：`{id, type, status, progress, params, result, createdAt}`；`result = {model_url, thumbnail, asset_id, category}`。
**WorldScene**：`{id, name, brief, spec_id, style, seed, scene_graph{environment, lights, cameras, zones, entities[]}, status}`。

## 4. 目录

```
apps/api/src/server.mjs   # HTTP 服务 + 路由 + 任务队列(内存) + 资产库 + 场景 + 世界画布
apps/demo/src/            # 复用的语义解析 / GLB / PNG 生成器（零依赖）
packages/core/            # 类型 + AI 工具定义
packages/providers/       # ImageTo3DProvider 抽象 + Mock/Local(自研重建引擎)
packages/orchestrator/    # AI 编排 + 审美批评
```

## 5. 实现要点

- **Provider 抽象**：`createApp({provider})` 或 `IMG3D_PROVIDER=mock|local`（`.env` 加载）。
  - `mock`（默认）：程序化 GLB，零依赖、无凭据可跑（CI/联调）。
  - `local`：自研重建引擎（自托管开源模型）。任务管线 = `fromImage(input)` → 轮询 `/tasks/:id` → 下载 `model_url` → 入库为本地 `/assets/:id.glb`；`result.upstream_task` 保留上游 id。
  - `mock`（默认）：程序化 GLB，零依赖、无凭据可跑（CI/联调）。
  - **优雅回退**：真实 Provider 构造失败（如缺 key）→ 自动回退 `mock`，`/api/health` 返回 `provider_error` 说明原因，服务不中断。
- **任务队列**：当前为**内存 Map + 异步处理**（`enqueue` → `processTask`）；生产替换为 BullMQ/Redis。
- **资产库**：`Map<id, Asset>`，含语义标签、来源链、缩略图；生产持久化到 Postgres + S3。
- **世界画布**：`POST /api/scenes` 内部对每个语义实体提交生 3D 任务并摆放（网格/分区），前端 Three.js 加载 GLB 呈现。

## 6. AI 编排智能体（LLM Function Calling）

> 让 **LLM 自主决定**调用哪些 AI 接口、传什么参，服务端分发到真实管线，循环直到 LLM 说完成。零依赖，`fetch` 即可。

- `POST /api/agent/run {brief, provider:'mock'|'llm', apiKey?, model?}` → `{log[], messages[], scene_id}`。`provider='mock'` 用 **MockLLM**（离线脚本，CI/无 key 联调）；`'llm'` 走 OpenAI 兼容 `chat/completions` + `tools`（Function Calling）。
- `GET /api/agent/tools` → 工具清单（MCP 风格发现）：`semantic.parse / image.generateFromSpec / img3d.fromImage / asset.ingest / canvas.layout / critic.review / export.game`。
- **Agent 循环**：LLM 返回 `tool_calls` → 服务端 `dispatch[工具名]` 执行并回填结果 → 再交给 LLM；无 `tool_calls` 即完成。
- **人机门禁**：工具可返回 `needs_approval:true`，Agent 把它透传给调用方，用户确认后继续（风格/内容/合规人工把关）。
- **环境变量**：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`AGENT_PROVIDER=mock|llm`。

```bash
# 真实 LLM 驱动
AGENT_PROVIDER=llm LLM_API_KEY=sk-... npm run dev
curl -s -X POST http://localhost:4321/api/agent/run -H 'Content-Type: application/json' \
  -d '{"provider":"llm","brief":"一座雨夜赛博朋克港口"}'
```

## 7. 生产路径（升级为 Fastify + BullMQ + Postgres/Redis）（升级为 Fastify + BullMQ + Postgres/Redis）

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

## 8. 下一步

- [ ] 接真实 `LocalReconstructionProvider`（`LOCAL_RECON_ENDPOINT`，自托管开源重建模型）验证质量。
- [ ] 编排智能体接 LLM Function Calling / MCP（`packages/orchestrator` 已就绪）。
- [ ] 前端世界画布增强：拖拽摆放、环境/光照编辑、资产复用搜索。
- [ ] 影视镜头序列（`export.film`）与渲染。
