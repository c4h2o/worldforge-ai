import{createRenderer,persp,lookAt,trs,mul}from'/renderer.mjs';
const canvas=document.getElementById('gl'),hud=document.getElementById('info'),err=document.getElementById('err');
const fail=m=>{err.style.display='block';err.textContent=m;};
const rd=createRenderer(canvas);if(!rd.ok){fail(rd.error);throw new Error(rd.error);}
let yaw=0.7,pitch=0.35,dist=16,cx=0,cy=1,cz=-2;
function eyeFrom(){const x=cx+dist*Math.cos(pitch)*Math.sin(yaw),y=cy+dist*Math.sin(pitch),z=cz+dist*Math.cos(pitch)*Math.cos(yaw);return[x,y,z];}
let drag=null,lx=0,ly=0;
canvas.addEventListener('mousedown',e=>{drag=e.button===2?'pan':e.button===0?'rot':null;lx=e.clientX;ly=e.clientY;e.preventDefault();});
window.addEventListener('mouseup',()=>drag=null);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('mousemove',e=>{if(!drag)return;const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;
  if(drag==='rot'){yaw+=dx*0.01;pitch=Math.max(-1.5,Math.min(1.5,pitch+dy*0.01));return;}
  // 右键 = 沿相机自身平面平移（屏幕左↔右 对应相机 right，上↔下 对应相机 up）
  const f=[-Math.cos(pitch)*Math.sin(yaw),-Math.sin(pitch),-Math.cos(pitch)*Math.cos(yaw)];
  const rgt=[-f[2],0,f[0]];
  const up=[-f[0]*f[1],f[0]*f[0]+f[2]*f[2],-f[2]*f[1]];
  const s=0.0016*Math.max(2,dist);
  cx+=(-rgt[0]*dx-up[0]*dy)*s;cy+=(-rgt[1]*dx-up[1]*dy)*s;cz+=(-rgt[2]*dx-up[2]*dy)*s;});
canvas.addEventListener('wheel',e=>{dist=Math.max(2,Math.min(200,dist*(1+e.deltaY*0.001)));e.preventDefault();},{passive:false});

// ── 场景资产装载 ─────────────────────────────────
const items=[];let sceneId=null,sceneName='无场景';
const dbg=[];
async function loadItems(){
  items.length=0;
  const sc=await(await fetch('/api/scenes')).json();
  const list=sc.scenes||sc;const scene=list.at(-1);
  if(!scene){dbg.push('无场景');return 0;}
  sceneId=scene.id;sceneName=scene.name||scene.id;
  const ares=await(await fetch('/api/assets')).json();
  const lib=ares.assets||ares;
  const map=Array.isArray(lib)?Object.fromEntries(lib.map(a=>[a.id,a])):lib;
  const ents=(scene.scene_graph&&scene.scene_graph.entities)||[];
  for(const e of ents){
    const a=map[e.asset_id];
    if(!a){dbg.push('缺资产 '+e.asset_id);continue;}
    try{
      const la=await rd.loadAsset(a.local_path);
      if(!la||!Array.isArray(la.prims)||!la.prims.length){dbg.push('空网格 '+e.asset_id);continue;}
      items.push({id:e.id,prims:la.prims,parts:la.parts,pos:(e.transform&&e.transform.position)||[0,0,0],rot:(e.transform&&e.transform.rotation)||[0,0,0],scale:(e.transform&&e.transform.scale)||[1,1,1],anim:e.animation||null});
    }catch(err){dbg.push(e.asset_id+': '+err.message);}
  }
  return items.length;
}

