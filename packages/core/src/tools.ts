/**
 * WorldForge AI — AI 接口（工具）定义
 * 每个能力封装为 AI 可调用工具；耗时操作返回 task_id，异步轮询/Webhook。
 */
import type { ToolDef, ToolResult, SemanticSpec, Asset, WorldScene } from './types.ts';

export interface AiToolRegistry {
  // A. 语义域
  'semantic.parse': (brief: string) => Promise<ToolResult<SemanticSpec>>;
  'semantic.complete': (spec: SemanticSpec, constraints?: Record<string, unknown>) => Promise<ToolResult<SemanticSpec>>;
  'semantic.validate': (spec: SemanticSpec) => Promise<ToolResult<{ ok: boolean; issues: string[] }>>;

  // B. 图像生成域（语义驱动）
  'image.generateFromSpec': (params: { spec: SemanticSpec; views?: string[]; styleRef?: string }) => Promise<ToolResult>;
  'image.generateView': (params: { spec: SemanticSpec; view: string }) => Promise<ToolResult>;
  'image.generatePart': (params: { spec: SemanticSpec; partId: string }) => Promise<ToolResult>;

  // C. 图生 3D 域
  'img3d.fromImage': (params: { input: string; model?: string; faceLimit?: number; texture?: boolean }) => Promise<ToolResult>;
  'img3d.fromMultiView': (params: { views: string[]; model?: string }) => Promise<ToolResult>;
  'img3d.postprocess': (params: { taskId: string; op: 'segment'|'decimate'|'uv'|'texture'|'convert'|'complete'; opts?: Record<string, unknown> }) => Promise<ToolResult>;

  // D. 资产库域
  'asset.ingest': (params: { asset3d: Record<string, unknown>; semanticTags: string[]; provenance: Asset['provenance'] }) => Promise<ToolResult<Asset>>;
  'asset.search': (query: string) => Promise<ToolResult<Asset[]>>;

  // E. 世界画布域
  'canvas.layout': (params: { spec: SemanticSpec; rules?: Record<string, unknown> }) => Promise<ToolResult>;
  'canvas.place': (params: { assetId: string; zone?: string; constraints?: Record<string, unknown> }) => Promise<ToolResult>;

  // F. 批评域（审美 Agent）
  'critic.review': (params: { target: Asset | WorldScene; criteria?: Record<string, unknown> }) => Promise<ToolResult<{ score: number; issues: string[]; suggestions: string[] }>>;

  // G. 导出域
  'export.game': (params: { sceneId: string; engine?: string }) => Promise<ToolResult>;
  'export.film': (params: { sceneId: string; shotList?: unknown; engine?: string }) => Promise<ToolResult>;
}

/** 供 LLM Function Calling / MCP 使用的工具 schema 列表 */
export const AI_TOOLS: ToolDef[] = [
  { name: 'semantic.parse', domain: 'semantic', description: '把世界愿景解析为结构化语义规范 SemanticSpec', parameters: { brief: { type: 'string' } } },
  { name: 'image.generateFromSpec', domain: 'image', description: '按语义规范生成概念图（语义驱动）', parameters: { spec: { type: 'object' }, views: { type: 'array' } } },
  { name: 'img3d.fromImage', domain: 'img3d', description: '单图生成 3D 资产（单图→3D 资产）', parameters: { input: { type: 'string' } } },
  { name: 'img3d.fromMultiView', domain: 'img3d', description: '多视图生成 3D 资产（多视图→3D 资产）', parameters: { views: { type: 'array' } } },
  { name: 'asset.ingest', domain: 'asset', description: '把 3D 资产入库并打语义标签', parameters: { asset3d: { type: 'object' } } },
  { name: 'canvas.layout', domain: 'canvas', description: '按语义规范做世界布局规划', parameters: { spec: { type: 'object' } } },
  { name: 'critic.review', domain: 'critic', description: '审美/一致性检查并给出修改建议', parameters: { target: { type: 'object' } } },
  { name: 'export.game', domain: 'export', description: '导出可玩场景（glTF+场景JSON）', parameters: { sceneId: { type: 'string' } } },
  { name: 'export.film', domain: 'export', description: '导出影视镜头序列并渲染', parameters: { sceneId: { type: 'string' } } },
];
