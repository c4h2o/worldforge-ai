# 🌐 WorldForge AI — Semantic World Builder

![CI](https://github.com/c4h2o/worldforge-ai/actions/workflows/ci.yml/badge.svg)
![status](https://img.shields.io/badge/status-Phase%200%20Demo-brightgreen)
![node](https://img.shields.io/badge/node-%E2%89%A518-3c873a)
![license](https://img.shields.io/badge/license-NonCommercial%20%2B%20Commercial%20paid-blue)

> **AI 自主驱动的虚拟世界素材生产与搭建平台**（Phase 0 概念验证 Demo）
> 核心能力：**自研图生 3D 引擎**。核心链路：**语义驱动生图 → 图生 3D → 资产库 → 世界画布 → 游戏/影视产出**。
> 全流程由 **AI 编排智能体** 通过 **AI 接口** 自主操作，人只做 AI 做不了的事（审美定调、门禁确认、手工修整、合规）。

**一句话**：给一个"世界愿景"（如 `雨夜赛博朋克港`），WorldForge 把它语义化 → 生图 → 生 3D → 资产库 → 摆进世界画布 → 导出可探索场景 / 影视镜头。

---

## ✨ 特性

- **语义驱动（Semantic Spec）**：把愿景解析成结构化 JSON（实体/类别/属性/关系/风格/构图），作为生图与生 3D 的条件，可复现、可局部控制、人可锁定字段。
- **AI 接口体系（核心）**：每个能力封装成 AI 可调用的工具（`semantic / image / img3d / asset / canvas / critic / export / system` 八大域），编排智能体以"生成→检查→修改→再生成"循环自主操作，关键节点走**人机门禁**。
- **图生 3D Provider 抽象**：`ImageTo3DProvider` 接口，可换源——`MockProvider`（无 GPU 联调）、`LocalReconstructionProvider`（商用 API）、`LocalReconstructionProvider`（开源 开源单图 3D 重建模型 + Blender）。
- **异步任务模型**：自研，提交即返回 `task_id`，轮询/Webhook 拿结果。
- **零依赖可跑 Demo**：`npm run demo` 用纯 Node 内置模块跑通"愿景 → 语义 → 概念图 → 程序化 GLB 资产 → 资产库 → 世界画布 → 场景 JSON + 预览"。

## 🧱 核心链路

```
[人] 世界愿景 "雨夜赛博朋克港"
  → ① AI 语义解析 → Semantic Spec (JSON)
  → ② AI 生图(语义驱动) → 概念图组(前/侧/背/部件)
  → ③ AI 图生3D + 后加工 → 资产(网格+贴图+部件+可选绑定)
  → ④ AI 入库 → 资产库(语义索引/来源链)
  → ⑤ AI 布局摆放 → 世界画布(实体+环境+光照+相机)
  → ⑥ AI 检查批评 → 不通过回改 / 通过→[人门禁]
  → ⑦ AI 导出 → 游戏(glTF+场景JSON) / 影视(镜头序列+渲染)
```

## 📁 仓库结构

```
worldforge-ai/
├─ README.md · LICENSE · .gitignore · .env.example · docker-compose.yml
├─ package.json (workspaces) · tsconfig.base.json
├─ docs/
│  ├─ PROJECT_PLAN.md      # 完整项目规划（愿景/架构/迭代/风险）
│  └─ ARCHITECTURE.md      # 分层架构与 AI 接口说明
├─ packages/
│  ├─ core/                # Semantic Spec、Asset、SceneGraph、Task、AI 工具定义（TS）
│  ├─ providers/           # ImageTo3DProvider / ImageProvider + Mock / Local(自研重建引擎)
│  └─ orchestrator/        # AI 编排智能体 + 审美批评器 + 门禁
└─ apps/
   └─ demo/                # Phase 0 可运行 Demo（纯 Node，零依赖）
      └─ src/run-demo.mjs  # 端到端：语义→图→3D→资产→画布→导出
```

## 🚀 快速开始

```bash
# 零依赖：直接跑 Phase 0 Demo（Node >= 18）
npm run demo
# 或
node apps/demo/src/run-demo.mjs "一座雨夜赛博朋克港"

# 输出到 ./output/ ：概念图、程序化 GLB 资产、assets.json、scene.json、world-preview.html
```

**MVP 服务端**（异步任务 API + 世界画布，零依赖）：
```bash
npm run dev        # 打开 http://localhost:4321（世界画布）
# API: POST /api/generation/image-to-model → {task_id}; GET /api/tasks/:id
```

详见 [docs/MVP.md](docs/MVP.md)。

**安装与真实集成**（可选，接入真实图像/3D 生成）：
```bash
npm install                     # 安装 workspaces（core/providers/orchestrator）
cp .env.example .env            # 填入 SENSENOVA_API_KEY / LOCAL_RECON_* 等
docker compose up -d            # 启动 postgres + redis + minio
npm run dev                     # 后续：API + Web 画布（规划中）
```

## 🗺️ 路线图

- **Phase 0（本次）**：单资产最小闭环，语义→图→3D→GLB 预览，`ImageTo3DProvider` 抽象 + Mock。
- **Phase 1（MVP）**：异步任务队列 + 资产库(语义索引) + 世界画布(Three.js) + 单 Agent + 人机门禁。
- **Phase 2（V1）**：多视图生3D + 风格统一 + 审美批评进入循环 + AI 布局摆放，AI 自主率 ≥ 80%。
- **Phase 3（V2）**：多 Agent 协同 + 影视镜头序列/渲染成片 + 多引擎导出 + 世界持久化。

详见 [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md)。

## 📚 参考资料

- 自研图生 3D 引擎（核心能力）：单图/多视图 → 网格 + 贴图 + 后处理 → 可进引擎资产
- 开源 3D 重建模型（MIT）：自托管作为自研引擎的快速路径
- 规划文档初稿：`docs/PROJECT_PLAN.md`

## 📄 License（双轨制）

- **我们自己的代码**：**WorldForge AI Non-Commercial License v1.0** — [LICENSE](LICENSE)。
  - **非商业**（个人/教育/研究/内部测试）**免费**；**商业用途需付费购买商业许可**。
  - 保留第三方 MIT 许可（开源单图 3D 重建模型 + SDK），见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
  - 不侵权、不允许他人侵权、商用付费——详见 [docs/LICENSING.md](docs/LICENSING.md)。