// ── 批评器面板 + 问题实体高亮 ────────────────────────
const panel=document.getElementById('critic'),scoreEl=document.getElementById('criticScore'),issuesEl=document.getElementById('criticIssues'),fixBtn=document.getElementById('autofix'),badgeEl=document.getElementById('criticBadge');
let review=null;const flagged=new Map();
const LEVEL_COLOR={high:[1,0.28,0.32],medium:[1,0.72,0.22],low:[0.42,0.82,1]};
async function loadCritic(){
  if(!sceneId){panel.style.display='none';return;}
  const r=await(await fetch('/api/scenes/'+sceneId+'/critic')).json();
  review=r;scoreEl.textContent=r.score;
  scoreEl.style.color=r.clean?'#8f8':(r.ok?'#fd8':'#f77');
  const iss=Array.isArray(r.issues)?r.issues:[];
  badgeEl.textContent=(r.clean?'CLEAN':'有问题 '+iss.length)+' · '+(r.ok?'可接受':'不合格');
  badgeEl.style.color=r.clean?'#8f8':(r.ok?'#fd8':'#f77');
  flagged.clear();
  for(const i of iss){(i.id?[i.id]:(i.ids||[])).forEach(id=>{if(items.some(it=>it.id===id))flagged.set(id,i.level);});}
  issuesEl.innerHTML=iss.length?iss.map(i=>'<li class="'+i.level+'"><b>'+i.level+'</b> '+i.code+' · '+i.msg+'</li>').join(''):'<li class="ok">四维审查通过：量纲 / 布局 / 语义 / 光照</li>';
  panel.style.display='block';
}
fixBtn.addEventListener('click',async()=>{
  if(!sceneId)return;
  fixBtn.textContent='修正中…';fixBtn.disabled=true;
  try{
    const r=await(await fetch('/api/scenes/'+sceneId+'/autofix',{method:'POST'})).json();
    await loadItems();await loadCritic();
    hud.textContent=sceneName+' · '+items.length+' 资产 · 自修复 '+r.rounds+' 轮 '+r.before+'→'+r.after+(r.unresolved&&r.unresolved.length?' · 待处理 '+r.unresolved.length:'');
  }catch(e){fail('自修复: '+e.message);}
  fixBtn.textContent='一键自修复（生成→批评→修正）';fixBtn.disabled=false;
});
// 实体世界包围盒（原语本地 bb 经 TRS 变换）
// 自适应取景：把 WebGL 相机对准实体包围盒（与自研软光栅器同一公式）
function fitCamera(){
  let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9,any=false;
  for(const it of items){const b=worldBox(it);if(!b)continue;any=true;
    mnx=Math.min(mnx,b[0]);mxx=Math.max(mxx,b[3]);mny=Math.min(mny,b[1]);mxy=Math.max(mxy,b[4]);mnz=Math.min(mnz,b[2]);mxz=Math.max(mxz,b[5]);}
  if(!any)return false;
  cx=(mnx+mxx)/2;cy=(mny+mxy)/2;cz=(mnz+mxz)/2;
  const maxDim=Math.max(mxx-mnx,mxy-mny,mxz-mnz);
  dist=Math.max(3,maxDim*1.7/Math.tan(0.9/2)*0.5);
  yaw=0.7;pitch=0.35;
  return true;
}
function worldBox(it){
  const M=trs(it.pos,it.rot,it.scale);let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
  for(const p of it.prims){const b=p.bb;if(!b)continue;
    for(let i=0;i<8;i++){const x=i&1?b[3]:b[0],y=i&2?b[4]:b[1],z=i&4?b[5]:b[2];
      const px=M[0]*x+M[4]*y+M[8]*z+M[12],py=M[1]*x+M[5]*y+M[9]*z+M[13],pz=M[2]*x+M[6]*y+M[10]*z+M[14];
      if(px<mnx)mnx=px;if(px>mxx)mxx=px;if(py<mny)mny=py;if(py>mxy)mxy=py;if(pz<mnz)mnz=pz;if(pz>mxz)mxz=pz;}}
  return mnx>mxx?null:[mnx,mny,mnz,mxx,mxy,mxz];
}
// ── 渲染预览面板（自研软光栅静帧 + 问题实体线框叠加）──────────
const pvPanel=document.getElementById('pv'),pvImg=document.getElementById('pvImg'),pvWire=document.getElementById('pvWire'),pvRefresh=document.getElementById('pvRefresh'),pvSize=document.getElementById('pvSize'),pvWireT=document.getElementById('pvWireT');
let pvCam=null,pvW=1024,pvH=576;
function pvProj(v){
  if(!pvCam)return null;
  const pv=mul(persp(0.85,pvW/pvH,0.05,600),lookAt(pvCam.eye,pvCam.target,[0,1,0]));
  const x=pv[0]*v[0]+pv[4]*v[1]+pv[8]*v[2]+pv[12],y=pv[1]*v[0]+pv[5]*v[1]+pv[9]*v[2]+pv[13],w=pv[3]*v[0]+pv[7]*v[1]+pv[11]*v[2]+pv[15]||1;
  return[(x/w*0.5+0.5)*pvW,(1-(y/w*0.5+0.5))*pvH];
}
function drawWire(){
  const ctx=pvWire.getContext('2d');ctx.clearRect(0,0,pvWire.width,pvWire.height);
  if(!pvWireT.checked||!pvCam)return;
  const cols={high:'255,70,80',medium:'255,180,60',low:'110,210,255'};
  ctx.lineWidth=1.5;ctx.setLineDash([4,3]);
  for(const[id,lv]of flagged){const it=items.find(i=>i.id===id);if(!it)continue;const b=worldBox(it);if(!b)continue;
    const c=[[b[0],b[1],b[2]],[b[3],b[1],b[2]],[b[3],b[1],b[5]],[b[0],b[1],b[5]],[b[0],b[4],b[2]],[b[3],b[4],b[2]],[b[3],b[4],b[5]],[b[0],b[4],b[5]]];
    const e=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.strokeStyle='rgba('+(cols[lv]||'255,255,255')+',0.95)';ctx.beginPath();
    for(const[p,q]of e){const a=pvProj(c[p]),d=pvProj(c[q]);if(!a||!d)continue;ctx.moveTo(a[0],a[1]);ctx.lineTo(d[0],d[1]);}
    ctx.stroke();
  }
}
async function loadPreview(){
  if(!sceneId)return;
  pvPanel.style.display='block';pvImg.removeAttribute('src');
  const w=Number(pvSize.value)||1024,h=Math.round(w*0.5625);
  const url='/api/scenes/'+sceneId+'/preview?w='+w+'&h='+h+'&t='+Date.now();
  try{
    const r=await fetch(url);
    if(!r.ok){pvImg.alt='预览失败: HTTP '+r.status;return;}
    const meta=JSON.parse(r.headers.get('x-preview-meta')||'null');
    if(meta&&meta.camera){pvCam=meta.camera;pvW=meta.width;pvH=meta.height;pvWire.width=pvW;pvWire.height=pvH;}
    pvImg.src=url;drawWire();
  }catch(e){pvImg.alt='预览失败: '+e.message;}
}
pvImg.onerror=()=>{pvImg.alt='预览加载失败，点重新渲染';};
pvRefresh.addEventListener('click',loadPreview);
pvWireT.addEventListener('change',drawWire);
try{
  const n=await loadItems();
  hud.textContent=sceneName+' · '+n+' 资产'+(dbg.length?'（跳过: '+dbg.join('; ')+'）':'');
  if(fitCamera())hud.textContent+=' · 已自适应取景';
  await loadCritic();
  loadPreview();
window.addEventListener('error',ev=>{dbg.push('未捕获: '+ev.message);hud.textContent=sceneName+' · '+items.length+' 资产 · '+dbg.join(' | ');});
}catch(e){hud.textContent='加载失败: '+e.message+(dbg.length?' · '+dbg.join(' | '):'');panel.style.display=items.length?'block':'none';}
let diagDone=false;
function diagOnce(){
  if(diagDone)return; if(!items.length)return; diagDone=true;
  const gl=rd.gl;const e=gl.getError();
  const uintExt=gl.getExtension('OES_element_index_uint');
  const p=items[0].prims[0];
  dbg.push('GL 诊断: err='+(e===0?'无':e===1282?'INVALID_OPERATION':e===1283?'INVALID_VALUE':e)+' | OES_element_index_uint='+(uintExt?'有':'无')+' | 首prim idx='+p.count);
  hud.textContent=sceneName+' · '+items.length+' 资产 · '+dbg.join(' | ');
}
function frame(){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  const proj=persp(0.9,w/h,0.1,200),view=lookAt(eyeFrom(),[cx,cy,cz],[0,1,0]);
  rd.drawAll(items,proj,view,performance.now()/1000);
  diagOnce();
  for(const it of items){const lv=flagged.get(it.id);if(!lv)continue;const b=worldBox(it);if(!b)continue;
    rd.drawBox([b[0]-0.04,b[1]-0.04,b[2]-0.04],[b[3]+0.04,b[4]+0.04,b[5]+0.04],LEVEL_COLOR[lv]||LEVEL_COLOR.low,proj,view);}
  requestAnimationFrame(frame);
}
frame();
