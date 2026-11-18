// WorldForge AI — AI 编排智能体：LLM(Function Calling) 自主调用 AI 接口 + 人机门禁。
// 循环：LLM 决定调用哪个工具 → 分发到服务端管线 → 回填结果 → 再交给 LLM，直到 LLM 无 tool_calls（完成）。

export const TOOL_DEFS = [
  { type: 'function', function: { name: 'semantic.parse', description: '把世界愿景解析为结构化语义规范 SemanticSpec。', parameters: { type: 'object', properties: { brief: { type: 'string', description: '世界愿景一句话' } }, required: ['brief'] } } },
  { type: 'function', function: { name: 'semantic.validate', description: '校验语义规范的物理属性量纲是否合法（SI 单位）。', parameters: { type: 'object', properties: { spec: { type: 'object', description: '要校验的 SemanticSpec' } } } } },
  { type: 'function', function: { name: 'image.generateFromSpec', description: '按语义规范生成概念图（语义驱动）。', parameters: { type: 'object', properties: { spec: { type: 'object' }, style: { type: 'string' } } } } },
  { type: 'function', function: { name: 'img3d.fromImage', description: '由图片/语义类别生成 3D 资产（自研 image-to-model）。', parameters: { type: 'object', properties: { input: { type: 'string' }, category: { type: 'string' } }, required: ['input'] } } },
  { type: 'function', function: { name: 'asset.ingest', description: '把 3D 资产入库并打语义标签。', parameters: { type: 'object', properties: { asset_id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } },
  { type: 'function', function: { name: 'canvas.layout', description: '按语义规范做世界布局摆放。', parameters: { type: 'object', properties: { brief: { type: 'string' } }, required: ['brief'] } } },
  { type: 'function', function: { name: 'critic.review', description: '审美/一致性检查，给出评分与问题。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'export.game', description: '导出可玩场景（glTF+场景JSON）。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'system.units', description: '查询 SI 单位系统（7 基本单位、22 具名导出单位、常用组合单位及其定义与量纲）。', parameters: { type: 'object', properties: { q: { type: 'string', description: '可选：按符号/名称/量纲过滤，如 N、kg·m/s²、力' } } } } },
  { type: 'function', function: { name: 'export.film', description: '生成镜头序列并导出成片（浏览器渲染）。', parameters: { type: 'object', properties: {} } } },
];

export function systemPrompt(brief) {
  return `你是 WorldForge AI 的编排智能体。任务是：把用户的世界愿景，通过一系列 AI 接口（工具）自主加工成虚拟世界。
愿景：${brief}
可用工具（按推荐顺序）：semantic.parse → image.generateFromSpec → img3d.fromImage（每个实体）→ asset.ingest → canvas.layout → critic.review → export.game。
规则：
1. 先 semantic.parse 得到语义规范。
2. 再为每个关键实体调用 img3d.fromImage 生成资产。
3. 调用 canvas.layout 把资产摆进世界画布。
4. 调用 critic.review 检查，若不达标可重跑 img3d.fromImage 调整。
5. 最后调用 export.game 导出。
6. 若需要用户确认（如风格、内容、合规），在返回结果中置 needs_approval=true；用户确认后继续。
7. 完成时返回普通文本（无 tool_calls）。
`;
}

export async function runAgent({ brief, llm, dispatch, maxSteps = 16 }) {
  const messages = [{ role: 'system', content: systemPrompt(brief) }, { role: 'user', content: brief }];
  const log = [];
  for (let step = 0; step < maxSteps; step++) {
    const res = await llm.chat(messages, TOOL_DEFS);
    const msg = res.choices && res.choices[0] && res.choices[0].message;
    if (!msg) throw new Error('LLM 无响应');
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls || [] });
    if (!msg.tool_calls || msg.tool_calls.length === 0) { log.push('✅ LLM 完成: ' + (msg.content || 'done')); break; }
    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      let payload, gate = null;
      try {
        const handler = (typeof dispatch === 'function') ? dispatch : dispatch[name];
        if (!handler) throw new Error('未知工具: ' + name);
        const r = await handler(args, { brief });
        payload = r && r.result !== undefined ? r.result : r; gate = (r && r.gate) || null;
        log.push(`[step ${step}] ${name}(${JSON.stringify(args).slice(0, 60)}) → ${JSON.stringify(payload).slice(0, 100)}`);
      } catch (e) {
        payload = { error: String(e && e.message || e) };
        log.push(`[step ${step}] ${name} 失败: ${payload.error}`);
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(gate ? { ...payload, needs_approval: true } : payload) });
    }
  }
  return { log, messages, scene_id: null };
}
