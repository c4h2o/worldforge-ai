# WorldForge AI — 架构与 AI 接口说明

## 1. 分层架构

```
┌───────────── 用户/导演(人)：愿景 · 门禁确认 · 艺术与决策兜底 · 合规 ─────────────┐
│                                     ▲ 确认/纠偏          │ 结果/预览           │
┌─────────────────────────────────────┴──────────────────────▼─────────────────────┐
│  ① AI 编排层：策划/审美/生成/摆放/导演 智能体 · "生成→检查→修改→再生成"循环 + 门禁 │
└──┬──────────┬──────────┬──────────┬──────────┬──────────┬───────────────────────┘
   ▼          ▼          ▼          ▼          ▼          ▼
┌────────┐┌────────┐┌─────────┐┌────────┐┌────────┐┌─────────┐
│②语义层 ││③图像生成││④图生3D/ ││⑤资产库 ││⑥世界画布││⑦导出/   │
│Semantic││语义驱动 ││后加工    ││语义索引││布局/摆放││成片      │
│Spec    ││生图+约束││Provider  ││复用组合││环境/光照││游戏/影视 │
└────────┘└────────┘└─────────┘└────────┘└────────┘└─────────┘
   每层能力以 "AI 接口(MCP/Function Tool)" 暴露，供编排智能体调用
   底层共享：异步任务队列 · 对象存储 · 元数据库 · GPU Worker 池
```

## 2. AI 接口八大域（核心）

| 域 | 关键工具 | 说明 |
|---|---|---|
| `semantic` | parse / complete / validate | 愿景→Semantic Spec，补全、校验、人可锁定字段 |
| `image` | generateFromSpec / generateView / generatePart / edit / consistency | 语义驱动生图（提示词合成 + 布局/语义条件） |
| `img3d` | fromImage / fromMultiView / postprocess / rig / animate | 学习 Tripo：单图/多视图→网格→贴图→分割/减面/UV/绑定/动画 |
| `asset` | ingest / search / compose / variant | 资产库：语义索引、复用、组合、变体 |
| `canvas` | place / layout / environment / camera / validate | 世界画布：AI 摆放、布局、环境光照、相机、校验 |
| `critic` | review / styleConsistency | 审美批评器：评分、问题、修改建议 |
| `export` | game / film / audio | 游戏 glTF+场景JSON · 影视镜头序列+渲染 · 音频 |
| `system` | task.get/list/cancel · balance · file.upload/presign | 任务、计费、文件 |

**约定**：耗时操作（生图/生3D/渲染）一律走**异步任务**——提交返回 `task_id`，轮询 `GET /tasks/{id}` 或 Webhook 拿终态（学 Tripo）。可返回 `needs_approval` 触发**人机门禁**。建议统一封装为 **MCP 工具** 以便任意 LLM 驱动。

## 3. 图生 3D Provider（学习 Tripo 的关键抽象）

```ts
interface ImageTo3DProvider {
  fromImage(img, opts): Promise<TaskHandle>;       // 单图→3D (Tripo: image-to-model)
  fromMultiView(views, opts): Promise<TaskHandle>; // 2-4 视图 (Tripo: multiview-to-model)
  postprocess(taskId, op, opts): Promise<TaskHandle>; // segment/decimate/uv/texture/convert/complete
  rig(taskId, opts): Promise<TaskHandle>;          // 自动绑定
  animate(taskId, opts): Promise<TaskHandle>;      // 预设动画重定向
  poll(taskId): Promise<TaskState>;
}
```

实现：`MockProvider`（无 GPU，联调/CI）· `TripoProvider`（商用 API，质量保底）· `SelfHostProvider`（开源 TripoSR/SG/SF + Blender 后处理，降本）。

## 4. 异步任务模型

```
客户端 ──POST /generation/...──▶ API ──▶ 任务队列(BullMQ/Redis) ──▶ GPU Worker 池
   │◀──── task_id ─────────────────────┘                        │
   │──GET /tasks/{id} 轮询──▶ 任务状态存储 ◀──状态回写──────────────┘
   │◀── success: output.model_url / rendered_image_url / model_urls
   └──(可选) Webhook: task.completed / task.failed / balance.low
```

要点：链式复用上游 `task_id`（免下载再上传）；产物 URL 短时过期需尽快取回；按提交计费、失败不盲重提（先对账）；>60MB 预签名直传。

## 5. 数据模型（核心）

```
SemanticSpec { meta{style,seed}, world{atmosphere,terrain}, entities[{id,category,count,attributes,relations,parts}], composition }
Asset { id,name,category, model_url, thumbnail, mesh_stats, materials[], animations[], semantic_tags[], provenance{brief,spec,image_ids,provider}, parent?, version, frozen }
WorldScene { id,name,brief,spec_id,style,seed, scene_graph{environment,entities[],lights[],cameras[],zones[]}, status }
Entity { id, asset_id, transform, semantic_role, placed_by "ai|human", locked }
Task { id, type, status, progress, params, result, actor, approval{gate,state}, cost }
ShotSequence { id, scene_id, shots[{camera_path,keyframes,duration}], render_config }
HumanGate { id, step, type, payload, options[], decision, reason, actor }
AgentLog { id, run_id, agent, action, tool, args, result, ts }
```

## 6. 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js + React + TS + React Three Fiber / Three.js |
| 后端 API | Node（NestJS/Fastify）· OpenAPI |
| AI 编排 | LLM + Function Calling / MCP |
| 图像生成 | Seedream / Flux / SD（OpenAI 兼容） |
| 图生 3D | Tripo API（起步）+ TripoSR/SG/SF 自托管（降本） |
| 3D 后处理 | Blender(bpy) + glTF-Transform |
| 任务队列 | BullMQ + Redis（或 Temporal） |
| 存储 | PostgreSQL + S3（MinIO） |
| 成片渲染 | Blender EEVEE/Cycles（影视）+ Three.js（快渲） |
