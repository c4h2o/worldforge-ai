# WorldForge · AI 世界构建器 — 项目规划文档

> 版本：v0.1　|　类型：产品与技术规划　|　定位：**AI 自主驱动的虚拟世界素材生产与搭建平台**
>
> 一句话：**用户给一个"世界愿景"，AI 把它语义化 → 生图 → 生 3D → 资产库 → 摆进世界画布；每一步都通过"AI 接口"由 AI 自主执行，人在关键节点做确认与 AI 无法完成的艺术/决策类工作；产出可玩场景或可渲染影视镜头。**
>
> 核心能力：**自研图生 3D 引擎**（单图/多视图→网格→贴图→后处理→可进引擎的资产），但不复刻其平台，只吸收其"异步生成管线 + 资产生产链路"思想。

---

## 0. 文档导航
1. 项目背景与目标
2. 核心概念
3. 总体架构
4. 核心工作流（语义→图→3D→资产→世界画布）
5. AI 接口体系（AI 工具层 + 编排智能体 + 人机协作）
6. 模块设计（语义驱动生成 / 图生 3D / 资产库 / 世界画布 / 导出）
7. 语义规范（Semantic Spec 数据模型）
8. 技术栈选型
9. 数据模型与存储
10. 应用场景（游戏 / 影视）
11. 迭代路线图（MVP → V1 → V2）
12. 风险与对策
13. 附录：AI 接口清单与 MCP 化建议

---

## 1. 项目背景与目标

### 1.1 背景
- AI 已能"语义→图"（文生图）与"图→3D"（单图 0.5s 级重建、多视图高保真、可进引擎）。
- 但把这些能力**串成一条由 AI 自主驱动的"造世界"流水线**仍是空白：多数工具要人一步步点选、喂提示词、手动摆放。
- 本项目把 AI 从"辅助工具"提升为**自主操盘手**：人定愿景与规则，AI 完成生成、加工、摆放、成片，人只兜底。

### 1.2 目标
1. **AI 主责**：语义驱动生图 → 图生 3D → 资产入库 → 世界画布放置，全流程由 AI 调用"AI 接口"完成。
2. **人机协作**：人负责 AI 做不了的事——世界观/审美定调、关键门禁（approval gate）确认、最终艺术判断、合规与版权、复杂手工修整。
3. **双产出**：**游戏**（可玩/可导出的场景）与**影视**（镜头序列 + 渲染成片）。
4. **可积累**：所有生成物进入**资产库**，带语义标签与关系，可被 AI 复用、组合、迭代。

### 1.3 非目标（本次不做）
- 不做通用 3D 建模软件、不做实时多人联机引擎（后续可扩展）、不追平工业级精度（优先"可玩/可看"）。

### 1.4 成功标准
- 一句"世界愿景"能端到端产出：≥10 个语义一致、风格统一的 3D 资产 + 1 个摆放完成的可探索场景 + 1 段镜头序列。
- 单资产全流程 **AI 自主率 ≥ 80%**（人仅需在门禁点确认/纠偏）。
- 生成资产可直接进 Three.js/Blender/游戏引擎（glTF/GLB，可绑定、可拆分部件）。

---

## 2. 核心概念

| 概念 | 含义 |
|---|---|
| **世界愿景（World Brief）** | 用户输入的一句话/一份世界观文档，如"一座雨夜赛博朋克港口" |
| **语义规范（Semantic Spec）** | 把愿景结构化的 JSON——实体、类别、属性、空间关系、风格、构图；是驱动生图的"结构化语义" |
| **语义驱动生图** | 用 Semantic Spec（而非裸提示词）作为**条件/约束**驱动文生图：类别→部件→属性→关系→风格，控制更稳、可复现、可局部编辑 |
| **图生 3D（Image→3D）** | 自研：单图/多视图 → 网格 + 贴图 + 后处理（分割/减面/UV/绑定/动画）→ 可用资产 |
| **资产（Asset）** | 可复用的 3D 对象：网格+材质+贴图+部件+动画+语义标签+来源链 |
| **资产库（Asset Library）** | 语义索引、可检索、可组合的资产集合 |
| **世界画布（World Canvas）** | 空间画布：把资产按语义/布局摆放成场景（实体+变换+环境+光照+相机），是世界的"容器" |
| **AI 接口（AI Interface）** | 把每个能力封装成 **AI 可调用的工具**（函数/端点/MCP tool）；AI 编排智能体通过它自主操作 |
| **AI 编排智能体（Orchestrator）** | 主智能体：读愿景→规划→调用 AI 接口→检查→修改→再生成→门禁→产出 |
| **人机门禁（Human Gate）** | 关键节点暂停，AI 给出选项/理由，人确认/否决/微调；人做 AI 做不了的事 |
| **任务（Task）** | 自研**异步任务模型**：提交即返回 `task_id`，轮询/Webhook 拿结果 |
| **镜头序列（Shot Sequence）** | 影视产出：相机路径/关键帧/时间线/镜头表 + 渲染 |

