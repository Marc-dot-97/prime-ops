(function(){
let RAW=[],NMEM=0;const CFG=window.OPS_CONFIG||{};
let NOW=Date.now();const DAY=864e5;
let MEM=[];const memName=i=>i<26?'Member '+String.fromCharCode(65+i):'Member '+(i+1);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let T=[];
const $=s=>document.querySelector(s);
const ST=['to do','in progress','blocked','complete'],SC={'to do':'#8F9490','in progress':'#6F9A22','blocked':'#d6213f','complete':'#B5E03F'};
const PR=['urgent','high','normal','low','none'];
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const fd=ms=>ms?new Date(ms).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'—';
const isOpen=t=>t.st!=='complete';
const overdue=t=>isOpen(t)&&t.due&&t.due<NOW;
const sig=t=>t.st==='complete'?'ok':(t.st==='blocked'||overdue(t)||t.pr==='urgent')?'crit':(t.st==='in progress'?'warn':'none');
const sigName={ok:'Complete',warn:'In progress',crit:'Critical',none:'Not started'};
const mon=ms=>{const d=new Date(ms);const w=(d.getUTCDay()+6)%7;return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-w)};
const rel=ms=>{const d=Math.round((NOW-ms)/DAY);return d<=0?'today':d===1?'yesterday':d+' days ago'};
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
// toasts
function toast(m,bad){const e=document.createElement('div');e.className='toast';const g=document.createElement('span');g.className='sig '+(bad?'warn':'ok');e.appendChild(g);e.appendChild(document.createTextNode(m));$('#toasts').appendChild(e);setTimeout(()=>{e.classList.add('out');setTimeout(()=>e.remove(),500)},bad?6000:3200)}
// state
const S={q:'',st:'',pr:'',as:'',wk:'',list:'',sort:'upd',dir:-1,page:0};
const fill=(id,arr)=>{$(id).innerHTML=arr.map(a=>`<option value="${a[0]}">${a[1]}</option>`).join('')};
fill('#fs',[['','All statuses'],...ST.map(s=>[s,cap(s)])]);
fill('#fp',[['','All priorities'],...PR.map(s=>[s,cap(s)])]);
function fillAssignees(){const cur=$('#fa').value;fill('#fa',[['','Everyone'],...MEM.map((m,i)=>[i,m]),['none','Unassigned']]);$('#fa').value=cur&&[...$('#fa').options].some(o=>o.value===cur)?cur:'';}
fill('#fw',[['','All time'],['7','Updated last 7 days'],['30','Updated last 30 days'],['90','Updated last 90 days']]);
let lists=[];
function filtered(skipList){const q=S.q.toLowerCase();return T.filter(t=>
 (!q||t.name.toLowerCase().includes(q))&&(!S.st||t.st===S.st)&&(!S.pr||t.pr===S.pr)&&
 (S.as===''||(S.as==='none'?!t.as.length:t.as.includes(+S.as)))&&(!S.wk||NOW-t.upd<=+S.wk*DAY)&&(skipList||!S.list||t.list===S.list))}
// KPIs
const KP=[['Total tasks',d=>d.length,d=>'in selection'],['Complete',d=>d.filter(t=>t.st==='complete').length,d=>Math.round(100*d.filter(t=>t.st==='complete').length/(d.length||1))+'% done','ok'],['In progress',d=>d.filter(t=>t.st==='in progress').length,d=>'active now','warn'],['Overdue',d=>d.filter(overdue).length,d=>'open past due date','crit'],['Blocked',d=>d.filter(t=>t.st==='blocked').length,d=>'waiting on something','crit'],['Closed in 7 days',d=>d.filter(t=>t.cl&&NOW-t.cl<=7*DAY).length,d=>'recent throughput','ok']];
$('#kpis').innerHTML=KP.map((k,i)=>`<div class="card kpi lift rv iridescent-glass" style="--d:${i*70}ms"><h2>${k[0]}</h2><div class="v" data-i="${i}">0</div><div class="d">${k[3]?'<span class="sig '+k[3]+'"></span>':''}<span data-d="${i}"></span></div><div class="bar" ${i===1?'':'hidden'}><i id="pb"></i></div></div>`).join('');
const prev=new Array(KP.length).fill(0);
function countUp(el,to,from){if(reduce){el.textContent=to;return}const t0=performance.now(),dur=800;(function f(n){const p=Math.min(1,(n-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=Math.round(from+(to-from)*e);if(p<1)requestAnimationFrame(f)})(t0)}
function renderKPIs(){const d=filtered();KP.forEach((k,i)=>{const v=k[1](d);countUp(document.querySelector(`.v[data-i="${i}"]`),v,prev[i]);prev[i]=v;document.querySelector(`[data-d="${i}"]`).textContent=k[2](d)});$('#pb').style.width=Math.round(100*d.filter(t=>t.st==='complete').length/(d.length||1))+'%'}
// list cards
function renderLists(){const d=filtered(true);$('#lists').innerHTML=lists.map((l,i)=>{const x=d.filter(t=>t.list===l),c=x.filter(t=>t.st==='complete').length,p=x.length?Math.round(100*c/x.length):0,od=x.filter(overdue).length;
 return `<button class="lcard iridescent-glass rv in${S.list===l?' sel':''}" data-l="${esc(l)}" style="--d:${i*50}ms"><b>${esc(l)}</b><small>${x.length} task${x.length===1?"":"s"} · ${x.length-c} open</small><div class="row2"><span class="pc">${p}%</span><span class="tag">${od?'<span class="sig crit"></span>'+od+' overdue':'<span class="sig ok"></span>On track'}</span></div><div class="bar"><i style="width:${p}%"></i></div></button>`}).join('')}
$('#lists').addEventListener('click',e=>{const b=e.target.closest('.lcard');if(!b)return;S.list=S.list===b.dataset.l?'':b.dataset.l;S.page=0;toast(S.list?'Filtered to '+S.list:'List filter cleared');update()});
// charts
const CH={};
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim()}
function mk(id,cfg){if(CH[id]){CH[id].data=cfg.data;CH[id].update();return}CH[id]=new Chart($(id),cfg)}
function charts(){if(!window.Chart)return;const d=filtered(),ink=css('--mute'),grid=css('--chart-grid');
 Chart.defaults.font.family='Manrope,system-ui,sans-serif';Chart.defaults.color=ink;
 const sc={x:{grid:{display:false},ticks:{color:ink}},y:{grid:{color:grid},ticks:{color:ink},beginAtZero:true}};
 const wk={};d.filter(t=>t.cl).forEach(t=>{const w=mon(t.cl);wk[w]=(wk[w]||0)+1});const ks=Object.keys(wk).map(Number).sort((a,b)=>a-b);let run=0;
 mk('#c1',{type:'bar',data:{labels:ks.map(k=>new Date(k).toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'})),datasets:[{label:'Completed',data:ks.map(k=>wk[k]),backgroundColor:'#B5E03F',borderRadius:0,order:2},{type:'line',label:'Cumulative',data:ks.map(k=>run+=wk[k]),borderColor:css('--ink'),backgroundColor:css('--ink'),tension:.3,pointRadius:3,yAxisID:'y1',order:1}]},options:{maintainAspectRatio:false,scales:{...sc,y1:{position:'right',grid:{display:false},beginAtZero:true,ticks:{color:ink}}},plugins:{legend:{labels:{boxWidth:10}}}}});
 mk('#c2',{type:'doughnut',data:{labels:ST.map(cap),datasets:[{data:ST.map(s=>d.filter(t=>t.st===s).length),backgroundColor:ST.map(s=>SC[s]),borderWidth:0}]},options:{maintainAspectRatio:false,cutout:'66%',plugins:{legend:{position:'bottom',labels:{boxWidth:10}}}}});
 const ms=[...MEM.map((m,i)=>[m,i]),['Unassigned','none']];
 const has=(t,k)=>k==='none'?!t.as.length:t.as.includes(k);
 mk('#c3',{type:'bar',data:{labels:ms.map(m=>m[0]),datasets:[{label:'Open',data:ms.map(m=>d.filter(t=>has(t,m[1])&&isOpen(t)).length),backgroundColor:'#6F9A22'},{label:'Complete',data:ms.map(m=>d.filter(t=>has(t,m[1])&&!isOpen(t)).length),backgroundColor:'#B5E03F'}]},options:{maintainAspectRatio:false,indexAxis:'y',scales:{x:{stacked:true,grid:{color:grid},ticks:{color:ink}},y:{stacked:true,grid:{display:false},ticks:{color:ink}}},plugins:{legend:{labels:{boxWidth:10}}}}});
 mk('#c4',{type:'bar',data:{labels:PR.map(cap),datasets:[{data:PR.map(p=>d.filter(t=>isOpen(t)&&t.pr===p).length),backgroundColor:['#d6213f','#f2b705','#8F9490','#B5E03F','#555a5e']}]},options:{maintainAspectRatio:false,scales:sc,plugins:{legend:{display:false}}}})}
// attention
function renderAtt(){const d=filtered().filter(t=>isOpen(t)&&sig(t)==='crit').sort((a,b)=>(a.due||9e15)-(b.due||9e15));
 const od=d.filter(overdue).length,bl=d.filter(t=>t.st==='blocked').length;
 $('#alerts').innerHTML=(od?`<div class="calert c"><span class="sig crit"></span><span><b>${od} overdue</b> task${od>1?'s':''} past their due date.</span></div>`:'')+(bl?`<div class="calert"><span class="sig warn"></span><span><b>${bl} blocked</b> task${bl>1?'s':''} need a decision.</span></div>`:'')+(!d.length?`<div class="calert g"><span class="sig ok"></span><span>Nothing needs attention in this selection.</span></div>`:'');
 $('#att').innerHTML=d.slice(0,25).map(t=>`<li data-i="${t.i}" tabindex="0"><span class="sig ${sig(t)}"></span><span>${esc(t.name)}<small>${esc(t.list)} · ${t.due?'due '+fd(t.due):cap(t.st)}</small></span></li>`).join('')}
$('#att').addEventListener('click',e=>{const l=e.target.closest('li');l&&openD(+l.dataset.i)});
$('#att').addEventListener('keydown',e=>{if(e.key==='Enter'){const l=e.target.closest('li');l&&openD(+l.dataset.i)}});
// table
const COLS=[['name','Task'],['list','List'],['st','Status'],['pr','Priority'],['as','Assignee'],['due','Due'],['upd','Updated']];
$('#thead').innerHTML=COLS.map(c=>`<th data-k="${c[0]}" tabindex="0" scope="col">${c[1]}</th>`).join('');
const PS=15,po={urgent:0,high:1,normal:2,low:3,none:4};
const key=(t,k)=>k==='pr'?po[t.pr]:k==='as'?(t.as[0]??99):k==='st'?ST.indexOf(t.st):k==='due'?(t.due||9e15):t[k];
function renderTable(){const d=filtered().sort((a,b)=>{const x=key(a,S.sort),y=key(b,S.sort);return(x>y?1:x<y?-1:0)*S.dir});
 const pages=Math.max(1,Math.ceil(d.length/PS));S.page=Math.min(S.page,pages-1);
 $('#tb').innerHTML=d.slice(S.page*PS,S.page*PS+PS).map(t=>`<tr data-i="${t.i}" tabindex="0"><td>${esc(t.name)}</td><td>${esc(t.list)}</td><td><span class="tag"><span class="sig ${sig(t)}"></span>${cap(t.st)}</span></td><td>${cap(t.pr)}</td><td>${t.as.length?t.as.map(a=>MEM[a]).join(', '):'<span class="tag" style="color:var(--mute);font-style:italic"><span class="sig none"></span>Unassigned</span>'}</td><td>${overdue(t)?'<b style="color:var(--crit)">'+fd(t.due)+'</b>':fd(t.due)}</td><td>${rel(t.upd)}</td></tr>`).join('')||'<tr><td colspan="7">No tasks match.</td></tr>';
 $('#tsub').textContent=d.length+' tasks · click a row for details';$('#pinfo').textContent=`Page ${S.page+1} of ${pages}`;$('#prev').disabled=S.page===0;$('#next').disabled=S.page>=pages-1;
 document.querySelectorAll('th').forEach(h=>h.setAttribute('aria-sort',h.dataset.k===S.sort?(S.dir>0?'ascending':'descending'):'none'))}
$('#thead').addEventListener('click',e=>{const h=e.target.closest('th');if(!h)return;S.dir=S.sort===h.dataset.k?-S.dir:1;S.sort=h.dataset.k;renderTable()});
$('#tb').addEventListener('click',e=>{const r=e.target.closest('tr');r&&r.dataset.i&&openD(+r.dataset.i)});
$('#tb').addEventListener('keydown',e=>{if(e.key==='Enter'){const r=e.target.closest('tr');r&&r.dataset.i&&openD(+r.dataset.i)}});
$('#prev').onclick=()=>{S.page--;renderTable()};$('#next').onclick=()=>{S.page++;renderTable()};
// drawer
let lastF=null;
function openD(i){const t=T[i];lastF=document.activeElement;$('#dbody').innerHTML=`<span class="tag"><span class="sig ${sig(t)}"></span><b>${sigName[sig(t)]}</b></span><h3>${esc(t.name)}</h3><dl><dt>List</dt><dd>${esc(t.list)}</dd><dt>Status</dt><dd>${cap(t.st)}</dd><dt>Priority</dt><dd>${cap(t.pr)}</dd><dt>Assignee</dt><dd>${t.as.map(a=>MEM[a]).join(', ')||'Unassigned'}</dd><dt>Due</dt><dd>${fd(t.due)}${overdue(t)?' · overdue by '+Math.round((NOW-t.due)/DAY)+' days':''}</dd><dt>Updated</dt><dd>${fd(t.upd)} (${rel(t.upd)})</dd><dt>Closed</dt><dd>${fd(t.cl)}</dd></dl>`;
 $('#drawer').classList.add('on');$('#scrim').classList.add('on');$('#drawer').setAttribute('aria-hidden','false');$('#dclose').focus()}
function closeD(){$('#drawer').classList.remove('on');$('#scrim').classList.remove('on');$('#drawer').setAttribute('aria-hidden','true');lastF&&lastF.focus()}
$('#dclose').onclick=closeD;$('#scrim').onclick=closeD;addEventListener('keydown',e=>{if(e.key==='Escape')closeD()});
// filters wiring
function badge(){const n=[S.q,S.st,S.pr,S.as,S.wk,S.list].filter(x=>x!=='').length;const b=$('#fbadge');b.hidden=!n;b.textContent=n}
function update(){badge();renderKPIs();renderLists();charts();renderAtt();renderTable()}
let tm;$('#q').oninput=e=>{clearTimeout(tm);tm=setTimeout(()=>{S.q=e.target.value;S.page=0;update()},180)};
[['#fs','st'],['#fp','pr'],['#fa','as'],['#fw','wk']].forEach(([id,k])=>$(id).onchange=e=>{S[k]=e.target.value;S.page=0;update()});
$('#reset').onclick=()=>{Object.assign(S,{q:'',st:'',pr:'',as:'',wk:'',list:'',page:0});$('#q').value='';['#fs','#fp','#fa','#fw'].forEach(i=>$(i).value='');update();toast('Filters reset')};
$('#csv').onclick=()=>{const d=filtered();const esc=v=>'"'+String(v).replace(/"/g,'""')+'"';const csv=['Task,List,Status,Priority,Assignee,Due,Updated,Closed',...d.map(t=>[t.name,t.list,t.st,t.pr,t.as.map(a=>MEM[a]).join('; '),fd(t.due),fd(t.upd),fd(t.cl)].map(esc).join(','))].join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='team-space-tasks.csv';a.click();toast('Exported '+d.length+' tasks to CSV')};
// theme
$('#theme').onclick=()=>{const r=document.documentElement,dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;r.dataset.theme=dark?'light':'dark';Object.values(CH).forEach(c=>c.destroy());for(const k in CH)delete CH[k];charts()};
// sticky + global alert
const top=$('#top');const onS=()=>top.classList.toggle('stuck',scrollY>80);addEventListener('scroll',onS,{passive:true});onS();
$('#gclose').onclick=()=>$('#galert').classList.add('gone');
// staggered reveal once
const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){en.target.classList.add('in');setTimeout(()=>en.target.classList.add('ready'),400);io.unobserve(en.target)}}),{threshold:.08});
document.querySelectorAll('.rv').forEach(el=>io.observe(el));
if(!window.Chart){document.querySelectorAll('.cv').forEach(c=>c.innerHTML='<div class="calert">Charts could not load (offline?). All other views still work.</div>')}

// ---------- live data ----------
let loading=false,lastSync=0,lastStale=false;
const sync=$('#sync');
function ago(ms){const m=Math.round((Date.now()-ms)/6e4);return m<1?'just now':m===1?'1 min ago':m+' min ago'}
function paintSync(){if(!lastSync){return}sync.textContent=(lastStale?'Showing last good data · ':'Synced ')+ago(lastSync);sync.classList.toggle('stale',lastStale)}
function showState(kind,msg,canConnect){const box=$('#state');if(!kind){box.hidden=true;box.innerHTML='';return}
 box.hidden=false;box.innerHTML='<div class="calert '+(kind==='bad'?'c':'')+'"><span class="sig '+(kind==='bad'?'crit':'warn')+'"></span><span>'+esc(msg)+(canConnect?' <a href="/ops/clickup/connect" class="nbtn" style="display:inline-block;margin-left:10px;text-decoration:none">Connect ClickUp</a>':'')+'</span></div>'}
async function load(manual){
 if(loading)return;loading=true;$('#refresh').disabled=true;
 try{
  const r=await fetch('/api/ops/tasks'+(manual?'?refresh=1':''),{credentials:'same-origin',headers:{Accept:'application/json'}});
  if(r.status===401||r.redirected&&/login/.test(r.url)){location.href='/login';return}
  const d=await r.json().catch(()=>({}));
  if(!r.ok){showState(d.error==='not_connected'?'warn':'bad',d.message||'Could not load tasks.',d.canConnect);if(manual)toast(d.message||'Refresh failed',true);return}
  RAW=d.tasks;NMEM=d.members;NOW=Date.now();MEM=Array.from({length:NMEM},(_,i)=>memName(i));
  T=RAW.map((x,i)=>({i,name:x.name,st:x.st,pr:x.pr,as:x.as,due:x.due,upd:x.upd,cl:x.cl,list:x.list}));
  lists=[...new Set([...T.map(t=>t.list),...(d.allLists||[])])].sort((a,b)=>T.filter(t=>t.list===b).length-T.filter(t=>t.list===a).length);
  if(S.list&&!lists.includes(S.list))S.list='';
  lastSync=d.syncedAt;lastStale=!!d.stale;fillAssignees();
  $('#mlast').textContent=memName(Math.max(0,NMEM-1)).replace('Member ','');
  showState(d.stale?'warn':null,d.stale?'ClickUp could not be reached. Showing the last data received.':'');
  update();paintSync();
  const od=T.filter(overdue).length;$('#gcount').textContent=T.length+' tasks · '+od+' overdue · '+T.filter(t=>t.st==='blocked').length+' blocked';
  document.querySelectorAll('.skel').forEach(x=>x.parentElement.classList.add('ready'));
  if(manual)toast('Refreshed from ClickUp');
 }catch(e){showState('bad','Could not reach the server. Check your connection.');if(manual)toast('Refresh failed',true)}
 finally{loading=false;$('#refresh').disabled=false}
}
$('#refresh').onclick=()=>load(true);
setInterval(()=>{if(!document.hidden)load(false)},(CFG.refreshSeconds||300)*1000);
setInterval(paintSync,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastSync>(CFG.refreshSeconds||300)*1000)load(false)});
fillAssignees();renderTable();load(false);

})();
