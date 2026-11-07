import {normalizeState,tsvRows,workbookBytes} from './security.mjs';

/* ---------------- 기본 설정 ---------------- */
const PRESET={
  mid:{subj:['국어','사회','도덕','수학','과학','체육','음악','미술','영어','자율','동아리','진로','학교자율'],spec:['영어'],block:['미술']},
  high:{subj:['국어','사회','도덕','수학','과학','실과','체육','음악','미술','영어','자율','동아리','진로','학교자율'],spec:['영어'],block:['미술']}
};
const preset=g=>g<=4?PRESET.mid:PRESET.high;
const HUE0={국어:352,사회:28,도덕:48,수학:215,과학:165,체육:100,음악:282,미술:322,영어:195,자율:250,동아리:75,진로:135,학교자율:5,
  실과:120,바른생활:40,슬기로운생활:180,즐거운생활:300,안전한생활:15};
const EXTRA=[210,15,270,145,60,330,95,235,185,0];
const DAYS=['월','화','수','목','금'];
const NP=6;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const K=(d,p)=>d*NP+p, DP=k=>[Math.floor(k/NP),k%NP];

const GRADES=[3,4,5,6];
let G=3;
try{const g=+localStorage.getItem('tt-grade');if(GRADES.includes(g))G=g}catch(e){}
let SUBJ=[],SPEC=[],BLOCK=[],NC=1,HUE={};

function defState(g){
  const p=preset(g);
  return {cfg:{nc:7,subj:[...p.subj],spec:[...p.spec],block:[...p.block]},
    week:'',periods:[5,6,5,5,5],target:{},avail:{},teachers:{},
    fixed:[],auto:[],seed:1,report:null};
}
function ensureShape(){ S=normalizeState(S,defState(G));applyCfg(); }
function applyCfg(){
  SUBJ=S.cfg.subj;SPEC=S.cfg.spec;BLOCK=S.cfg.block;NC=S.cfg.nc;
  HUE={};let i=0;for(const s of SUBJ)HUE[s]=s in HUE0?HUE0[s]:EXTRA[(i++)%EXTRA.length];
}
const lkey=g=>'tt-g'+g;
function loadLocal(g){
  let st=null;try{st=JSON.parse(localStorage.getItem(lkey(g))||'null')}catch(e){}
  return st&&st.cfg?st:defState(g);
}
let S=loadLocal(G);ensureShape();
let brush={type:'subj',s:SUBJ[0],l:''};

