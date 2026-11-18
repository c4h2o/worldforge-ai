/**
 * 审美批评器（Critic Agent）—— 对资产/场景评分，给出问题与建议。
 * 供编排层做"生成→检查→修改→再生成"循环。
 */
import type { Asset, WorldScene } from '@worldforge/core';

export interface Critique { score: number; issues: string[]; suggestions: string[]; ok: boolean }

const MAX_RETRIES = 3;

export class Critic {
  constructor(private thresholds = { pass: 70 }) {}

  review(target: Asset | WorldScene): Critique {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 90;
    // 资产检查
    if ('mesh_stats' in target && target.mesh_stats) {
      if (target.mesh_stats.faces > 200_000) { score -= 15; issues.push(`face count ${target.mesh_stats.faces} exceeds budget`); suggestions.push('decimate mesh'); }
      if (target.mesh_stats.parts < 1) { score -= 5; issues.push('no semantic parts'); suggestions.push('run segment'); }
    }
    if ('scene_graph' in target && target.scene_graph) {
      const ents = target.scene_graph.entities;
      if (ents.length === 0) { score -= 30; issues.push('empty scene'); suggestions.push('place assets'); }
      if (ents.length > 300) { score -= 10; issues.push('too many entities (perf)'); suggestions.push('merge/simplify'); }
    }
    return { score, issues, suggestions, ok: score >= this.thresholds.pass };
  }

  /** 判断是否应继续迭代（防发散） */
  shouldRetry(round: number): boolean { return round < MAX_RETRIES; }
}
