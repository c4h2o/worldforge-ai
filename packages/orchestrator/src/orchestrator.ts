/**
 * AI 编排智能体（Orchestrator）—— 读愿景→规划→调 AI 接口→检查→修改→再生成→门禁。
 * 人只在 needs_approval 时确认/否决；AI 做其余一切。
 */
import type { SemanticSpec, Asset, WorldScene, HumanGate } from '@worldforge/core';
import { Critic } from './critic.ts';

export interface OrchestratorDeps {
  tools: {
    'semantic.parse': (brief: string) => Promise<{ ok: boolean; data?: SemanticSpec; error?: string }>;
    'image.generateFromSpec': (p: { spec: SemanticSpec }) => Promise<{ ok: boolean; task_id?: string; error?: string }>;
    'img3d.fromImage': (p: { input: string }) => Promise<{ ok: boolean; task_id?: string; error?: string }>;
    'asset.ingest': (p: { asset3d: Record<string, unknown>; semanticTags: string[] }) => Promise<{ ok: boolean; data?: Asset; error?: string }>;
    'canvas.layout': (p: { spec: SemanticSpec }) => Promise<{ ok: boolean; error?: string }>;
    'critic.review': (p: { target: Asset | WorldScene }) => Promise<{ ok: boolean; data?: { score: number; issues: string[]; suggestions: string[] } }>;
  };
  onGate?: (gate: HumanGate) => Promise<{ approved: boolean; note?: string }>;
}

export class Orchestrator {
  constructor(private deps: OrchestratorDeps, private critic = new Critic()) {}

  async run(brief: string): Promise<{ spec: SemanticSpec; asset?: Asset; gates: HumanGate[]; log: string[] }> {
    const log: string[] = [];
    const gates: HumanGate[] = [];
    const t = this.deps.tools;

    // 1. 语义解析
    const parsed = await t['semantic.parse'](brief);
    if (!parsed.ok || !parsed.data) throw new Error('semantic.parse failed: ' + parsed.error);
    const spec = parsed.data;
    log.push(`semantic.parse → ${spec.entities.length} entities, style=${spec.meta.style}`);

    // 2. 门禁：风格确认（人做审美定调）
    const styleGate: HumanGate = { id: 'gate-style', step: 'semantic', type: 'style', payload: spec, options: ['approve', 'revise-style'] };
    gates.push(styleGate);
    if (this.deps.onGate) {
      const d = await this.deps.onGate(styleGate);
      if (!d.approved) { log.push('style gate rejected by human: ' + d.note); }
    }

    // 3. 生成循环（生成→检查→修改→再生成）
    let asset: Asset | undefined;
    let round = 0;
    while (this.critic.shouldRetry(round)) {
      round++;
      const img = await t['image.generateFromSpec']({ spec });
      if (!img.ok) throw new Error('image.generateFromSpec failed');
      log.push(`image.generateFromSpec → ${img.task_id}`);

      const m = await t['img3d.fromImage']({ input: img.task_id ?? 'mock' });
      if (!m.ok) throw new Error('img3d.fromImage failed');
      log.push(`img3d.fromImage → ${m.task_id}`);

      const ing = await t['asset.ingest']({ asset3d: { task: m.task_id }, semanticTags: spec.entities.map(e => e.category) });
      if (!ing.ok || !ing.data) throw new Error('asset.ingest failed');
      asset = ing.data;

      const cr = await t['critic.review']({ target: asset });
      const critique = cr.ok && cr.data ? cr.data : { score: 0, issues: [], suggestions: [] };
      log.push(`critic.review round ${round}: score=${critique.score}`);

      if (critique.score >= 70) { log.push('critique passed'); break; }
      log.push(`critique failed: ${critique.issues.join('; ')} → suggestions: ${critique.suggestions.join('; ')}`);
    }

    // 4. 布局摆放
    const lay = await t['canvas.layout']({ spec });
    if (lay.ok) log.push('canvas.layout ok');

    return { spec, asset, gates, log };
  }
}