---

## 3. 总体架构

```
┌────────────────────────── 用户 / 导演（人） ──────────────────────────┐
│  给出"世界愿景" · 门禁确认/否决 · 艺术与决策兜底 · 合规版权           │
└──────────────▲─────────────────────────────────────────────┬─────────┘
               │ 愿景/门禁/纠偏                                 │ 结果/预览
┌──────────────┴─────────────────────────────────────────────▼─────────┐
│                    ① AI 编排层 (Orchestrator Agent)                   │
│   策划Agent · 审美Agent(批评家) · 生成Agent · 摆放Agent · 导演Agent     │
│   "生成→检查→修改→再生成"循环 + 门禁请求 + 资产复用决策                 │
└───┬──────────────┬──────────────┬──────────────┬─────────────┬───────┘
    │              │              │              │             │
    ▼              ▼              ▼              ▼             ▼
┌────────┐  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐
│②语义层 │  │③图像生成层 │  │④图生3D/加工 │  │⑤资产库    │  │⑥世界画布    │
│语义解析│→ │语义驱动生图│→ │Image→3D    │→ │语义索引   │→ │布局/摆放     │
│Scene   │  │+风格/约束 │  │后处理/分割 │  │复用/组合  │  │环境/光照/相机│
│Spec    │  │多视角一致性│  │UV/绑定/动画│  │来源链     │  │场景图持久化  │
└────────┘  └───────────┘  └────────────┘  └──────────┘  └──────┬───────┘
                                                                 │
                                                    ┌────────────▼─────────┐
                                                    │⑦导出/成片             │
                                                    │ 游戏: glTF+场景+运行时 │
                                                    │ 影视: 镜头序列+渲染    │
                                                    └──────────────────────┘
       每层的能力都以 "AI 接口" 暴露，供编排智能体调用（②~⑦ 皆 AI 可调）
       底层共享: 异步任务队列 · 对象存储 · 元数据库 · GPU Worker 池
```

### 3.1 分层职责
| 层 | 职责 | 由谁执行 |
|---|---|---|
| ① 编排层 | 规划、调用、检查、循环、门禁 | **AI 智能体** |
| ② 语义层 | 愿景→Semantic Spec；补全/校验语义 | AI（人可审阅） |
| ③ 图像生成层 | Spec→多张一致概念图（多视角/部件） | AI（人可选风格） |
| ④ 图生 3D/加工层 | 图→网格→贴图→后处理→可绑定资产 | **AI（核心自研）** |
| ⑤ 资产库 | 语义索引、去重、复用、版本 | AI 写入，人可标注 |
| ⑥ 世界画布 | 布局、摆放、环境、光照、相机、场景图 | **AI 自主，人微调** |
| ⑦ 导出/成片 | 游戏包导出 / 影视镜头渲染 | AI（人定调） |

---

## 4. 核心工作流

### 4.1 端到端主流程（AI 自主为主，人只在门禁）
```
[人] 世界愿景: "一座雨夜赛博朋克港口"
  │
  ▼ ①AI 语义解析
Semantic Spec (JSON): 场景/实体/属性/关系/风格
  │
  ▼ ②AI 生图 (语义驱动, 多视角/部件)
概念图组: 港区全景 · 集装箱 · 起重机 · 机器人 · 雾雨霓虹
  │
  ▼ ③AI 图生3D + 后加工  (自研)
资产: 每个概念图 → 网格+贴图+部件(+可选绑定/动画)
  │
  ▼ ④AI 入库
Asset Library (语义标签/来源链/缩略图)
  │
  ▼ ⑤AI 布局与摆放  ──► World Canvas (实体+变换+环境+光照+相机)
  │
  ▼ ⑥AI 检查与批评 (审美Agent: 风格统一? 比例? 遮挡? 可读性?)
  │         ├─ 不通过 → 回 ②/③/⑤ 修改 (自动循环, 上限次数)
  │         └─ 通过 → [门禁] 人确认/微调
  ▼ ⑦AI 产出
  ├─ 游戏: 导出 glTF + 场景JSON + 可玩预览
  └─ 影视: 镜头序列 + 关键帧 + 渲染 + 配乐/字幕
```

