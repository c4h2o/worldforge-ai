// WorldForge AI — 自研图生 3D 引擎：Provider 抽象与实现（Mock / Local 自托管重建）
// 这是本项目"图→3D"核心能力，自研自建，零外部依赖（不依赖任何第三方开源/商用组件）。

export interface TaskHandle { task_id: string; }
export interface TaskState {
  task_id: string; status: 'queued' | 'running' | 'success' | 'failed';
  progress?: number; output?: { model_url?: string; model_urls?: string[] };
}

export interface ImageTo3DProvider {
  readonly name: string;
  fromImage(input: string, opts?: Record<string, unknown>): Promise<TaskHandle>;
  fromMultiView(inputs: string[], opts?: Record<string, unknown>): Promise<TaskHandle>;
  poll(taskId: string): Promise<TaskState>;
}

// 无 GPU 联调 / CI：返回占位结果
export class MockProvider implements ImageTo3DProvider {
  name = 'mock';
  async fromImage() { return { task_id: 'mock_' + Math.random().toString(36).slice(2, 9) }; }
  async fromMultiView() { return { task_id: 'mock_' + Math.random().toString(36).slice(2, 9) }; }
  async poll(taskId: string) { return { task_id: taskId, status: 'success', progress: 100, output: {} }; }
}

// 自托管单图 3D 重建引擎（我们自建/自运维的推理服务）
export class LocalReconstructionProvider implements ImageTo3DProvider {
  name = 'local';
  constructor(private env: Record<string, string> = {}) {}
  get endpoint() { return this.env.LOCAL_RECON_ENDPOINT || 'http://localhost:8080'; }
  get weights() { return this.env.LOCAL_RECON_WEIGHTS; }
  async fromImage(input: string, opts: Record<string, unknown> = {}) {
    return this.post('/infer', { images: [input], weights: this.weights, ...opts });
  }
  async fromMultiView(inputs: string[], opts: Record<string, unknown> = {}) {
    return this.post('/infer-multiview', { images: inputs, weights: this.weights, ...opts });
  }
  async poll(taskId: string) { return this.post('/tasks/' + taskId, undefined, 'GET'); }
  private async post(path: string, body?: unknown, method = 'POST') {
    const r = await fetch(this.endpoint + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error('重建引擎 ' + r.status);
    return r.json();
  }
}

export function createProvider(kind: string, env: Record<string, string> = {}): ImageTo3DProvider {
  return kind === 'local' ? new LocalReconstructionProvider(env) : new MockProvider();
}
