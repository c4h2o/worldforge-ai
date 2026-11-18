// Minimal binary glTF (GLB) encoder — zero-dependency, for the Phase 0 demo.
// Builds a mesh from axis-aligned boxes (per-face normals), one material.

const FACES = [
  { n: [ 1,0,0], c: [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]] },
  { n: [-1,0,0], c: [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]] },
  { n: [0, 1,0], c: [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]] },
  { n: [0,-1,0], c: [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]] },
  { n: [0,0, 1], c: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
  { n: [0,0,-1], c: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
];

function boxVerts(center, size) {
  const pos = [], nor = [], idx = [];
  const [cx,cy,cz] = center, [sx,sy,sz] = size;
  let base = 0;
  for (const f of FACES) {
    for (const c of f.c) {
      pos.push(cx + c[0]*sx/2, cy + c[1]*sy/2, cz + c[2]*sz/2);
      nor.push(f.n[0], f.n[1], f.n[2]);
    }
    idx.push(base, base+1, base+2, base, base+2, base+3);
    base += 4;
  }
  return { pos, nor, idx };
}

export function buildGLB(boxes, name) {
  // boxes: [{ center:[x,y,z], size:[sx,sy,sz], color:[r,g,b] }]
  const pos = [], nor = [], idx = [];
  let vbase = 0;
  for (const b of boxes) {
    const v = boxVerts(b.center, b.size);
    pos.push(...v.pos); nor.push(...v.nor);
    for (const i of v.idx) idx.push(i + vbase);
    vbase += v.pos.length / 3;
  }
  const color = boxes[0]?.color ?? [0.6,0.6,0.6];

  const positions = new Float32Array(pos);
  const normals = new Float32Array(nor);
  const indices = new Uint32Array(idx);

  // bounds for POSITION min/max
  let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (let i=0;i<positions.length;i+=3){ for(let k=0;k<3;k++){ const v=positions[i+k]; if(v<min[k])min[k]=v; if(v>max[k])max[k]=v; } }

  const posBytes = positions.byteLength, norBytes = normals.byteLength, idxBytes = indices.byteLength;
  const binLen = posBytes + norBytes + idxBytes;

  const gltf = {
    asset: { version: '2.0', generator: 'worldforge-demo' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: name + '-mat', pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0.0, roughnessFactor: 0.6 } }],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: norBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes + norBytes, byteLength: idxBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length/3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: normals.length/3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };

  const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
  const bin = Buffer.alloc(binLen);
  Buffer.from(positions.buffer).copy(bin, 0);
  Buffer.from(normals.buffer).copy(bin, posBytes);
  Buffer.from(indices.buffer).copy(bin, posBytes + norBytes);

  // pad chunks to 4 bytes
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // glTF magic
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunk.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([header, jh, jsonChunk, bh, binChunk]);
}