### 4.2 三类循环
1. **生成-检查-修改循环**：自研循环强调的 `生成→检查→修改→再生成`，本项目做成通用循环，任何层都可重跑。
2. **资产复用循环**：资产库命中→直接复用/变体；未命中→生成；组合成更大资产（如"集装箱堆场"= 多个"集装箱"）。
3. **门禁循环**：AI 每完成一段，给出**候选与理由**，人确认/选择/否决；否决则 AI 带反馈重跑（人把"偏好"写回语义约束）。

### 4.3 人机职责划分（核心）
| 事项 | 谁 | 说明 |
|---|---|---|
| 愿景定义、审美/世界观定调 | **人** | AI 做不了"想要什么"的根本决策 |
| 语义解析、补全、一致性 | AI | 人可审阅、可锁字段 |
| 生图、生 3D、后处理 | AI | 全自动 |
| 风格统一、部件拆分、贴图 | AI（自研 后处理链） | 人可选预设/参考图 |
| 布局、摆放、光照、相机 | AI | 人可拖拽微调 |
| 部件/网格的手工修整 | 人 | 复杂拓扑/接缝等 AI 难做的精细活 |
| 关键门禁（风格、内容、合规、版权） | **人** | 最终拍板 |
| 叙事/情感/镜头最终取舍 | **人** | 影视的"导演意志" |
| 批量生成、变体、迭代 | AI | 高吞吐 |

---

## 5. AI 接口体系（本项目核心）

### 5.1 设计原则
- **一切皆 AI 接口**：每个能力封装为"AI 可调用工具"，编排智能体像调函数一样调它们。
- **异步任务**：耗时操作（生图/生 3D/渲染）走 **任务队列**，返回 `task_id`，自研。
- **MCP/工具化**：建议统一为 **MCP（Model Context Protocol）工具** 或 LLM Function Calling schema，便于任何模型调用。
- **幂等与计费感知**：生成类任务提交即计费/计积分，失败可对账不重复提交。
- **门禁内建**：AI 接口可返回 `needs_approval`，编排层据此暂停并请求人。

### 5.2 AI 接口清单（工具目录，按域）
> 形如 `domain.action(params) → {task_id | result}`；`*Gen` 类为异步。

**A. 语义域**
- `semantic.parse(worldBrief) → SemanticSpec`
- `semantic.complete(spec, constraints) → SemanticSpec`（补全缺失属性/一致性校验）
- `semantic.validate(spec) → {ok, issues}`

**B. 图像生成域（语义驱动）**
- `image.generateFromSpec(spec, {views, styleRef}) → task`（主入口：语义→概念图）
- `image.generateView(spec, viewAngle) → task`（前/侧/背/顶）
- `image.generatePart(spec, partId) → task`（部件级，如"机械臂""门"）
- `image.edit(asset, instruction) → task`（局部编辑/风格迁移）
- `image.consistency(multiViewImages) → {score, issues}`（多视角一致性检查）

**C. 图生 3D 域（自研）**
- `img3d.fromImage(image, {model, faceLimit, texture}) → task`（单图→3D）
- `img3d.fromMultiView(views, {angleMap}) → task`（对应 `multiview-to-model`）
- `img3d.postprocess(taskId, {type, params}) → task`
  - `segment`（语义部件拆分，网格/部件分割）
  - `decimate`（减面/重拓扑，`face_limit`）
  - `uv`（重展 UV）、`texture`（重贴图）、`complete`（补全修复）、`convert`（GLTF/FBX/OBJ/STL/USDZ）
- `img3d.rig(taskId, {spec}) → task`（自动绑定）
- `img3d.animate(taskId, {presets}) → task`（预设动画重定向）

