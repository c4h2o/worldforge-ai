import{createRenderer,persp,lookAt,trs}from'/renderer.mjs';
const canvas=document.getElementById('gl'),hud=document.getElementById('info'),err=document.getElementById('err');
const fail=m=>{err.style.display='block';err.textContent=m;};
const rd=createRenderer(canvas);if(!rd.ok){fail(rd.error);throw new Error(rd.error);}
let yaw=0.7,pitch=0.35,dist=16,cx=0,cy=1,cz=-2;
function eyeFrom(){const x=cx+dist*Math.cos(pitch)*Math.sin(yaw),y=cy+dist*Math.sin(pitch),z=cz+dist*Math.cos(pitch)*Math.cos(yaw);return[x,y,z];}
let drag=null,lx=0,ly=0;
canvas.addEventListener('mousedown',e=>{drag=e.button===2?'pan':e.button===0?'rot':null;lx=e.clientX;ly=e.clientY;e.preventDefault();});
window.addEventListener('mouseup',()=>drag=null);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('mousemove',e=>{if(!drag)return;const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;if(drag==='rot'){yaw+=dx*0.01;pitch=Math.max(-1.5,Math.min(1.5,pitch+dy*0.01));}else{const s=dist*0.0016;cx-=Math.sin(yaw)*dx*s;cz-=Math.cos(yaw)*dx*s;cy+=dy*s;}});
canvas.addEventListener('wheel',e=>{dist=Math.max(3,Math.min(60,dist*(1+e.deltaY*0.001)));e.preventDefault();},{passive:false});

// ── 场景资产装载 ─────────────────────────────────
const items=[];let sceneId=null,sceneName='无场景';
async function loadItems(){
  items.length=0;
  const sc=await(await fetch('/api/scenes')).json();
  const list=sc.scenes||sc;const scene=list.at(-1);
  if(!scene)return 0;
  sceneId=scene.id;sceneName=scene.name||scene.id;
  const ares=await(await fetch('/api/assets')).json();
  const lib=ares.assets||ares;
  const map=Array.isArray(lib)?Object.fromEntries(lib.map(a=>[a.id,a])):lib;
  for(const e of scene.scene_graph.entities){const a=map[e.asset_id];if(!a)continue;const la=await rd.loadAsset(a.local_path);items.push({id:e.id,prims:la.prims,parts:la.parts,pos:e.transform.position||[0,0,0],rot:e.transform.rotation||[0,0,0],scale:e.transform.scale||[1,1,1],anim:e.animation||null});}
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
  badgeEl.textContent=(r.clean?'CLEAN':'有问题 '+(r.issues.length||0))+' · '+(r.ok?'可接受':'不合格');
  badgeEl.style.color=r.clean?'#8f8':(r.ok?'#fd8':'#f77');
  flagged.clear();
  for(const i of r.issues){(i.id?[i.id]:(i.ids||[])).forEach(id=>{if(items.some(it=>it.id===id))flagged.set(id,i.level);});}
  issuesEl.innerHTML=r.issues.length?r.issues.map(i=>'<li class="'+i.level+'"><b>'+i.level+'</b> '+i.code+' · '+i.msg+'</li>').join(''):'<li class="ok">四维审查通过：量纲 / 布局 / 语义 / 光照</li>';
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
function worldBox(it){
  const M=trs(it.pos,it.rot,it.scale);let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
  for(const p of it.prims){const b=p.bb;if(!b)continue;
    for(let i=0;i<8;i++){const x=i&1?b[3]:b[0],y=i&2?b[4]:b[1],z=i&4?b[5]:b[2];
      const px=M[0]*x+M[4]*y+M[8]*z+M[12],py=M[1]*x+M[5]*y+M[9]*z+M[13],pz=M[2]*x+M[6]*y+M[10]*z+M[14];
      if(px<mnx)mnx=px;if(px>mxx)mxx=px;if(py<mny)mny=py;if(py>mxy)mxy=py;if(pz<mnz)mnz=pz;if(pz>mxz)mxz=pz;}}
  return mnx>mxx?null:[mnx,mny,mnz,mxx,mxy,mxz];
}
try{
  const n=await loadItems();
  hud.textContent=sceneName+' · '+n+' 资产';
  await loadCritic();
}catch(e){hud.textContent='加载失败: '+e.message;panel.style.display='none';}
function frame(){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  const proj=persp(0.9,w/h,0.1,200),view=lookAt(eyeFrom(),[cx,cy,cz],[0,1,0]);
  rd.drawAll(items,proj,view,performance.now()/1000);
  for(const it of items){const lv=flagged.get(it.id);if(!lv)continue;const b=worldBox(it);if(!b)continue;
    rd.drawBox([b[0]-0.04,b[1]-0.04,b[2]-0.04],[b[3]+0.04,b[4]+0.04,b[5]+0.04],LEVEL_COLOR[lv]||LEVEL_COLOR.low,proj,view);}
  requestAnimationFrame(frame);
}
frame();
