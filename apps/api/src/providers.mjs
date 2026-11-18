// WorldForge AI — 自研图生 3D 引擎 Provider（零依赖 JS）
// kind: mock（程序化）| local（自托管单图 3D 重建引擎，我们自建/自运维）
// 这是"图→3D"的核心能力，由本项目自己实现，不依赖任何第三方商用图生3D API。

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class MockProvider {
  name = 'mock';
  async fromImage(input, opts = {}) { return { task_id: 'mock_' + Math.random().toString(36).slice(2, 9) }; }
  async fromMultiView(inputs, opts = {}) { return { task_id: 'mock_' + Math.random().toString(36).slice(2, 9) }; }
  async poll(taskId) { return { task_id: taskId, status: 'success', progress: 100, output: {} }; }
}

// 自托管重建引擎：我们部署的单图→3D 推理服务（/infer、/tasks/:id）
export class LocalReconstructionProvider {
  name = 'local';
  constructor(env = {}) {
    this.endpoint = env.LOCAL_RECON_ENDPOINT || 'http://localhost:8080';
    this.weights = env.LOCAL_RECON_WEIGHTS;
  }
  async fromImage(input, opts = {}) {
    const r = await fetch(this.endpoint + '/infer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: [input], weights: this.weights, ...opts }) });
    if (!r.ok) throw new Error('重建引擎 ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return r.json();
  }
  async fromMultiView(inputs, opts = {}) {
    const r = await fetch(this.endpoint + '/infer-multiview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: inputs, weights: this.weights, ...opts }) });
    if (!r.ok) throw new Error('重建引擎 ' + r.status);
    return r.json();
  }
  async poll(taskId) {
    const r = await fetch(this.endpoint + '/tasks/' + taskId);
    if (!r.ok) throw new Error('重建引擎 poll ' + r.status);
    return r.json();
  }
}

export function createProvider(kind, env = {}) {
  switch (kind) {
    case 'local': return new LocalReconstructionProvider(env);
    default: return new MockProvider();
  }
}

// 下载模型产物（URL → Buffer）
export async function downloadModel(url) {
  if (!url) throw new Error('模型产物 URL 为空（引擎未返回 model_url）');
  const r = await fetch(url);
  if (!r.ok) throw new Error('下载模型 ' + r.status + ': ' + url);
  return Buffer.from(await r.arrayBuffer());
}

export { sleep };