**D. 资产库域**
- `asset.ingest(asset3d, {semanticTags, sourceChain}) → assetId`
- `asset.search(semanticQuery) → assets`（语义向量+标签检索）
- `asset.compose(assetIds[], {rules}) → assetId`（组合成更大资产）
- `asset.variant(assetId, {delta}) → task`（变体生成）

**E. 世界画布域**
- `canvas.place(assetId, {zone, constraints}) → task`（AI 决定位置/朝向/比例/关系）
- `canvas.layout(spec, {rules}) → placementPlan`（批量摆放规划：分区/道路/群落/碰撞避让）
- `canvas.environment({weather, timeOfDay, lighting}) → task`
- `canvas.camera({shot, path}) → task`（相机/运镜）
- `canvas.validate(sceneGraph) → {ok, issues}`（遮挡/穿插/性能/语义一致性）

**F. 检查与批评域（审美 Agent）**
- `critic.review(assetOrScene, {criteria}) → {score, issues, suggestions}`
- `critic.styleConsistency(scene) → {score, issues}`

**G. 导出/成片域**
- `export.game(sceneId, {engine, format}) → task`（glTF/GLB + 场景 JSON + 运行时包）
- `export.film(sceneId, {shotList, renderEngine, res}) → task`（Blender/EEVEE 或 Three.js 逐帧）
- `export.audio({score, voiceover}) → task`（配乐/音效/旁白，可选）

**H. 系统域**
- `task.get(taskId)`、`task.list(ids)`、`task.cancel`
- `account.balance`、`account.usage`
- `file.upload`、`file.presign`（>60MB 直传）

### 5.3 编排智能体（Orchestrator）行为
```
loop {
  plan = planner.plan(brief, state)          // 分解子任务 + 依赖图
  for step in plan:
     result = await callAiInterface(step)     // 调 5.2 的工具
     if result.needsApproval:  humanGate(step, result)   // 人确认/否决/给偏好
     feedback = critic.review(result)         // 审美检查
     if !feedback.ok and retries<max: refine(step, feedback)  // 带反馈重跑
     else: commit(result)
}
```

---

## 6. 模块设计

### 6.1 语义驱动生图（本项目特色）
- **为什么语义驱动**：纯提示词不稳、难复现、难局部控制。改用**结构化 Semantic Spec** 作为条件/约束。
- **两种实现路线**（可并存）：
  1. **提示词合成**：Spec → 高质量 prompt 模板（含类别/属性/关系/风格/构图），走文生图（Seedream/Flux/SD）。
  2. **结构化条件**：Spec → **布局框/语义图/ControlNet/参考图** 作为条件注入（layout-to-image、semantic map），控制每个实体位置与形态。
- **多视角与部件一致性**：同一 Spec 生成前/侧/背视图 + 部件图，供图生 3D 的多视图输入与部件拆分。
- **风格锁定**：`styleRef`（风格参考/LoRA/风格 token）+ `seed`，保证同世界资产风格统一。

### 6.2 图生 3D（自研）
- **Provider 抽象**（关键，便于换源）：
  ```
  interface ImageTo3DProvider {
    fromImage(img, opts): Promise<taskId>
    fromMultiView(views, opts): Promise<taskId>
    postprocess(taskId, op, opts): Promise<taskId>
    rig(taskId, opts): Promise<taskId>
    animate(taskId, opts): Promise<taskId>
    poll(taskId): Promise<TaskState>
  }
  ```
- **Provider 实现**：
  - `LocalReconstructionProvider`（商用 API，质量高，起步用）——对应 `/generation/image-to-model`、`multiview-to-model`、`mesh/*`、`animations/*`
  - `LocalReconstructionProvider`（自研引擎，零外部依赖）——**语义感知贴图网格** 做快速路径；**程序化增强** 做高质量路径；后处理用 **Blender(bpy) + glTF-Transform** 自研
  - `MockProvider`（无 GPU 时占位，供前端/流程联调）
- **产出规格**：网格（GLB/glTF）+ 材质贴图 + 语义部件（部件分割）+ 可选绑定/动画 + 缩略图 + 来源链。
- **质量分层**：低面数（游戏/移动，P 系列思路）↔ 高保真（影视特写，H 系列思路）。

