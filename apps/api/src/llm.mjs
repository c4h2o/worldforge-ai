// WorldForge AI — LLM 客户端（OpenAI 兼容 chat/completions + Function Calling），零依赖 fetch。
// LLMClient：真实 LLM；MockLLM：离线脚本（CI/无 key 联调）。

export class LLMClient {
  constructor({ baseUrl, apiKey, model }) {
    if (!apiKey) throw new Error('LLM 需要 apiKey（LLM_API_KEY 或请求体 apiKey）');
    this.base = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.apiKey = apiKey; this.model = model || 'gpt-4o-mini';
  }
  async chat(messages, tools) {
    const body = { model: this.model, messages, tools, tool_choice: 'auto' };
    const r = await fetch(this.base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.apiKey }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('LLM ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return r.json();
  }
}

// 离线 Mock：按脚本顺序返回 tool_calls，脚本用尽返回 done。
export class MockLLM {
  constructor(plan) { this.plan = plan || defaultPlan(); this.i = 0; }
  async chat(messages, tools) {
    if (this.i < this.plan.length) {
      const step = this.plan[this.i++];
      return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + this.i, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
    }
    return { choices: [{ message: { role: 'assistant', content: '完成：世界已生成并导出。', tool_calls: [] } }] };
  }
}

export function defaultPlan(brief) {
  const b = brief || '一座雨夜赛博朋克港口';
  return [
    { name: 'semantic.parse', args: { brief: b } },
    { name: 'img3d.fromImage', args: { category: 'crane', input: 'semantic:crane' } },
    { name: 'img3d.fromImage', args: { category: 'container', input: 'semantic:container' } },
    { name: 'canvas.layout', args: { brief: b } },
    { name: 'critic.review', args: {} },
    { name: 'export.game', args: {} },
  ];
}

export function createLLM({ provider, baseUrl, apiKey, model, brief, plan }) {
  if (provider === 'llm') return new LLMClient({ baseUrl, apiKey, model });
  return new MockLLM(plan || defaultPlan(brief));
}
