/**
 * WorldForge AI — 图生 3D Provider 抽象（学习 Tripo 的关键抽象）
 * Mock / Tripo(商用API) / SelfHost(开源 TripoSR+Blender) 可换源。
 */
import type { Task } from '@worldforge/core';

export interface TaskHandle { task_id: string }
export interface TaskState { task_id: string; status: Task['status']; progress: number; output?: Record<string, unknown> }

export interface ImageTo3DProvider {
  readonly name: string;
  fromImage(img: string, opts?: { model?: string; faceLimit?: number; texture?: boolean; pbr?: boolean }): Promise<TaskHandle>;
  fromMultiView(views: string[], opts?: { model?: string }): Promise<TaskHandle>;
  postprocess(taskId: string, op: 'segment'|'decimate'|'uv'|'texture'|'convert'|'complete', opts?: Record<string, unknown>): Promise<TaskHandle>;
  rig(taskId: string, opts?: { spec?: string }): Promise<TaskHandle>;
  animate(taskId: string, opts?: { animations?: string[] }): Promise<TaskHandle>;
  poll(taskId: string): Promise<TaskState>;
}

/** 无 GPU / 无 API Key 时的联调与 CI 占位（Demo 用） */
export class MockProvider implements ImageTo3DProvider {
  readonly name = 'mock';
  private seq = 0;
  async fromImage(img: string, opts = {}): Promise<TaskHandle> {
    return { task_id: `mock-img3d-${++this.seq}` };
  }
  async fromMultiView(views: string[], opts = {}): Promise<TaskHandle> {
    return { task_id: `mock-img3d-${++this.seq}` };
  }
  async postprocess(taskId: string, op: string, opts = {}): Promise<TaskHandle> {
    return { task_id: `mock-post-${++this.seq}` };
  }
  async rig(taskId: string, opts = {}): Promise<TaskHandle> { return { task_id: `mock-rig-${++this.seq}` }; }
  async animate(taskId: string, opts = {}): Promise<TaskHandle> { return { task_id: `mock-anim-${++this.seq}` }; }
  async poll(taskId: string): Promise<TaskState> {
    return { task_id: taskId, status: 'success', progress: 100, output: { model_url: `output/${taskId}.glb` } };
  }
}

/** Tripo 商用 API Provider（起步保质量）。实现体需填 API Key；见 docs/ARCHITECTURE.md。 */
export class TripoProvider implements ImageTo3DProvider {
  readonly name = 'tripo';
  constructor(private opts: { apiKey?: string; baseUrl?: string } = {}) {}
  private async post(pathname: string, body: unknown): Promise<TaskHandle> {
    if (!this.opts.apiKey) throw new Error('TRIPO_API_KEY missing — set in .env (see .env.example)');
    const res = await fetch(`${this.opts.baseUrl ?? 'https://openapi.tripo3d.ai/v3'}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Tripo API ${res.status}: ${await res.text()}`);
    return (await res.json()) as TaskHandle;
  }
  fromImage(img: string, opts = {}) { return this.post('/generation/image-to-model', { input: img, ...opts }); }
  fromMultiView(views: string[], opts = {}) { return this.post('/generation/multiview-to-model', { inputs: views, ...opts }); }
  postprocess(taskId: string, op: string, opts = {}) {
    const map: Record<string, string> = { segment: '/mesh/segment', decimate: '/mesh/decimate', uv: '/mesh/uv', texture: '/models/texture', convert: '/models/convert', complete: '/mesh/complete' };
    return this.post(map[op] ?? '/models/convert', { input: taskId, ...opts });
  }
  rig(taskId: string, opts = {}) { return this.post('/animations/rig', { input: taskId, ...opts }); }
  animate(taskId: string, opts = {}) { return this.post('/animations/retarget', { input: taskId, ...opts }); }
  async poll(taskId: string): Promise<TaskState> {
    const res = await fetch(`${this.opts.baseUrl ?? 'https://openapi.tripo3d.ai/v3'}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    return (await res.json()) as TaskState;
  }
}

/** 自托管开源 TripoSR(+TripoSG/SF) + Blender 后处理 Provider（降本）。 */
export class SelfHostProvider implements ImageTo3DProvider {
  readonly name = 'triposr';
  constructor(private opts: { endpoint?: string; weights?: string } = {}) {}
  private async post(pathname: string, body: unknown): Promise<TaskHandle> {
    const res = await fetch(`${this.opts.endpoint ?? 'http://localhost:8080'}${pathname}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`SelfHost ${res.status}: ${await res.text()}`);
    return (await res.json()) as TaskHandle;
  }
  fromImage(img: string, opts = {}) { return this.post('/infer', { images: [img], ...opts }); }
  fromMultiView(views: string[], opts = {}) { return this.post('/infer-multiview', { images: views, ...opts }); }
  postprocess(taskId: string, op: string, opts = {}) { return this.post('/postprocess', { task: taskId, op, ...opts }); }
  rig(taskId: string, opts = {}) { return this.post('/rig', { task: taskId, ...opts }); }
  animate(taskId: string, opts = {}) { return this.post('/animate', { task: taskId, ...opts }); }
  async poll(taskId: string): Promise<TaskState> {
    const res = await fetch(`${this.opts.endpoint ?? 'http://localhost:8080'}/tasks/${taskId}`);
    return (await res.json()) as TaskState;
  }
}

export function createProvider(kind: 'mock' | 'tripo' | 'triposr', env: Record<string, string | undefined> = {}): ImageTo3DProvider {
  switch (kind) {
    case 'tripo': return new TripoProvider({ apiKey: env.TRIPO_API_KEY, baseUrl: env.TRIPO_BASE_URL });
    case 'triposr': return new SelfHostProvider({ weights: env.TRIPOSR_WEIGHTS });
    default: return new MockProvider();
  }
}