### 6.3 资产库
- **语义索引**：标签 + **embedding**（CLIP/3D 语义向量）双路检索；`semantic.search`。
- **来源链（provenance）**：记录 资产 ← 图 ← Spec ← 愿景；便于回溯、变体、版权合规。
- **复用策略**：命中→直接复用；相似→变体；缺失→生成；小→组合（层级资产）。
- **版本与冻结**：资产可版本化；进世界的"冻结"副本防漂移。

### 6.4 世界画布
- **前端**：Three.js + React Three Fiber，**可交互 3D 画布**；资产用 GLB 加载。
- **场景图**：`SceneGraph = { environment, entities[], lights, cameras, zones[] }`，纯 JSON，可持久化、可 diff、可回放。
- **AI 摆放**：`canvas.layout` 依 Semantic Spec 与规则（分区、路径、避让、语义邻接、密度/性能预算）生成 `placementPlan`；AI 逐实体调用 `canvas.place`。
- **环境与光照**：天气/时段/天空/雾/全局光/反射；一次设定，全局一致。
- **校验**：`canvas.validate` 检查遮挡、穿插、比例、面数预算、语义一致性。
- **人机**：AI 摆放后人可拖拽微调（人做"手感"）；AI 可依据人改动反推偏好并写入 Spec。

### 6.5 导出与成片
- **游戏**：`export.game` → glTF/GLB 资产 + `scene.json` + 轻量运行时（Three.js 可玩预览）；预留 Unity/Unreal/Godot 导入说明。
- **影视**：`export.film` → 镜头序列（相机路径/关键帧/时间线/镜头表）→ 渲染（**Blender EEVEE/Cycles** 高质，或 **Three.js** 快渲）→ 剪辑 + 配乐/音效/字幕（借鉴 Fable 5.2 的"纯代码生片"思路，也可接 ElevenLabs 等）。

---

## 7. 语义规范（Semantic Spec）

### 7.1 设计目标
结构化、可校验、可复现、可被 AI 用于生图/生 3D/摆放/批评，且**人可审阅与锁定字段**。

### 7.2 JSON Schema（示例结构）
```json
{
  "meta": { "id": "world_001", "name": "雨夜赛博港", "style": "cyberpunk-noir", "seed": 42 },
  "world": {
    "atmosphere": { "time": "night", "weather": "rain", "fog": 0.6, "colorScheme": ["#0b1020", "#ff2a6d", "#05d9e8"] },
    "terrain": { "type": "coastal", "ground": "wet-asphalt" }
  },
  "entities": [
    {
      "id": "crane_01",
      "category": "crane",
      "count": 2,
      "attributes": { "height": "large", "color": "rust", "material": "metal", "emissive": "cyan" },
      "relations": { "sitsOn": "dock", "near": "containers" },
      "parts": [ { "id": "arm", "semantic": "mechanical-arm", "count": 1 } ]
    },
    { "id": "container_stack", "category": "container-stack", "count": 12,
      "attributes": { "color": ["red","blue","rust"] },
      "relations": { "on": "dock", "cluster": true } },
    { "id": "robot_guard", "category": "robot", "count": 1,
      "attributes": { "pose": "idle" }, "riggable": true }
  ],
  "composition": { "layout": "grid-with-lanes", "depth": "multi-layer",
    "hero": "crane_01", "focal": "robot_guard" }
}
```

### 7.3 语义到各层的作用
- **生图**：`category/attributes/relations/composition` → 提示词合成 + 布局/语义条件。
- **生 3D**：`category/parts/riggable` → 图生 3D + 部件拆分 + 绑定开关。
- **摆放**：`relations/composition/world` → 布局规则与邻接约束。
- **批评**：`style/colorScheme/atmosphere` → 风格一致性评分依据。

### 7.4 语义补全与锁定
- `semantic.complete`：AI 补全缺失字段（默认值/常识/风格推断），并给出置信度。
- **人可锁定字段**：如 `entities[robot_guard].attributes.pose = "idle"` 锁定后 AI 不再改，保证叙事一致性。

---

### 7.5 物理量纲：SI 单位系统（系统基础）

> 世界生成需要**一致的物理量纲**。SemanticSpec 中实体物理属性（尺寸、质量、力、功率、照度、温度等）一律以 **SI 单位**表达，作为所有生成/摆放/校验的公共基础。

