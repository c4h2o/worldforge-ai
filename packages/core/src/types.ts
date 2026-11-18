/**
 * WorldForge AI — 核心数据模型
 * 语义规范 / 资产 / 场景图 / 任务 / AI 工具定义
 */

/** 单个实体（场景中的一类对象）的语义描述 */
export interface SemanticEntity {
  id: string;
  category: string;            // 如 'crane' | 'container' | 'robot'
  count?: number;              // 数量
  attributes?: Record<string, unknown>;  // 颜色/材质/发光/姿态等
  relations?: Record<string, string | boolean>; // sitsOn/near/cluster 等
  parts?: { id: string; semantic: string; count?: number }[]; // 部件语义
  riggable?: boolean;
}

/** 语义规范：把"世界愿景"结构化的 JSON，驱动生图/生3D/摆放/批评 */
export interface SemanticSpec {
  meta: { id: string; name: string; style: string; seed: number };
  world: {
    atmosphere: { time: string; weather: string; fog?: number; colorScheme?: string[] };
    terrain: { type: string; ground?: string };
  };
  entities: SemanticEntity[];
  composition: { layout: string; depth?: string; hero?: string; focal?: string };
}

/** 资产统计 */
export interface MeshStats { faces: number; verts: number; parts: number; }

/** 3D 资产（可复用对象） */
export interface Asset {
  id: string;
  name: string;
  category: string;
  model_url?: string;          // GLB/glTF 地址
  local_path?: string;
  thumbnail?: string;
  mesh_stats?: MeshStats;
  materials?: string[];
  animations?: string[];
  semantic_tags: string[];
  provenance: {
    brief?: string;
    spec_id?: string;
    image_ids: string[];
    provider: string;          // mock | local（自研重建引擎）
    task_ids: string[];
  };
  parent_asset_id?: string;
  version: number;
  frozen: boolean;
}

/** 场景中的实体实例（摆放后） */
export interface SceneEntity {
  id: string;
  asset_id: string;
  transform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
  semantic_role: string;
  placed_by: 'ai' | 'human';
  locked: boolean;
}

/** 世界场景（世界画布的持久化形态） */
export interface WorldScene {
  id: string;
  name: string;
  brief: string;
  spec_id: string;
  style: string;
  seed: number;
  scene_graph: {
    environment: { time: string; weather: string; sky: string; fog: number };
    lights: { type: string; color: string; intensity: number; position: [number, number, number] }[];
    cameras: { id: string; position: [number, number, number]; target: [number, number, number] }[];
    zones: { id: string; name: string; bounds: [number, number, number, number, number, number] }[];
    entities: SceneEntity[];
  };
  status: 'draft' | 'approved' | 'frozen';
}

/** 异步任务（自研：提交返回 task_id） */
export interface Task {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  progress: number;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  actor: 'ai' | 'human';
  cost?: number;
}

/** 人机门禁 */
export interface HumanGate {
  id: string;
  step: string;
  type: 'style' | 'content' | 'compliance' | 'narrative';
  payload: Record<string, unknown>;
  options: string[];
  decision?: string;
  reason?: string;
  actor: 'ai' | 'human';
}

/** AI 工具调用结果（可含 needs_approval 触发门禁） */
export interface ToolResult<T = unknown> {
  ok: boolean;
  task_id?: string;
  needs_approval?: HumanGate;
  data?: T;
  error?: string;
}

/** 工具定义（MCP / Function Calling 化） */
export interface ToolDef {
  name: string;
  domain: 'semantic' | 'image' | 'img3d' | 'asset' | 'canvas' | 'critic' | 'export' | 'system';
  description: string;
  parameters: Record<string, unknown>;
}
