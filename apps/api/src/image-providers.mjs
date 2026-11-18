// WorldForge AI — 图像生成 Provider（零依赖，OpenAI 兼容 /images/generations）
// kind: mock（程序化占位）| sensenova（商汤日日新 sensenova-u1.5-lite 文生图）
import { conceptImage } from '../../demo/src/png.mjs';

export class MockImageProvider {
  name = 'mock';
  async generate(prompt, size = '1024x1024') {
    return conceptImage([0.3, 0.5, 0.9], Math.floor(Math.random() * 100));
  }
}

export class SenseNovaImageProvider {
  name = 'sensenova';
  constructor(env = {}) {
    this.key = env.SENSENOVA_API_KEY;
    this.base = (env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1').replace(/\/$/, '');
    this.model = env.SENSENOVA_IMAGE_MODEL || 'sensenova-u1.5-lite';
    if (!this.key) throw new Error('IMG_PROVIDER=sensenova 需要 SENSENOVA_API_KEY（见 .env.example）');
  }
  async generate(prompt, size = '1024x1024') {
    const r = await fetch(this.base + '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.key }, body: JSON.stringify({ model: this.model, prompt, size, response_format: 'b64_json', n: 1, watermark: false }) });
    if (!r.ok) throw new Error('SenseNova 图像 ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const j = await r.json();
    const d = j.data && j.data[0];
    if (d && d.b64_json) return Buffer.from(d.b64_json, 'base64');
    if (d && d.url) { const rr = await fetch(d.url); if (rr.ok) return Buffer.from(await rr.arrayBuffer()); }
    throw new Error('SenseNova 图像无返回数据');
  }
}

export function createImageProvider(kind, env = {}) {
  return kind === 'sensenova' ? new SenseNovaImageProvider(env) : new MockImageProvider();
}