function validKeys(){const a=[];for(let d=0;d<5;d++)for(let p=0;p<S.periods[d];p++)a.push(K(d,p));return a}
function isValid(k){const[d,p]=DP(k);return p<S.periods[d]}
function cell(c,k){
  const f=S.fixed[c][k];
  if(f) return {subj:f.s||null,label:f.l||f.s,fixed:true};
  const a=S.auto[c][k];
  if(a) return {subj:a,label:a,fixed:false};
  return null;
}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function shuffle(arr,r){for(let i=arr.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}

/* ---------------- 이 브라우저에만 저장 ---------------- */
function hasContent(x){return !!(x&&(String(x.week||'').trim()||(x.fixed||[]).some(o=>o&&Object.keys(o).length)||(x.auto||[]).some(o=>o&&Object.keys(o).length)))}
function save(){
  try{localStorage.setItem(lkey(G),JSON.stringify(S));$('sync').textContent='이 컴퓨터 브라우저에만 저장돼요';$('sync').className='sync ok'}
  catch{$('sync').textContent='브라우저에 저장하지 못했어요. 파일로 내보내 주세요.';$('sync').className='sync err'}
}
function switchGrade(g){
  if(g===G||!GRADES.includes(g))return;
  G=g;try{localStorage.setItem('tt-grade',String(g))}catch{}
  S=loadLocal(G);ensureShape();brush={type:'subj',s:SUBJ[0],l:''};
  $('cfgBox').open=!hasContent(S);renderAll();
}
$('clearLocal').addEventListener('click',async()=>{
  if(!await ask('이 브라우저의 모든 시간표를 지울까요?','3~6학년 시간표와 선생님 이름 등 이 앱이 저장한 내용을 모두 지웁니다. 내려받은 파일은 따로 지워 주세요.','모두 삭제'))return;
  try{for(const g of GRADES)localStorage.removeItem(lkey(g));localStorage.removeItem('tt-grade')}
  catch{say('브라우저 설정에서 이 사이트의 저장 데이터를 삭제해 주세요.',true);return}
  S=defState(G);ensureShape();brush={type:'subj',s:SUBJ[0],l:''};renderAll();$('sync').textContent='저장된 시간표를 모두 삭제했어요';
});

/* ---------------- solver ---------------- */
function dayPenalty(get,d){
  const pos={};
  for(let p=0;p<S.periods[d];p++){const s=get(K(d,p));if(s)(pos[s]=pos[s]||[]).push(p)}
  let pen=0;
  for(const s in pos){
    const ps=pos[s],k=ps.length;
    if(k<2) continue;
    if(k>=3) pen+=40*(k-2);
    let consec=false;for(let i=1;i<k;i++) if(ps[i]===ps[i-1]+1) consec=true;
    if(BLOCK.includes(s)) pen+= (k===2&&consec)?-6:6;
    else pen+= consec?2:3;
  }
  return pen;
}

function solve(){
  applyCfg();
  const rng=mulberry32(S.seed*9973+17);
  const keys=validKeys();
  const auto=[...Array(NC)].map(()=>({}));
  const msgs=[];
  const need=[];
  for(let c=0;c<NC;c++){
    const n={};for(const s of SUBJ)n[s]=S.target[s]||0;
    for(const k in S.fixed[c]){ if(!isValid(+k)) continue; const s=S.fixed[c][k].s; if(s&&s in n) n[s]--; }
    need.push(n);
  }
  const occ=[...Array(NC)].map((_,c)=>new Set(Object.keys(S.fixed[c]).map(Number).filter(isValid)));
  const CL=[...Array(NC).keys()];

  // ---- 전담 과목
  if(SPEC.length){
    const levels=[{exc:false},{exc:true}];
    let specDone=null;const capMsg=[];
    const okAt=(s,d,p,lv)=>{const a=S.avail[s][d][p];return a===1||(lv.exc&&a===2)};
    const capOK=lv=>SPEC.every(s=>{
      let cap=0,blocked=[];
      for(const k of keys){const[d,p]=DP(k);
        if(!okAt(s,d,p,lv)) continue;
        if(CL.some(c=>occ[c].has(k)&&S.fixed[c][k].s===s)) continue;
        if(CL.every(c=>occ[c].has(k))){blocked.push(`${DAYS[d]}${p+1}`);continue}
        cap++;
      }
      const tot=need.reduce((a,n)=>a+Math.max(0,n[s]),0);
      if(tot>cap){ if(lv.exc) capMsg.push(`${s}: 쓸 수 있는 칸 ${cap}개, 필요한 시수 ${tot}시간${blocked.length?` (고정 수업이 ${blocked.join('·')}교시를 막고 있어요)`:''}`); return false;}
      return true;
    });
    for(const lv of levels){
      if(!capOK(lv)) continue;
      const taken={},dayHas=[];
      for(const s of SPEC) taken[s]=new Set();
      for(let c=0;c<NC;c++){dayHas.push({});for(const s of SPEC)dayHas[c][s]=[0,0,0,0,0];
        for(const k of occ[c]){const s=S.fixed[c][k].s;if(SPEC.includes(s)){taken[s].add(k);dayHas[c][s][DP(k)[0]]++}}}
      const groups=[];
      for(let c=0;c<NC;c++)for(const s of SPEC)if(need[c][s]>0)groups.push({c,s,n:need[c][s],keys:[]});
      const used=[...Array(NC)].map(()=>new Set());
      let nodes=0;const LIMIT=150000;
      const cands=g=>{
        const last=g.keys.length?g.keys[g.keys.length-1]:-1,out=[];
        for(const k of keys){
          if(k<=last) continue;
          const[d,p]=DP(k);
          if(!okAt(g.s,d,p,lv)) continue;
          if(occ[g.c].has(k)||used[g.c].has(k)||taken[g.s].has(k)) continue;
          if(dayHas[g.c][g.s][d]>0) continue;
          out.push(k);
        }
        return out;
      };
      const dfs=()=>{
        if(++nodes>LIMIT) return false;
        let best=null,bc=null;
        for(const g of groups){ if(g.keys.length>=g.n) continue;
          const cs=cands(g); const rem=g.n-g.keys.length;
          if(cs.length<rem) return false;
          if(!best||cs.length-rem<bc.length-(best.n-best.keys.length)){best=g;bc=cs}
        }
        if(!best) return true;
        shuffle(bc,rng);
        bc.sort((a,b)=>{const[da,pa]=DP(a),[db_,pb]=DP(b);const A=S.avail[best.s][da][pa]===1,B=S.avail[best.s][db_][pb]===1;return A===B?0:A?-1:1});
        for(const k of bc){
          const d=DP(k)[0];
          best.keys.push(k);taken[best.s].add(k);used[best.c].add(k);dayHas[best.c][best.s][d]++;
          if(dfs()) return true;
          best.keys.pop();taken[best.s].delete(k);used[best.c].delete(k);dayHas[best.c][best.s][d]--;
          if(nodes>LIMIT) return false;
        }
        return false;
      };
      if(dfs()){
        for(const g of groups) for(const k of g.keys) auto[g.c][k]=g.s;
        specDone=lv;break;
      }
    }
    if(specDone){
      if(specDone.exc){
        const ex=[];for(let c=0;c<NC;c++)for(const k in auto[c]){const[d,p]=DP(+k);if(S.avail[auto[c][k]][d][p]===2)ex.push(`${auto[c][k]} ${DAYS[d]}${p+1}교시(${c+1}반)`)}
        msgs.push({t:'warn',m:`가능 시간만으로는 안 돼서 예외 칸을 썼어요: ${ex.join(', ')||'없음'}`});
      } else msgs.push({t:'ok',m:`전담 과목(${SPEC.join('·')})을 가능 시간 안에서 겹치지 않게 배치했어요.`});
    } else {
      const taken={};for(const s of SPEC)taken[s]=new Set();
      for(let c=0;c<NC;c++)for(const k of occ[c]){const s=S.fixed[c][k].s;if(SPEC.includes(s))taken[s].add(k)}
      const miss=[];
      for(const s of SPEC)for(let c=0;c<NC;c++)for(let i=0;i<need[c][s];i++){
        const k=keys.find(k=>{const[d,p]=DP(k);if(!(S.avail[s][d][p]>0&&!occ[c].has(k)&&!auto[c][k]&&!taken[s].has(k)))return false;
          for(let q=0;q<NP;q++){const kk=K(d,q);if(auto[c][kk]===s||(S.fixed[c][kk]&&S.fixed[c][kk].s===s))return false}return true});
        if(k==null){miss.push(`${c+1}반 ${s}`);continue}
        auto[c][k]=s;taken[s].add(k);
      }
      msgs.push({t:'err',m:`전담 시간이 부족해서 다 넣지 못했어요: ${miss.join(', ')||'없음'}. ${capMsg.length?[...new Set(capMsg)].join(' / ')+'. ':''}예외 칸을 열거나 고정 수업을 옮겨 보세요.`});
    }
  }

  // ---- 일반 과목 (반별)
  for(let c=0;c<NC;c++){
    const freeSet=new Set(keys.filter(k=>!occ[c].has(k)&&!auto[c][k]));
    const left={};
    for(const bs of BLOCK){
      let bn=Math.max(0,need[c][bs]);
      const isB=k=>{const f=S.fixed[c][k];return (f&&f.s===bs)||auto[c][k]===bs};
      for(const k of Object.keys(S.fixed[c]).map(Number)){
        if(bn<=0) break;
        if(!isValid(k)||S.fixed[c][k].s!==bs) continue;
        const[d,p]=DP(k);
        if((p>0&&isB(K(d,p-1)))||(p+1<S.periods[d]&&isB(K(d,p+1)))) continue;
        const opts=[p+1<S.periods[d]?K(d,p+1):null,p>0?K(d,p-1):null].filter(x=>x!=null&&freeSet.has(x));
        if(opts.length){auto[c][opts[0]]=bs;freeSet.delete(opts[0]);bn--}
      }
      const pairsOn=d=>{const out=[];for(let p=0;p+1<S.periods[d];p++){const a=K(d,p),b=K(d,p+1);if(freeSet.has(a)&&freeSet.has(b))out.push([a,b])}return out};
      while(bn>=2){
        const bDays=new Set(keys.filter(isB).map(k=>DP(k)[0]));
        let cand=[];for(let d=0;d<5;d++)if(!bDays.has(d))cand.push(...pairsOn(d));
        if(!cand.length)for(let d=0;d<5;d++)cand.push(...pairsOn(d));
        if(!cand.length)break;
        const[a,b]=cand[Math.floor(rng()*cand.length)];
        auto[c][a]=auto[c][b]=bs;freeSet.delete(a);freeSet.delete(b);bn-=2;
      }
      if(bn>=2) msgs.push({t:'err',m:`${c+1}반: ${bs} 블록(2연속)을 넣을 빈 칸이 없어서 떨어진 칸에 넣었어요. 고정 수업을 조금 옮겨 주세요.`});
      else if(bn===1) msgs.push({t:'warn',m:`${c+1}반: ${bs} 시수가 홀수라 1시간은 블록 없이 들어가요.`});
      left[bs]=bn;
    }
    const free=[...freeSet];
    const tokens=[];
    for(const bs of BLOCK) for(let i=0;i<left[bs];i++) tokens.push(bs);
    const order=SUBJ.filter(s=>!SPEC.includes(s)&&!BLOCK.includes(s)).sort((a,b)=>need[c][b]-need[c][a]);
    for(const s of order) for(let i=0;i<need[c][s];i++) tokens.push(s);
    const over=SUBJ.filter(s=>need[c][s]<0);
    if(over.length) msgs.push({t:'err',m:`${c+1}반: 고정한 칸이 시수보다 많아요 (${over.map(s=>`${s} ${-need[c][s]}칸 초과`).join(', ')})`});
    if(tokens.length>free.length){
      const drop=tokens.splice(free.length);
      msgs.push({t:'err',m:`${c+1}반: 칸이 모자라 못 넣은 수업이 있어요 (${drop.join(', ')})`});
    } else if(tokens.length<free.length){
      msgs.push({t:'warn',m:`${c+1}반: 시수보다 칸이 ${free.length-tokens.length}개 많아서 빈칸이 남아요.`});
    }
    const grid={};
    const get=k=>{const f=S.fixed[c][k];if(f)return f.s||f.l;return grid[k]||auto[c][k]||null};
    const empty=new Set(free);
    for(const s of tokens){
      let best=[],bv=Infinity;
      for(const k of empty){
        const d=DP(k)[0],b=dayPenalty(get,d);grid[k]=s;const a=dayPenalty(get,d);delete grid[k];
        const v=a-b;
        if(v<bv-1e-9){bv=v;best=[k]}else if(Math.abs(v-bv)<1e-9)best.push(k);
      }
      const k=best[Math.floor(rng()*best.length)];grid[k]=s;empty.delete(k);
    }
    const mov=free.slice();
    for(let it=0;it<3000&&mov.length>1;it++){
      const i=mov[Math.floor(rng()*mov.length)],j=mov[Math.floor(rng()*mov.length)];
      if(i===j||grid[i]===grid[j]) continue;
      const di=DP(i)[0],dj=DP(j)[0];
      const before=dayPenalty(get,di)+(di!==dj?dayPenalty(get,dj):0);
      [grid[i],grid[j]]=[grid[j],grid[i]];
      const after=dayPenalty(get,di)+(di!==dj?dayPenalty(get,dj):0);
      if(after>before||(after===before&&rng()<.5)) [grid[i],grid[j]]=[grid[j],grid[i]];
    }
    for(const k in grid) if(grid[k]) auto[c][k]=grid[k];
  }
  for(let c=NC;c<S.auto.length;c++) auto.push(S.auto[c]);
  if(!msgs.some(m=>m.t==='err'||m.t==='warn')) msgs.push({t:'ok',m:'모든 반을 시수에 맞게 배치했어요. 마음에 안 들면 "다른 안 보기"를 눌러 보세요.'});
  S.auto=auto;S.report=msgs;save();render();
}

/* ---------------- validation ---------------- */
function check(){
  const keys=validKeys();
  const counts=[],empties=[];
  const tmap={};for(const s of SPEC)tmap[s]={};
  for(let c=0;c<NC;c++){
    const n={};let e=0;
    for(const k of keys){const v=cell(c,k);if(!v){e++;continue}
      if(v.subj) n[v.subj]=(n[v.subj]||0)+1;
      if(SPEC.includes(v.subj))(tmap[v.subj][k]=tmap[v.subj][k]||[]).push(c+1);
    }
    counts.push(n);empties.push(e);
  }
  const issues=[];const badCells=new Set();
  for(const s of SPEC){
    for(const k in tmap[s]){
      const cl=tmap[s][k],[d,p]=DP(+k),a=S.avail[s][d][p];
      if(cl.length>1){issues.push({t:'err',m:`${s} 겹침: ${DAYS[d]}${p+1}교시에 ${cl.join('·')}반`});cl.forEach(c=>badCells.add(`${c-1}-${k}`))}
      if(a===0){issues.push({t:'err',m:`${s} 불가 시간: ${DAYS[d]}${p+1}교시 (${cl.join('·')}반)`});cl.forEach(c=>badCells.add(`${c-1}-${k}`))}
      else if(a===2) issues.push({t:'warn',m:`${s} 예외 시간 사용: ${DAYS[d]}${p+1}교시 (${cl.join('·')}반) — 선생님께 양해 필요`});
    }
  }
  for(let c=0;c<NC;c++)for(let d=0;d<5;d++){
    for(const s of SPEC){
      const ks=[];for(let p=0;p<S.periods[d];p++){const v=cell(c,K(d,p));if(v&&v.subj===s)ks.push(K(d,p))}
      if(ks.length>1){issues.push({t:'err',m:`${c+1}반 ${DAYS[d]}요일에 ${s}가 ${ks.length}시간 있어요 (전담은 하루 1시간까지)`});ks.forEach(k=>badCells.add(`${c}-${k}`))}
    }
    for(let p=0;p<S.periods[d];p++){
      const v=cell(c,K(d,p));if(!v||!BLOCK.includes(v.subj))continue;
      const up=p>0&&cell(c,K(d,p-1))?.subj===v.subj,dn=p+1<S.periods[d]&&cell(c,K(d,p+1))?.subj===v.subj;
      if(!up&&!dn){issues.push({t:'warn',m:`${c+1}반 ${DAYS[d]}${p+1}교시 ${v.subj}가 블록 없이 떨어져 있어요`});badCells.add(`${c}-${K(d,p)}`)}
    }
  }
  return {counts,empties,tmap,issues,badCells};
}

/* ---------------- render ---------------- */
function renderGrades(){
  $('grades').innerHTML=GRADES.map(g=>`<button class="gt" data-g="${g}" aria-pressed="${g===G}">${g}학년</button>`).join('');
  $('title').textContent=`${G}학년 시간표 자동 배치`;
  document.title=`${G}학년 시간표 자동 배치`;
}
function renderCfg(){
  $('nc').value=NC;
  $('subjChips').innerHTML=SUBJ.map(s=>`<span class="chip" style="--h:${HUE[s]}">${esc(s)}<button data-rm="${esc(s)}" aria-label="${esc(s)} 빼기">×</button></span>`).join('');
  $('specOpts').innerHTML=SUBJ.map(s=>`<label><input type="checkbox" data-spec="${esc(s)}" ${SPEC.includes(s)?'checked':''}>${esc(s)}</label>`).join('');
  $('blockOpts').innerHTML=SUBJ.filter(s=>!SPEC.includes(s)).map(s=>`<label><input type="checkbox" data-block="${esc(s)}" ${BLOCK.includes(s)?'checked':''}>${esc(s)}</label>`).join('');
}
function renderSetup(){
  $('week').value=S.week||'';
  $('periods').innerHTML=DAYS.map((d,i)=>`<div><label for="per${i}">${d}</label><select id="per${i}" data-per="${i}">${[0,1,2,3,4,5,6].map(n=>`<option ${S.periods[i]===n?'selected':''}>${n}</option>`).join('')}</select></div>`).join('');
  $('hours').innerHTML=SUBJ.map(s=>`<div><label for="h-${esc(s)}" title="${esc(s)}">${esc(s)}</label><input type="number" min="0" max="20" id="h-${esc(s)}" data-hour="${esc(s)}" value="${S.target[s]||0}"></div>`).join('');
  $('cCount').innerHTML=`<option value="">시수 안 셈</option>`+SUBJ.map(s=>`<option>${esc(s)}</option>`).join('');
  renderCfg();renderPalette();
}
function renderTotal(){
  const tot=SUBJ.reduce((a,s)=>a+(+S.target[s]||0),0), slots=S.periods.reduce((a,b)=>a+b,0);
  $('total').innerHTML=`시수 합계 <b class="${tot===slots?'good':'bad'}">${tot}</b> / 이번 주 칸 <b>${slots}</b>${tot!==slots?' — 서로 다르면 빈칸이 남거나 못 넣는 수업이 생겨요':''}`;
}
function renderPalette(){
  if(brush.type==='subj'&&!SUBJ.includes(brush.s)) brush={type:'subj',s:SUBJ[0],l:''};
  $('palette').innerHTML=SUBJ.map(s=>`<button class="pb" style="--h:${HUE[s]}" data-brush="${esc(s)}" aria-pressed="${brush.type==='subj'&&brush.s===s}">${esc(s)}</button>`).join('')
    +(brush.type==='custom'?`<button class="pb" style="--h:0;--sat:0%" aria-pressed="true">${esc(brush.l)}${brush.s?`→${esc(brush.s)}`:''}</button>`:'')
    +`<button class="pb erase" data-brush="__erase" aria-pressed="${brush.type==='erase'}">지우개</button>`;
}
function renderTeachers(chk){
  $('tlegend').style.display=SPEC.length?'':'none';
  if(!SPEC.length){$('teachers').innerHTML='<p class="hint" style="margin:0">학년 설정에서 전담 과목을 고르면 여기에 선생님 가능 시간이 나와요.</p>';return}
  $('teachers').innerHTML=SPEC.map(s=>{
    let h=`<div class="tname"><b style="font-size:13px">${esc(s)}</b><input type="text" data-tname="${esc(s)}" value="${esc(S.teachers[s]||'')}" placeholder="선생님 이름" aria-label="${esc(s)} 선생님"></div><div class="tgrid"><span></span>${DAYS.map(d=>`<span class="h">${d}</span>`).join('')}`;
    for(let p=0;p<NP;p++){
      h+=`<span class="h" style="align-self:center">${p+1}</span>`;
      for(let d=0;d<5;d++){
        const k=K(d,p),a=S.avail[s][d][p],cl=chk.tmap[s][k]||[],na=p>=S.periods[d];
        const dup=cl.length>1||(a===0&&cl.length);
        h+=`<button class="tc a${a}${dup?' dup':''}${na?' na':''}" style="--h:${HUE[s]}" data-av="${esc(s)}" data-k="${k}" title="${DAYS[d]} ${p+1}교시">${cl.join('·')}</button>`;
      }
    }
    return h+'</div>';
  }).join('');
}
function renderBoard(chk){
  let h='';
  for(let c=0;c<NC;c++){
    const bad=SUBJ.filter(s=>(chk.counts[c][s]||0)!==(S.target[s]||0)).length+(chk.empties[c]?1:0);
    h+=`<div class="cls"><div class="cls-h"><b>${c+1}반</b><span class="${bad?'bad':'good'}">${bad?`확인 필요`:'시수 맞음'}</span></div>
      <table class="tt"><thead><tr><th class="p"></th>${DAYS.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>`;
    for(let p=0;p<NP;p++){
      h+=`<tr><th class="p">${p+1}</th>`;
      for(let d=0;d<5;d++){
        const k=K(d,p);
        if(p>=S.periods[d]){h+=`<td class="off"></td>`;continue}
        const v=cell(c,k);
        const bc=chk.badCells.has(`${c}-${k}`)?' bad':'';
        if(!v) h+=`<td data-c="${c}" data-k="${k}" class="${bc}"></td>`;
        else{
          const hue=v.subj?HUE[v.subj]??0:0;
          const cls=`s${v.fixed?' fx':''}${(!v.subj||!(v.subj in HUE))?' cu':''}`;
          const title=v.fixed?`고정${v.subj&&v.label!==v.subj?` (${v.subj} 시수)`:''}`:'자동';
          h+=`<td data-c="${c}" data-k="${k}" class="${bc}" title="${esc(v.label)} · ${esc(title)}"><span class="${cls}" style="--h:${hue}">${esc(v.label)}</span></td>`;
        }
      }
      h+='</tr>';
    }
    h+='</tbody></table></div>';
  }
  $('classes').innerHTML=h;
}
function renderChecks(chk){
  const cols=SUBJ.filter(s=>(S.target[s]||0)>0||chk.counts.some(n=>n[s]));
  let h=`<thead><tr><th>반</th>${cols.map(s=>`<th>${esc(s)}</th>`).join('')}<th>빈칸</th></tr><tr><th>실시</th>${cols.map(s=>`<th>${S.target[s]||0}</th>`).join('')}<th>0</th></tr></thead><tbody>`;
  for(let c=0;c<NC;c++){
    h+=`<tr><th>${c+1}반</th>`+cols.map(s=>{const g=chk.counts[c][s]||0,t=S.target[s]||0;return `<td class="${g!==t?'bad':''}">${g}</td>`}).join('')
      +`<td class="${chk.empties[c]?'bad':''}">${chk.empties[c]}</td></tr>`;
  }
  $('cnt').innerHTML=h+'</tbody>';
  const okMsg=[SPEC.length?'전담 겹침·불가 시간·하루 1시간':'',BLOCK.length?'블록 수업':''].filter(Boolean).join('·');
  const list=chk.issues.length?chk.issues:[{t:'ok',m:okMsg?`${okMsg} 모두 문제없어요.`:'점검할 문제가 없어요.'}];
  $('issues').innerHTML=list.map(i=>`<li class="${i.t==='err'?'err':''}">${esc(i.m)}</li>`).join('');
}
function renderReport(){
  const r=S.report;
  if(!r){$('report').innerHTML='<span>고정 수업을 찍은 뒤 <b>자동 배치</b>를 누르세요.</span>';return}
  $('report').innerHTML=r.map(x=>`<div class="${x.t==='err'?'err':x.t==='ok'?'ok':''}">${esc(x.m)}</div>`).join('');
}
function render(){const chk=check();renderTotal();renderTeachers(chk);renderBoard(chk);renderChecks(chk);renderReport();renderPalette()}
function renderAll(){renderGrades();renderSetup();render()}

/* ---------------- events ---------------- */
function cfgChanged(){ensureShape();save();renderSetup();render()}
$('grades').addEventListener('click',e=>{const b=e.target.closest('[data-g]');if(b)switchGrade(+b.dataset.g)});
$('nc').addEventListener('change',e=>{S.cfg.nc=e.target.value;cfgChanged()});
$('subjChips').addEventListener('click',async e=>{
  const b=e.target.closest('[data-rm]');if(!b)return;const s=b.dataset.rm;
  if(!await ask(`${s} 과목을 뺄까요?`,`과목 목록과 시수에서 빠져요. 이미 찍어 둔 ${esc(s)} 칸은 남아 있지만 시수로 세지 않아요.`,'빼기'))return;
  S.cfg.subj=S.cfg.subj.filter(x=>x!==s);delete S.target[s];cfgChanged();
});
function addSubj(){
  const v=$('newSubj').value.trim().slice(0,16);if(!v){$('newSubj').focus();return}
  if(['__proto__','constructor','prototype'].includes(v)||S.cfg.subj.length>=40){say('이 과목 이름을 사용할 수 없거나 과목 수가 너무 많아요.',true);return}
  if(S.cfg.subj.includes(v)){say(`${v}은(는) 이미 있어요.`,true);return}
  S.cfg.subj.push(v);$('newSubj').value='';cfgChanged();
}
$('addSubj').addEventListener('click',addSubj);
$('newSubj').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addSubj()}});
$('specOpts').addEventListener('change',e=>{const s=e.target.dataset.spec;if(s==null)return;
  S.cfg.spec=e.target.checked?[...S.cfg.spec,s]:S.cfg.spec.filter(x=>x!==s);cfgChanged()});
