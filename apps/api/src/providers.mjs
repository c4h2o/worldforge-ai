// WorldForge AI — 图生 3D Provider（零依赖 JS，服务端直用；与 packages/providers 的 TS 接口对应）
// kind: mock（程序化）| tripo（Tripo 商用 API）| triposr（自托管 TripoSR/SG/SF）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class MockProvider {
  name = 'mock';
  async fromImage(input, opts = {}) { return { task_id: 'mock_' + Math.random().toString(36).slice(2, 9) }; }
  async fromMultiView(inputs, opts = {}) { return { task_id: 'mock_' + Math.random().toString(36).slice(2, 9) }; }
  async poll(taskId) { return { task_id: taskId, status: 'success', progress: 100, output: {} }; }
}

export class TripoProvider {
  name = 'tripo';
  constructor(env = {}) {
    this.apiKey = env.TRIPO_API_KEY;
    this.base = env.TRIPO_BASE_URL || 'https://openapi.tripo3d.ai/v3';
    if (!this.apiKey) throw new Error('IMG3D_PROVIDER=tripo 需要 TRIPO_API_KEY（见 .env.example）');
  }
  async fromImage(input, opts = {}) {
    return this.post('/generation/image-to-model', { input, model: opts.model, face_limit: opts.face_limit, texture: opts.texture });
  }
  async fromMultiView(inputs, opts = {}) {
    return this.post('/generation/multiview-to-model', { inputs, model: opts.model });
  }
  async post(p, body) {
    const r = await fetch(this.base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.apiKey }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Tripo ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return r.json();
  }
  async poll(taskId) {
    const r = await fetch(this.base + '/tasks/' + taskId, { headers: { Authorization: 'Bearer ' + this.apiKey } });
    if (!r.ok) throw new Error('Tripo poll ' + r.status);
    return r.json();
  }
}

export class SelfHostProvider {
  name = 'triposr';
  constructor(env = {}) {
    this.endpoint = env.TRIPOSR_ENDPOINT || 'http://localhost:8080';
    this.weights = env.TRIPOSR_WEIGHTS;
  }
  async fromImage(input, opts = {}) {
    const r = await fetch(this.endpoint + '/infer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: [input], weights: this.weights, ...opts }) });
    if (!r.ok) throw new Error('TripoSR ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return r.json();
  }
  async fromMultiView(inputs, opts = {}) {
    const r = await fetch(this.endpoint + '/infer-multiview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: inputs, weights: this.weights, ...opts }) });
    if (!r.ok) throw new Error('TripoSR ' + r.status);
    return r.json();
  }
  async poll(taskId) {
    const r = await fetch(this.endpoint + '/tasks/' + taskId);
    if (!r.ok) throw new Error('TripoSR poll ' + r.status);
    return r.json();
  }
}

export function createProvider(kind, env = {}) {
  switch (kind) {
    case 'tripo': return new TripoProvider(env);
    case 'triposr': return new SelfHostProvider(env);
    default: return new MockProvider();
  }
}

// 下载模型产物（URL → Buffer）
export async function downloadModel(url) {
  if (!url) throw new Error('模型产物 URL 为空（provider 未返回 model_url）');
  const r = await fetch(url);
  if (!r.ok) throw new Error('下载模型 ' + r.status + ': ' + url);
  return Buffer.from(await r.arrayBuffer());
}

export { sleep };