- **7 个基本单位**：米 m、千克 kg、秒 s、安培 A、开尔文 K、摩尔 mol、坎德拉 cd（各含物理定义，如 kg 基于普朗克常数、s 基于铯-133 跃迁）。
- **22 个具名导出单位**：rad、sr、Hz、N、Pa、J、W、C、V、F、Ω、S、Wb、T、H、℃、lm、lx、Bq、Gy、Sv、kat（按空间/力学/电磁/热学/光学/辐射化学分域）。
- **组合导出单位**：m/s、m/s²、kg/m³、J/K、J/mol、mol/m³、cd/m² 等（量纲向量 [m,kg,s,A,K,mol,cd]）。
- **注册表**：`apps/api/src/units.mjs`（零依赖）→ `GET /api/system/units` + AI 工具 `system.units`。
- **量纲校验**：`semantic.validate` 用 `parseDimension` 解析实体 `physics` 属性单位（如 `kg·m/s²`、`J/K`、`Ω`，支持 Unicode 上标），确保量纲合法并与期望物理量一致。
- **画布约束**：`canvas.place`/`createScene` 读取实体 `physics.dimensions`（SI），按资产自然包围盒（GLB POSITION min/max）等比/逐轴缩放，使实体世界尺寸符合指定量纲。


## 8. 技术栈选型

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | Next.js + React + TypeScript + **React Three Fiber / Three.js** | 世界画布、资产预览、GLB 原生加载 |
| 前端状态 | Zustand + TanStack Query | 场景图/任务状态管理 |
| 动画/交互 | Framer Motion / GSAP | 画布交互、UI 反馈 |
| 后端 API | **Node (NestJS/或 Fastify)** | 与前端同栈、异步任务编排、OpenAPI |
| AI 编排 | LLM（Claude/GPT 等）+ **Function Calling / MCP** | 编排智能体调用 AI 接口 |
| 图像生成 | Seedream / Flux / SD（OpenAI 兼容） | 语义驱动生图；抽象 `ImageProvider` |
| 图生 3D | **自研重建引擎**（零外部依赖，降本） | 核心能力；抽象 `ImageTo3DProvider` |
| 3D 后处理 | **Blender (bpy) headless + glTF-Transform** | 分割/减面/UV/绑定/转换 |
| 任务队列 | **BullMQ + Redis**（或 Temporal） | 自研异步任务模型 |
| 存储 | PostgreSQL（元数据/场景图）+ **S3 兼容对象存储**（资产/图/模型/渲染） | 资产与场景持久化 |
| 渲染成片 | Blender EEVEE/Cycles（影视）+ Three.js（快渲） | 影视产出 |
| 音频 | ElevenLabs / 本地合成 | 配乐/旁白 |
| 运行环境 | Docker + GPU Worker（本地或云端） | 推理/渲染弹性 |

> 建议**全 TS 为主**，GPU 密集（3D 后处理/渲染）用 Python Worker；两者经任务队列解耦。

---

## 9. 数据模型与存储

```
Asset {
  id, name, category,
  model_url, glb_path, thumbnail,
  mesh_stats {faces, verts, parts}, materials[], animations[],
  semantic_tags[], embedding,        // 语义索引
  provenance { worldBrief, spec_id, image_ids[], provider, task_ids[] },
  parent_asset_id?, version, frozen
}
WorldScene {
  id, name, brief, spec_id, style, seed,
  scene_graph { environment, entities[], lights[], cameras[], zones[] },
  thumbnail, status, owner
}
Entity { id, asset_id, transform {pos,rot,scale}, semantic_role, placed_by "ai|human", locked }
Task { id, type, status(queued/running/success/failed), progress,
       params, result, actor("ai"|"human"), approval {gate, state}, cost }
ShotSequence { id, scene_id, shots[{camera_path, keyframes, duration}], render_config }
HumanGate { id, step, type, payload, options[], decision, reason, actor }
AgentLog { id, run_id, agent, action, tool, args, result, ts }   // 全流程可审计/可回放
```

---

## 10. 应用场景

### 10.1 游戏
- **快速原型**：愿景→可玩场景（AI 自主），供玩法验证。
- **批量资产**：NPC、道具、载具、建筑；语义部件可绑定、可换装。
- **关卡生成**：世界画布 = 关卡布局；导出 glTF + 场景 JSON 给 Unity/Unreal/Godot/Three.js。
- **Vibe Coding 协同**：AI 生成资产 + 程序员/策划写玩法逻辑，人管"好玩"，AI 管"好看/量"。