$('blockOpts').addEventListener('change',e=>{const s=e.target.dataset.block;if(s==null)return;
  S.cfg.block=e.target.checked?[...S.cfg.block,s]:S.cfg.block.filter(x=>x!==s);cfgChanged()});
$('presetBtn').addEventListener('click',async()=>{
  const p=preset(G);
  if(!await ask(`${G}학년 기본 과목으로 되돌릴까요?`,`과목: ${p.subj.join(', ')}<br>전담: ${p.spec.join(', ')||'없음'} · 블록: ${p.block.join(', ')||'없음'}<br>반 수와 찍어 둔 칸은 그대로예요.`,'되돌리기'))return;
  S.cfg.subj=[...p.subj];S.cfg.spec=[...p.spec];S.cfg.block=[...p.block];cfgChanged();
});
$('week').addEventListener('input',e=>{S.week=e.target.value.slice(0,80);save()});
$('periods').addEventListener('change',e=>{const i=e.target.dataset.per;if(i==null)return;S.periods[+i]=+e.target.value;save();render()});
$('hours').addEventListener('input',e=>{const s=e.target.dataset.hour;if(!s)return;S.target[s]=Math.min(30,Math.max(0,parseInt(e.target.value)||0));save();render()});
$('teachers').addEventListener('click',e=>{
  const b=e.target.closest('[data-av]');if(!b||b.classList.contains('na'))return;
  const s=b.dataset.av,[d,p]=DP(+b.dataset.k),a=S.avail[s][d][p];
  S.avail[s][d][p]=a===1?0:a===0?2:1;save();render();
});
$('teachers').addEventListener('input',e=>{const s=e.target.dataset.tname;if(s){S.teachers[s]=e.target.value.slice(0,40);save()}});
$('palette').addEventListener('click',e=>{
  const b=e.target.closest('[data-brush]');if(!b)return;
  brush=b.dataset.brush==='__erase'?{type:'erase'}:{type:'subj',s:b.dataset.brush,l:''};renderPalette();
});
$('cUse').addEventListener('click',()=>{
  const l=$('cLabel').value.trim();if(!l){$('cLabel').focus();return}
  brush={type:'custom',l,s:$('cCount').value};renderPalette();
});
function paint(c,k){
  const targets=$('allCls').checked?[...Array(NC).keys()]:[c];
  for(const t of targets){
    if(brush.type==='erase'){delete S.fixed[t][k];delete S.auto[t][k]}
    else{S.fixed[t][k]=brush.type==='subj'?{s:brush.s}:{s:brush.s,l:brush.l};delete S.auto[t][k]}
  }
}
let painting=false,painted=new Set();
$('classes').addEventListener('pointerdown',e=>{
  const td=e.target.closest('td[data-k]');if(!td)return;
  e.preventDefault();painting=true;painted=new Set();
  const id=td.dataset.c+'-'+td.dataset.k;painted.add(id);paint(+td.dataset.c,+td.dataset.k);render();
});
$('classes').addEventListener('pointerover',e=>{
  if(!painting)return;const td=e.target.closest('td[data-k]');if(!td)return;
  const id=td.dataset.c+'-'+td.dataset.k;if(painted.has(id))return;painted.add(id);paint(+td.dataset.c,+td.dataset.k);render();
});
window.addEventListener('pointerup',()=>{if(painting){painting=false;save()}});

function ask(title,body,yes){
  return new Promise(res=>{
    const d=$('dlgAsk');$('askTitle').textContent=title;$('askBody').innerHTML=body;$('askYes').textContent=yes||'지우기';
    const done=v=>{d.close();$('askYes').onclick=$('askNo').onclick=d.oncancel=null;res(v)};
    $('askYes').onclick=()=>done(true);$('askNo').onclick=()=>done(false);d.oncancel=e=>{e.preventDefault();done(false)};
    try{d.showModal()}catch(e){d.setAttribute('open','')}
    $('askNo').focus();
  });
}
$('solve').addEventListener('click',solve);
$('again').addEventListener('click',()=>{S.seed++;solve()});
$('clearAuto').addEventListener('click',()=>{S.auto=[...Array(NC)].map(()=>({}));S.report=null;save();render()});
$('clearFixed').addEventListener('click',async()=>{if(!await ask('고정 칸을 모두 지울까요?',`찍어 둔 고정 수업이 ${G}학년 모든 반에서 지워져요.`))return;S.fixed=[...Array(NC)].map(()=>({}));S.report=null;save();render()});
$('resetAll').addEventListener('click',async()=>{
  if(!await ask(`${G}학년 새 주를 시작할까요?`,'<b>지워지는 것</b>: 주차 이름, 요일별 교시(기본값으로), 실시 시수, 고정 칸, 자동 칸<br><b>그대로 두는 것</b>: 학년 설정(반 수·과목), 전담 가능 시간, 전담 선생님 이름','초기화'))return;
  const d=defState(G);
  S.week='';S.periods=d.periods;
  SUBJ.forEach(x=>S.target[x]=0);
  S.fixed=[];S.auto=[];S.report=null;S.seed=1;
  ensureShape();save();renderSetup();render();
  say('초기화했어요. 새 주차 이름, 교시, 시수, 고정 수업을 입력하세요.');
  $('week').focus();
});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));