### 10.2 影视
- **概念/环境**：场景与资产作为影视背景/道具。
- **镜头与运镜**：AI 排镜头、关键帧、相机路径（世界模型思路与 Fable 5.2 的"写代码生片"）。
- **成片**：渲染（Blender）+ 配乐/音效/旁白 + 字幕，产出短片。

---

## 11. 迭代路线图

### 阶段 0：概念验证（2–4 周）
- 打通**单资产最小闭环**：语义→图（文生图）→ 3D（自研重建引擎）→ GLB 预览。
- 验证"语义驱动"可行性；搭 `ImageTo3DProvider` 抽象与 `MockProvider`。
- **交付**：`semantic→image→3D→viewer` 可跑的 Demo + 规格文档。

### 阶段 1：MVP（4–8 周）
- 异步任务队列 + 资产库（语义索引）+ 简单世界画布（Three.js 手动摆放）。
- 编排智能体 v1：单 Agent 顺序调 AI 接口 + 关键门禁。
- 后处理链：减面/转换/部件拆分（Blender）。
- **交付**：一条"愿景→≥3 资产→摆放→导出 GLB+场景 JSON"的 AI 主导流水线 + 门禁。

### 阶段 2：V1（8–16 周）
- 多视图生 3D + 风格统一 + 一致性检查；审美 Agent（批评家）进入循环。
- 世界画布 AI 布局（`canvas.layout`）+ 环境/光照 + 校验。
- 资产复用/变体/组合；语义 embedding 检索；来源链与合规。
- **交付**：`愿景→完整场景→可玩预览` 端到端；AI 自主率 ≥ 80%。

### 阶段 3：V2（16 周+）
- 多 Agent 协同（策划/审美/生成/摆放/导演）；门禁工作流成熟。
- **影视**：镜头序列 + Blender 渲染 + 配乐/字幕成片。
- **游戏**：多引擎导出、运行时包、基础可玩交互。
- 世界持久化与多人协作（人-AI 共编）；零外部依赖降本。
- **交付**：双产出（游戏场景 + 影视短片）稳定可用。

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 图生 3D 质量/接缝/背面贴图 | 资产不可用 | 多视图输入 + 部件拆分 + 后处理（UV/补全）；质量分层；先用商用 API 保底 |
| 多视角不一致/漂移 | 风格割裂 | `image.consistency` + 风格锁定（styleRef/seed）+ 校验门禁 |
| 成本/延迟（3D 生成贵） | 迭代慢、烧钱 | 异步队列 + 预算上限 + 复用/变体 + 自研降本 |
| AI 循环发散（反复不过审） | 卡死 | 最大重试次数 + 人门禁兜底 + 批评标准可调 |
| 语义落地偏差（spec→图失配） | 产出不对 | 结构化条件注入 + 局部编辑 + 人锁定关键字段 |
| 生成物版权/合规 | 法务风险 | 来源链 + 人确认内容/授权 + 记录 provider 许可 |
| 人机协作摩擦 | 流程卡顿 | 明确的门禁点与选项；"AI 默认值 + 人否决"；偏好回写 Spec |
| GPU 基建 | 成本/运维 | 混合云/按需 + MockProvider 联调 + 缓存资产 |

---

## 13. 附录：AI 接口 MCP 化建议

- 每个域封装为一个 **MCP Server**（或 LLM Function 工具组）：`semantic`、`image`、`img3d`、`asset`、`canvas`、`critic`、`export`、`system`。
- 编排智能体通过 **MCP 客户端** 连接各 Server，获得**统一工具发现/调用/权限/审计**。
- 门禁以 `tool_requires_approval` 元数据暴露，编排层据此暂停并上报人。
- 好处：模型无关（Claude/GPT/Qwen 皆可驱动）、能力可独立部署、便于后续加"摆放 Agent""导演 Agent"。

---

## 附：核心能力定位

本项目核心图生 3D 能力为**自研引擎**（零外部依赖），不依赖任何第三方开源/商用组件；全部 AI 接口由 AI 编排智能体自主调用。

---

*本文档为项目规划 v0.1，供立项与架构评审；具体实现以阶段 0 概念验证为准。*