/* ---------------- export ---------------- */
function layoutRows(){
  const out=[];const txt=(c,k)=>{if(!isValid(k))return '';const v=cell(c,k);return v?v.label:''};
  const nb=Math.ceil(NC/2);
  for(let b=0;b<nb;b++){
    const c1=b*2,c2=b*2+1,has2=c2<NC;
    out.push([`${c1+1}반`,...DAYS,'',has2?`${c2+1}반`:'',...(has2?DAYS:['','','','',''])]);
    for(let p=0;p<NP;p++){
      out.push([p+1,...DAYS.map((_,d)=>txt(c1,K(d,p))),'',has2?p+1:'',...DAYS.map((_,d)=>has2?txt(c2,K(d,p)):'')]);
    }
    if(b<nb-1) out.push(Array(13).fill(''));
  }
  return out;
}
$('copyBtn').addEventListener('click',async()=>{
  const tsv=tsvRows(layoutRows());
  $('copyText').value=tsv;
  let ok=false;try{await navigator.clipboard.writeText(tsv);ok=true}catch(e){}
  $('copyHint').textContent=ok?'복사됐어요. 엑셀 시트의 A3 칸을 누르고 붙여넣으세요.':'자동 복사가 막혀 있어요. 아래 내용을 모두 선택(Ctrl+A)해서 복사한 뒤 엑셀 A3 칸에 붙여넣으세요.';
  $('dlgCopy').showModal();if(!ok){$('copyText').focus();$('copyText').select()}
});
$('xlsxBtn').addEventListener('click',()=>{
  const btn=$('xlsxBtn');if(btn.disabled)return;btn.disabled=true;
  try{
    const buf=buildXlsx();
    const fname=`${G}학년_${(S.week||'시간표').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').slice(0,80)}_시간표.xlsx`;
    const url=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const a=document.createElement('a');a.href=url;a.download=fname;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);say('엑셀 파일을 저장했어요. 다운로드 폴더를 확인해 주세요.');
  }catch{say('엑셀 파일을 만들지 못했어요. 엑셀 붙여넣기용 복사를 이용해 주세요.',true)}
  finally{btn.disabled=false}
});
function buildXlsx(){
  const chk=check();
  const sheets=[{name:'시간표',rows:[[`${G}학년 ${S.week||''} 학급별 시간표`],[],...layoutRows()]},
    {name:'시수점검',rows:[['반',...SUBJ,'빈칸'],['실시',...SUBJ.map(s=>S.target[s]||0),0],...chk.counts.map((n,c)=>[`${c+1}반`,...SUBJ.map(s=>n[s]||0),chk.empties[c]])]}];
  if(SPEC.length){
    const rows=[];
    for(const s of SPEC){rows.push([`${s} (${S.teachers[s]||''})`,...DAYS]);
      for(let p=0;p<NP;p++)rows.push([p+1,...DAYS.map((_,d)=>{const cl=chk.tmap[s][K(d,p)];return cl?cl.map(x=>x+'반').join(','):''})]);rows.push([])}
    sheets.push({name:'전담시간표',rows});
  }
  return workbookBytes(sheets);
}
function say(m,err){
  $('report').textContent=m;
  const t=$('toast');t.textContent=m;t.className='toast on'+(err?' err':'');
  clearTimeout(say._t);say._t=setTimeout(()=>t.className='toast',err?12000:8000);
}

$('cfgBox').open=!hasContent(S);
renderAll();
$('sync').textContent='이 컴퓨터 브라우저에만 저장돼요';
