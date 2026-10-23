import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

// 牛角门·线：故事线（主线 / 小主线 / 支线）+ 随机事件 + 一键生成剧情走向
const VER = '0.2';
const MOD = 'niujiaomen_xian';
const KINDS = ['主线','小主线','支线'];
const BLK_TAG = '(?:xian|线|故事线)';

function settings(){
  const s = extension_settings[MOD] = extension_settings[MOD] || {};
  if(s.enabled===undefined) s.enabled=true;
  if(s.inject===undefined) s.inject=true;          // 注入故事线状态
  if(s.askBlock===undefined) s.askBlock=true;      // 要求模型每楼末尾输出 <xian> 块
  if(s.evEvery===undefined) s.evEvery=0;           // 每 N 楼一个随机事件，0=关
  if(s.evPref===undefined) s.evPref='';
  if(s.genCount===undefined) s.genCount=10;
  if(s.genKind===undefined) s.genKind='混合';
  if(s.genForm===undefined) s.genForm='单步';
  if(s.genPref===undefined) s.genPref='';
  if(s.genCtx===undefined) s.genCtx=6;             // 生成走向时带最近几楼正文
  if(s.hideOrb===undefined) s.hideOrb=false;
  if(s.night===undefined) s.night=false;
  if(s.favs===undefined) s.favs=[];                // 收藏跨聊天共用
  return s;
}
function saveS(){ saveSettingsDebounced(); }
function meta(){
  const ctx=getContext(); const mm=ctx.chatMetadata??ctx.chat_metadata; if(!mm) return null;
  const st = mm[MOD] = mm[MOD] || {};
  st.lines = st.lines||[]; st.nextId = st.nextId||1;
  st.events = st.events||[]; st.cands = st.cands||[];
  st.evLast = st.evLast||0; st.evForce = !!st.evForce;
  st.pendingDir = st.pendingDir||'';
  st.fb = st.fb||{cur:null,log:[],pending:false,peek:false};  // v0.2 副本：底稿玩家不可见
  return st;
}
function saveMeta(){ try{ const c=getContext(); (c.saveMetadataDebounced||c.saveMetadata||function(){})(); }catch(_){} }
function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function isAiMsg(m){ return !!(m && !m.is_user && !(m.is_system && (m.name==='System' || (m.extra && m.extra.type)))); }
function curTurn(){ try{ const chat=getContext().chat||[]; let n=0; for(const m of chat){ if(isAiMsg(m)) n++; } return n; }catch(e){ return 0; } }
function lastAiMsg(){ const chat=getContext().chat||[]; for(let i=chat.length-1;i>=0;i--){ const m=chat[i]; if(isAiMsg(m)) return {m,i}; } return null; }
function lineById(st,id){ id=parseInt(String(id).replace(/[^0-9]/g,''),10); return st.lines.find(l=>l.id===id); }
function findLine(st,q){ const byId=lineById(st,q); if(byId) return byId; q=String(q||'').trim(); if(!q) return null; return st.lines.find(l=>l.status==='进行中' && (l.title===q || q.indexOf(l.title)>=0 || l.title.indexOf(q)>=0)); }
function addLine(st,kind,title,desc,src){ title=String(title||'').trim().replace(/^[「『【"']+|[」』】"']+$/g,''); if(!title) return null; if(st.lines.some(l=>l.title===title)) return null; if(KINDS.indexOf(kind)<0) kind='支线'; const l={id:st.nextId++,kind,title,desc:String(desc||'').trim(),status:'进行中',turn:curTurn(),nodes:[],src:src||''}; st.lines.push(l); return l; }
function addNode(l,text){ text=String(text||'').trim(); if(!text) return false; const t=curTurn(); if(l.nodes.some(n=>n.turn===t && n.text===text)) return false; l.nodes.push({turn:t,text}); if(l.nodes.length>30) l.nodes=l.nodes.slice(-30); return true; }

// ---------- 注入 ----------
function buildInjection(){
  const s=settings(), st=meta(); if(!st) return '';
  const act=st.lines.filter(l=>l.status==='进行中');
  const out=[];
  out.push('【故事线状态】（由「线」插件维护，只供叙事参考，不要在正文里提到"故事线""插件"）');
  if(!act.length) out.push('（暂无登记的故事线）');
  for(const k of KINDS){
    const ls=act.filter(l=>l.kind===k); if(!ls.length) continue;
    for(const l of ls){
      const last=l.nodes.length?l.nodes[l.nodes.length-1].text:'';
      out.push('·'+k+'#'+l.id+'「'+l.title+'」'+(l.desc?'：'+l.desc:'')+(last?'　最近进展：'+last:''));
    }
  }
  const done=st.lines.filter(l=>l.status==='完成').slice(-4);
  if(done.length) out.push('已完结：'+done.map(l=>l.kind+'「'+l.title+'」').join('，'));
  out.push('主线是贯穿全局的大方向，推进要慢；小主线是当前阶段的目标，几楼到十几楼内有结果；支线是旁枝，可快可慢。各线按剧情自然推进，不要为了推进而强行安排。');
  if(st.pendingDir){ out.push('【本楼走向·必须执行】'+st.pendingDir); }
  try{ const fbi=fbInjection(st); if(fbi) out.push(fbi); }catch(e){ console.error('[线] 副本注入失败',e); }
  if(st.evForce || (s.evEvery>0 && (curTurn()-st.evLast)>=s.evEvery)){
    out.push('【随机事件·本楼必须发生】在本楼正文里自然引入一个此前没有铺垫过的意外事件（可大可小：来人、来电、天气、身体、物件、旧事浮出、第三方介入等），要贴合当前场景和故事线，不得生硬。'+(s.evPref?'事件倾向：'+s.evPref+'。':'')+'事件要在本楼正文中实际发生，不是预告。');
  }
  if(s.askBlock){
    out.push('【输出要求】正文写完后，在最末尾另起一行输出下面的数据块（不放进思维链；没有变化就只输出 <xian>无</xian>）：');
    out.push('<xian>\n进展|线编号或标题|一句话写这一楼该线推进了什么（只写确实推进了的线，可多行）\n完成|线编号或标题\n新线|主线或小主线或支线|标题|一句话描述（只在剧情里确实冒出了新的目标或旁枝时写，不要凭空造）\n事件|标题|一句话描述（只在本楼发生了随机事件时写）\n</xian>');
  }
  return out.join('\n');
}
function onPromptReady(ev){
  try{
    const s=settings(); if(!s.enabled||!s.inject) return;
    if(!ev||ev.dryRun||!Array.isArray(ev.chat)) return;
    const val=buildInjection(); if(!val) return;
    ev.chat.push({role:'system',content:val});
  }catch(e){ console.error('[线] 注入失败',e); }
}

// ---------- 副本（底稿玩家不可见） ----------
const FB_TAG='(?:fuben|副本底稿|底稿)';
const FB_AXES=['来源','逻辑','态度','语言','节奏','恐惧'];
function fbExtract(text){
  text=String(text||''); if(!text) return null;
  const masked=text.replace(/<(thinking|think|thought)>[\s\S]*?<\/\1>/gi,x=>' '.repeat(x.length));
  const openRe=new RegExp('<'+FB_TAG+'>','gi'); let last=null,mm; while((mm=openRe.exec(masked))!==null) last=mm; if(!last) return null;
  const bodyStart=last.index+last[0].length; const after=masked.slice(bodyStart);
  const cm=after.match(new RegExp('<\\/'+FB_TAG+'>\\s*','i')); if(!cm) return null;
  return { memo:text.slice(bodyStart,bodyStart+cm.index), start:last.index, end:bodyStart+cm.index+cm[0].length };
}
function fbParse(memo){
  const fb={name:'',type:'',goal:'',story:'',rules:[],role:'',suspect:'',boss:{},minis:[],people:[],raw:String(memo||'').trim(),turn:curTurn()};
  let cur=null;
  for(let l of fb.raw.split('\n')){
    const t=l.replace(/｜/g,'|').trim(); if(!t) continue;
    const m=t.match(/^([^|：:]{1,6})\s*[|：:]\s*(.*)$/);
    const key=m?m[1].trim():''; const val=m?m[2].trim():'';
    if(key==='副本'){ const p=val.split('|').map(x=>x.trim()); fb.name=p[0]||''; fb.type=p[1]||''; fb.goal=p.slice(2).join('|'); cur=null; }
    else if(key==='故事'){ fb.story=val; cur='story'; }
    else if(key==='规则'){ if(val) fb.rules.push(val); cur=null; }
    else if(key==='扮演'){ fb.role=val; cur='role'; }
    else if(key==='怀疑'){ fb.suspect=val; cur=null; }
    else if(/^(boss|大boss|大BOSS|BOSS)$/i.test(key)){ fb.boss.name=val; cur=null; }
    else if(['长相','性格','欲望','拒绝','想要'].indexOf(key)>=0 || FB_AXES.indexOf(key)>=0){ fb.boss[key]=val; cur=null; }
    else if(/^小boss$/i.test(key)){ fb.minis.push(val); cur=null; }
    else if(key==='人物'||key==='玩家'||key==='NPC'){ fb.people.push(val); cur=null; }
    else if(cur==='story') fb.story+='\n'+t;
    else if(cur==='role') fb.role+='\n'+t;
  }
  if(!fb.name && !fb.boss.name) return null;
  return fb;
}
function fbBossLine(fb){ const b=fb.boss||{}; return (fb.name||'?')+'｜'+(b.name||'?')+'｜'+FB_AXES.map(a=>a+'：'+(b[a]||'—')).join('｜'); }
function fbInjection(st){
  const s=settings(); const fb=st.fb; const out=[];
  if(fb.pending){
    out.push('【本楼是进入新副本的第一楼·硬性】正文按角色卡写：玩家们被送进副本，左手手表的系统先介绍世界背景、本副本名字、玩家被分配的身份与性格背景、通关的大方向。手表介绍只给玩家"应该知道的"，不透露规则细节、大boss身份、故事真相。');
    out.push('正文写完后，在所有组件之后，另起一行输出副本底稿，包在 <fuben> 与 </fuben> 之间。底稿是你自己后面每楼都要照着写的设计稿，玩家看不见，正文里不得透露。格式每行一条，严格照下面的标签：');
    out.push('副本|名字|类型(剧情扮演/规则杀/混合)|通关条件\n故事|这个副本的完整故事：这里以前发生过什么、现在进行到哪一步、玩家进来的是故事的中段还是尾声、真相是什么、结局可能怎样（可多行，200-500字）\n规则|一条规则：内容、触发什么、玩家能从什么现象发现它（规则杀/混合类 2-3 行；剧情类 0-1 行）\n扮演|玩家被分配的身份、别人以为她是谁、哪些事会露馅（剧情类/混合类才写）\n怀疑|怀疑度从多少起、什么会涨、涨到多少发生什么（剧情类/混合类才写）\nboss|大boss名字\n长相|完整细节：身高体型、脸、眼睛、头发、皮肤、手、衣着、气味、最先被注意到的一处异常（80-150字）\n来源|它怎么变成这样的\n逻辑|它按什么规则行动、什么能让它停\n态度|它对玩家的态度：想留下／想让人替它做事／不在乎／想被认出来／怕／当成别人\n语言|说不说话、怎么说\n节奏|快而短／慢得受不了／间歇出现／一直在场但不动\n恐惧|本副本的主调：规则恐怖／身体恐怖／认知恐怖／社会恐怖／等待恐怖（只选一种）\n性格|三到五条具体的脾气与习惯，要能互相矛盾一处\n欲望|起点N(0-100)|阈值N|会让它涨的具体触发（不是"她好看"这种，是她做的事、拿的东西、某个时机；好看只决定起点）|降的条件\n拒绝|欲望不到阈值时它拒绝的理由，用它自己的话\n想要|它真正想要的东西（跟任务无关）\n小boss|名字|一句话\n人物|名字|一句话（本副本一起进来的其他玩家 4-7 人，各有任务与性格，会死会骗会结盟；以及重要 NPC）');
    const done=(fb.log||[]).slice(-6);
    if(done.length){ out.push('【已打过的副本与大boss·新的必须不同】\n'+done.map(x=>'·'+x.line).join('\n')+'\n新大boss在 来源/逻辑/态度/语言/节奏/恐惧 六轴里至少四轴与上面每一个不同；长相与性格不得相似。'); }
    out.push('禁止默认款：优雅、低语、嗤笑、歪头、舔嘴唇、慢慢靠近、在耳边说话、把人叫猎物、"有趣"、享受恐惧、笑着发疯。');
  }
  if(fb.cur){
    const f=fb.cur;
    out.push('【当前副本底稿·玩家不可见·每楼照此写】\n'+f.raw);
    out.push('执行：①玩家只知道手表介绍过的和她亲历的，别的她不知道，状态栏只写她已知的，规则没验证的写猜测、没碰到的写未知。②规则不由任何人直接说明，只通过现象和别人的下场暴露。③大boss严格按底稿的欲望起点/阈值/触发/拒绝理由行事，欲望不到阈值就是拒绝，拒绝要有它自己的理由；它的注意力在一群玩家之间分配，不默认盯着{{user}}。④其他玩家各有自己的任务与打算，会抢、会骗、会死，不围着{{user}}转。⑤故事按底稿的真相与阶段推进，玩家的行动能改变结局但不能改变已发生的事。⑥大boss和小boss说话做事要像底稿里那个人，不要变成通用恐怖片反派。');
  }
  return out.join('\n');
}
function fbHarvest(m,idx,st){
  const ctx=getContext();
  const ex=fbExtract(m.mes||''); if(!ex) return false;
  const fb=fbParse(ex.memo);
  m.extra=m.extra||{}; m.extra.xianFuben=ex.memo.trim();
  m.mes=((m.mes||'').slice(0,ex.start)+(m.mes||'').slice(ex.end)).trimEnd();
  try{ const sidx=(typeof m.swipe_id==='number')?m.swipe_id:0; if(Array.isArray(m.swipes)&&m.swipes[sidx]!=null) m.swipes[sidx]=m.mes; }catch(_){}
  try{ ctx.updateMessageBlock?.(idx,m); }catch(_){}
  if(!fb){ try{ toastr.warning('线：收到底稿但没解析出副本名/boss，原文在面板里'); }catch(_){} st.fb.cur={raw:ex.memo.trim(),name:'(未解析)',boss:{},rules:[],people:[],minis:[],turn:curTurn()}; }
  else st.fb.cur=fb;
  st.fb.pending=false; st.fb.peek=false;
  try{ toastr.info('线：副本底稿已收好（玩家不可见）'); }catch(_){}
  return true;
}
function fbEnd(st,how){
  const f=st.fb.cur; if(!f) return;
  st.fb.log=st.fb.log||[]; st.fb.log.push({name:f.name,type:f.type,boss:(f.boss&&f.boss.name)||'',line:fbBossLine(f),turn:curTurn(),how:how||'',raw:f.raw});
  if(st.fb.log.length>40) st.fb.log=st.fb.log.slice(-40);
  st.fb.cur=null; st.fb.pending=false;
}

// ---------- 收块 ----------
function extractBlock(text){
  text=String(text||''); if(!text) return null;
  const masked=text.replace(/<(thinking|think|thought)>[\s\S]*?<\/\1>/gi,x=>' '.repeat(x.length));
  const openRe=new RegExp('<'+BLK_TAG+'>|```\\s*(?:xian|故事线)[^\\n]*\\n','gi'); let last=null,mm;
  while((mm=openRe.exec(masked))!==null) last=mm;
  if(!last) return null;
  const isFence=last[0].startsWith('```');
  const bodyStart=last.index+last[0].length;
  const after=masked.slice(bodyStart);
  const cm=after.match(isFence?/```\s*/:new RegExp('<\\/'+BLK_TAG+'>\\s*','i'));
  const bodyLen=cm?cm.index:after.length;
  const end=cm?(bodyStart+cm.index+cm[0].length):text.length;
  if(!cm){ const tail=text.slice(bodyStart).replace(/\s/g,''); if(tail.length>800) return null; }
  return { memo:text.slice(bodyStart,bodyStart+bodyLen), start:last.index, end };
}
function applyBlock(st,memo){
  let ch=false; const t=curTurn();
  for(let l of String(memo||'').split('\n')){
    l=l.replace(/｜/g,'|').replace(/^[\s\d.、)）*_>\-]+/,'').trim(); if(!l||l==='无') continue;
    const p=l.split('|').map(x=>x.trim()); const k=p[0];
    if(/^进展/.test(k) && p[1]){ const ln=findLine(st,p[1]); if(ln && addNode(ln,p[2]||'')) ch=true; }
    else if(/^完成/.test(k) && p[1]){ const ln=findLine(st,p[1]); if(ln && ln.status==='进行中'){ ln.status='完成'; ln.doneTurn=t; ch=true; } }
    else if(/^新线/.test(k) && p[2]){ const kind=KINDS.find(x=>p[1]&&p[1].indexOf(x)>=0)||'支线'; if(addLine(st,kind,p[2],p[3],'模型')) ch=true; }
    else if(/^事件/.test(k) && p[1]){ if(!st.events.some(e=>e.turn===t && e.title===p[1])){ st.events.push({turn:t,title:p[1],desc:p[2]||''}); if(st.events.length>60) st.events=st.events.slice(-60); st.evLast=t; st.evForce=false; ch=true; } }
  }
  return ch;
}
function harvest(mesId){
  const s=settings(); if(!s.enabled) return;
  const ctx=getContext(); const chat=ctx.chat||[];
  const idx=(mesId!=null&&chat[mesId])?mesId:chat.length-1;
  const m=chat[idx]; if(!m||m.is_user||m.is_system) return;
  const st=meta(); if(!st) return;
  if(!m.extra) m.extra={};
  const sidx=(typeof m.swipe_id==='number')?m.swipe_id:0;
  m.extra.xianBlocks=m.extra.xianBlocks||{};
  const ex=extractBlock(m.mes||'');
  if(ex){
    m.extra.xianBlocks[sidx]=ex.memo.trim();
    m.mes=((m.mes||'').slice(0,ex.start)+(m.mes||'').slice(ex.end)).trimEnd();
    try{ if(Array.isArray(m.swipes)&&m.swipes[sidx]!=null) m.swipes[sidx]=m.mes; }catch(_){}
    try{ ctx.updateMessageBlock?.(idx,m); }catch(_){}
  }
  let ch=false;
  try{ if(fbHarvest(m,idx,st)) ch=true; }catch(e){ console.error('[线] 副本收块失败',e); }
  if(st.pendingDir){ st.pendingDir=''; ch=true; }
  // 事件楼没收到「事件|」行也算触发过了，避免每楼都催
  if(st.evForce || (s.evEvery>0 && (curTurn()-st.evLast)>=s.evEvery)){ st.evLast=curTurn(); st.evForce=false; ch=true; }
  const blk=m.extra.xianBlocks[sidx];
  if(blk && applyBlock(st,blk)) ch=true;
  if(ch) saveMeta();
  renderPanel();
}
// 删楼 / 回退：把超过当前楼数的进展、事件剪掉
function prune(){
  const st=meta(); if(!st) return; const t=curTurn(); let ch=false;
  for(const l of st.lines){ const n=l.nodes.length; l.nodes=l.nodes.filter(x=>x.turn<=t); if(l.nodes.length!==n) ch=true; if(l.status==='完成'&&l.doneTurn>t){ l.status='进行中'; delete l.doneTurn; ch=true; } }
  const en=st.events.length; st.events=st.events.filter(e=>e.turn<=t); if(st.events.length!==en) ch=true;
  if(st.evLast>t){ st.evLast=t; ch=true; }
  if(ch) saveMeta();
  renderPanel();
}

// ---------- 生成走向 ----------
let genBusy=false;
async function rawGen(prompt){
  const ctx=getContext(); let out='';
  try{ out=await ctx.generateQuietPrompt(prompt); }
  catch(e){ try{ out=await ctx.generateRaw({prompt}); }catch(e2){ out=await ctx.generateRaw(prompt,'',false,false); } }
  return String(out||'');
}
function recentProse(n){
  const chat=getContext().chat||[]; const out=[]; let c=0;
  for(let i=chat.length-1;i>=0&&c<n;i--){ const m=chat[i]; if(!m||m.is_system) continue; const txt=String(m.mes||'').replace(/<(thinking|think|thought)>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]+>/g,'').trim(); if(!txt) continue; out.unshift((m.is_user?'【user】':'【'+(m.name||'char')+'】')+txt.slice(0,1500)); c++; }
  return out.join('\n\n');
}
async function genDirections(){
  const s=settings(), st=meta(); if(!st) return; if(genBusy) return; genBusy=true;
  try{
    const ctx=getContext(); let cd='';
    try{ const c=(ctx.characters||[])[ctx.characterId]; if(c) cd=String(c.description||'').slice(0,600); }catch(_){}
    const act=st.lines.filter(l=>l.status==='进行中').map(l=>l.kind+'「'+l.title+'」'+(l.desc?'：'+l.desc:'')+(l.nodes.length?'（最近：'+l.nodes[l.nodes.length-1].text+'）':'')).join('\n')||'（无）';
    const kindTxt = s.genKind==='混合' ? '类型在 主线/小主线/支线/事件 里混着出，主线少一点' : '类型全部为 '+s.genKind;
    const formTxt = s.genForm==='多步' ? '每条给出 3 到 5 个前后衔接的步骤，用分号隔开' : '每条只写一个走向，不拆步骤';
    const prompt='【剧情走向提案】下面是一段角色扮演的近况。请提出 '+s.genCount+' 条**互不重复**的后续剧情走向，供玩家挑选。要求：贴合人物和已有故事线；有的接着现有线走，有的开新口子；可以有平淡的、有转折的、有坏的；不要都往同一个情绪方向堆。'+kindTxt+'。'+formTxt+'。'+(s.genPref?'玩家偏好：'+s.genPref+'。':'')+'\n每条一行，严格格式，不要编号、不要解释、不要多余文字：\n走向|类型(主线/小主线/支线/事件)|标题(8字内)|概要(40字内)|步骤(单步可空；多步用分号隔开)\n\n【角色】'+cd+'\n\n【现有故事线】\n'+act+'\n\n【最近正文】\n'+recentProse(s.genCtx);
    try{ toastr.info('线：正在生成走向…'); }catch(_){}
    const out=await rawGen(prompt);
    const items=[];
    for(let l of out.split('\n')){
      l=l.replace(/｜/g,'|').replace(/^[\s\d.、)）*_>\-]+/,'').trim(); if(!/^走向\s*\|/.test(l)) continue;
      const p=l.split('|').map(x=>x.trim().replace(/^(类型|标题|概要|步骤)\s*[：:]\s*/,''));
      if(!p[2]) continue;
      const kind=(['主线','小主线','支线','事件'].find(k=>(p[1]||'').indexOf(k)>=0))||'支线';
      items.push({id:Date.now()+'_'+items.length, kind, title:p[2], desc:p[3]||'', steps:(p[4]||'').split(/[;；]/).map(x=>x.trim()).filter(Boolean)});
    }
    if(items.length){ st.cands=items.concat(st.cands).slice(0,80); saveMeta(); curTab='gen'; renderPanel(); try{ toastr.info('线：出了 '+items.length+' 条走向'); }catch(_){} }
    else { try{ toastr.warning('线：没解析到走向，再点一次'); }catch(_){}; console.log('[线] genDirections raw:',out); }
  }catch(e){ console.error('[线] 生成失败',e); try{ toastr.error('线：生成失败 '+(e.message||e)); }catch(_){} }
  finally{ genBusy=false; renderPanel(); }
}
function candText(c){ return c.title+(c.desc?'：'+c.desc:'')+(c.steps&&c.steps.length?'。步骤：'+c.steps.join('；'):''); }
function adoptCand(c){ const st=meta(); if(!st) return; if(c.kind==='事件'){ st.pendingDir='本楼发生以下事件：'+candText(c); } else { const l=addLine(st,c.kind,c.title,c.desc,'走向'); if(l && c.steps&&c.steps.length) l.desc=(l.desc?l.desc+'。':'')+'预定步骤：'+c.steps.join('→'); } saveMeta(); }
function pushDir(c){ const st=meta(); if(!st) return; st.pendingDir='按这个走向推进：'+candText(c)+'。只推进到走向的开头或第一步，后面留给玩家。'; saveMeta(); try{ toastr.info('线：下一楼按「'+c.title+'」走'); }catch(_){} }
function favCand(c){ const s=settings(); if(s.favs.some(f=>f.title===c.title&&f.desc===c.desc)) return false; s.favs.unshift(Object.assign({},c,{fav:Date.now()})); if(s.favs.length>200) s.favs=s.favs.slice(0,200); saveS(); return true; }

// ---------- UI ----------
let curTab='line';
function mountUI(){
  if(document.getElementById('xian-root')) return;
  const s=settings();
  const root=document.createElement('div'); root.id='xian-root'; if(s.night) root.classList.add('night');
  const orb=document.createElement('div'); orb.id='xian-orb'; orb.innerHTML='<span>线</span>';
  const panel=document.createElement('div'); panel.id='xian-panel'; panel.style.display='none';
  root.appendChild(orb); root.appendChild(panel); document.body.appendChild(root);
  let px=s.px!=null?s.px:(window.innerWidth-74), py=s.py!=null?s.py:(window.innerHeight-140);
  px=Math.max(4,Math.min(px,window.innerWidth-54)); py=Math.max(4,Math.min(py,window.innerHeight-54));
  orb.style.left=px+'px'; orb.style.top=py+'px';
  panel.style.left=Math.max(8,Math.min(px,window.innerWidth-342))+'px'; panel.style.top=Math.max(8,py-420)+'px';
  makeDrag(orb,orb,()=>openPanel(true));
  if(!s.enabled) root.style.display='none';
  applyOrb(); renderPanel();
}
function applyOrb(){ const s=settings(); const p=document.getElementById('xian-panel'),o=document.getElementById('xian-orb'); if(!o) return; const open=p&&p.style.display!=='none'; o.style.display=(open||s.hideOrb)?'none':'flex'; }
function togglePanel(){ const p=document.getElementById('xian-panel'); if(!p) return; openPanel(p.style.display==='none'); }
function openPanel(v){ const p=document.getElementById('xian-panel'); if(!p) return; p.style.display=v?'block':'none'; applyOrb(); if(v) renderPanel(); }
function makeDrag(handle,mover,onClick){
  let sx,sy,ox,oy,moved=false,down=false;
  const start=(e)=>{ const t=e.touches?e.touches[0]:e; down=true; moved=false; sx=t.clientX; sy=t.clientY; ox=mover.offsetLeft; oy=mover.offsetTop; };
  const move=(e)=>{ if(!down) return; const t=e.touches?e.touches[0]:e; const dx=t.clientX-sx, dy=t.clientY-sy; if(Math.abs(dx)+Math.abs(dy)>4) moved=true; if(moved){ mover.style.left=Math.max(0,Math.min(window.innerWidth-40,ox+dx))+'px'; mover.style.top=Math.max(0,Math.min(window.innerHeight-40,oy+dy))+'px'; if(e.cancelable) e.preventDefault(); } };
  const end=()=>{ if(!down) return; down=false; if(!moved){ if(onClick) onClick(); } else if(mover.id==='xian-orb'){ const s=settings(); s.px=mover.offsetLeft; s.py=mover.offsetTop; saveS(); } };
  handle.addEventListener('mousedown',start); window.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
  handle.addEventListener('touchstart',start,{passive:true}); window.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
}
function tab(n,l){ return '<span class="x-tab'+(curTab===n?' on':'')+'" data-tab="'+n+'">'+l+'</span>'; }
function kindTag(k){ return '<span class="x-tag k-'+esc(k)+'">'+esc(k)+'</span>'; }
function candCard(c,where){
  const s=settings(); const isFav=s.favs.some(f=>f.title===c.title&&f.desc===c.desc);
  return '<div class="x-card" data-cid="'+esc(c.id)+'"><div class="th">'+kindTag(c.kind)+'<span class="x-tt">'+esc(c.title)+'</span></div>'+(c.desc?'<div class="x-desc">'+esc(c.desc)+'</div>':'')+(c.steps&&c.steps.length?'<ol class="x-steps">'+c.steps.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>':'')+
    '<div class="x-acts">'+(where==='fav'?'':'<span data-a="fav" title="收藏">'+(isFav?'★ 已收藏':'☆ 收藏')+'</span>')+'<span data-a="adopt" title="登记为故事线 / 事件">✓ 采用</span><span data-a="push" title="下一楼按它走">➤ 下一楼</span><span data-a="del" title="删掉">✕</span></div></div>';
}
function renderPanel(){
  const p=document.getElementById('xian-panel'); if(!p||p.style.display==='none') return;
  const s=settings(), st=meta();
  let body='';
  if(!st){ body='<div class="x-empty">先打开一个聊天</div>'; }
  else if(curTab==='line'){
    const act=st.lines.filter(l=>l.status!=='完成');
    for(const k of KINDS){
      const ls=act.filter(l=>l.kind===k);
      body+='<div class="x-sec">'+kindTag(k)+'<span data-a="addline" data-k="'+k+'" class="x-mini">＋手动添加</span></div>';
      if(!ls.length) body+='<div class="x-empty">无</div>';
      for(const l of ls){
        const last=l.nodes.length?l.nodes[l.nodes.length-1]:null;
        body+='<div class="x-card" data-lid="'+l.id+'"><div class="th"><span class="x-tt">#'+l.id+' '+esc(l.title)+'</span>'+(l.status==='搁置'?'<span class="x-tag k-搁置">搁置</span>':'')+'</div>'+(l.desc?'<div class="x-desc">'+esc(l.desc)+'</div>':'')+(last?'<div class="x-last">最近（第'+last.turn+'楼）：'+esc(last.text)+(l.nodes.length>1?'　<span data-a="hist" class="x-mini">全部'+l.nodes.length+'条</span>':'')+'</div>':'')+
          '<div class="x-acts"><span data-a="edit">✎</span><span data-a="done">✓ 完成</span><span data-a="hold">'+(l.status==='搁置'?'▶ 恢复':'❚❚ 搁置')+'</span><span data-a="dell">✕</span></div></div>';
      }
    }
    const done=st.lines.filter(l=>l.status==='完成');
    if(done.length){ body+='<div class="x-sec"><span class="x-tag k-完成">已完结</span></div>'; for(const l of done) body+='<div class="x-card x-done" data-lid="'+l.id+'"><div class="th">'+kindTag(l.kind)+'<span class="x-tt">'+esc(l.title)+'</span></div><div class="x-acts"><span data-a="reopen">↺ 重开</span><span data-a="dell">✕</span></div></div>'; }
  }
  else if(curTab==='fb'){
    const fb=st.fb;
    if(fb.cur){
      const f=fb.cur; const b=f.boss||{};
      body+='<div class="x-card"><div class="th">'+kindTag(f.type||'副本')+'<span class="x-tt">'+esc(f.name||'(未命名)')+'</span></div><div class="x-mini2">底稿已锁，模型每楼都看得见，你看不见。第'+(f.turn||'?')+'楼进入。</div>'+
        '<div class="x-acts"><span data-a="fbpeek">'+(fb.peek?'🙈 收起':'👁 偷看底稿')+'</span><span data-a="fbend">✓ 通关结束</span><span data-a="fbdead">✕ 失败/离开</span><span data-a="fbdrop">🗑 作废</span></div></div>';
      if(fb.peek) body+='<pre class="x-pre">'+esc(f.raw)+'</pre>';
    } else {
      body+='<div class="x-mini2">没有进行中的副本。</div>'+
        '<div class="x-btn'+(fb.pending?' busy':'')+'" data-a="fbnew">'+(fb.pending?'已排：下一楼进入副本并生成底稿（再点取消）':'下一楼进入副本（模型生成底稿，你看不见）')+'</div>'+
        '<div class="x-mini2">流程：在庇护所选好副本后点这个，再发一楼。模型会用手表介绍背景和身份，并在末尾偷偷写一份完整底稿（故事真相、规则、大boss长相性格欲望阈值、其他玩家），插件收走藏起来。</div>';
    }
    const log=(fb.log||[]).slice().reverse();
    if(log.length){ body+='<div class="x-sec"><span class="x-tag">已打过 '+log.length+' 个</span></div>'+log.map((x,i)=>'<div class="x-card" data-fbi="'+(log.length-1-i)+'"><div class="th">'+kindTag(x.type||'副本')+'<span class="x-tt">'+esc(x.name||'?')+'</span><span class="x-mini2">'+esc(x.how||'')+'</span></div><div class="x-desc">大boss：'+esc(x.boss||'?')+'</div><div class="x-last">'+esc(x.line.split('｜').slice(2).join('　'))+'</div><div class="x-acts"><span data-a="fbshow">原稿</span><span data-a="fbdel">✕</span></div></div>').join(''); }
  }
  else if(curTab==='gen'){
    body+='<div class="x-ctl"><label>数量 <select data-s="genCount">'+[5,10,15,20,30].map(n=>'<option'+(s.genCount==n?' selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
      '<label>类型 <select data-s="genKind">'+['混合','主线','小主线','支线','事件'].map(n=>'<option'+(s.genKind==n?' selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
      '<label>形式 <select data-s="genForm">'+['单步','多步'].map(n=>'<option'+(s.genForm==n?' selected':'')+'>'+n+'</option>').join('')+'</select></label></div>'+
      '<input class="x-in" data-s="genPref" placeholder="偏好（可空）：比如 想要一点压迫感 / 别太狗血 / 围绕那个木盒" value="'+esc(s.genPref)+'">'+
      '<div class="x-btn'+(genBusy?' busy':'')+'" data-a="gen">'+(genBusy?'生成中…':'生成走向（花一次 API）')+'</div>';
    if(st.cands.length) body+='<div class="x-sec"><span class="x-mini2">'+st.cands.length+' 条候选</span><span data-a="clearc" class="x-mini">清空</span></div>'+st.cands.map(c=>candCard(c,'gen')).join('');
    else body+='<div class="x-empty">还没有候选。点上面生成。</div>';
  }
  else if(curTab==='fav'){
    body+= s.favs.length ? s.favs.map(c=>candCard(c,'fav')).join('') : '<div class="x-empty">还没收藏。在「走向」里点 ☆。收藏跨聊天共用。</div>';
  }
  else if(curTab==='ev'){
    body+='<div class="x-ctl"><label>每 <input type="number" min="0" max="99" class="x-num" data-s="evEvery" value="'+s.evEvery+'"> 楼一个随机事件（0=关）</label></div>'+
      '<input class="x-in" data-s="evPref" placeholder="事件倾向（可空）：比如 偏日常小事 / 带点危险 / 和他母亲有关" value="'+esc(s.evPref)+'">'+
      '<div class="x-btn" data-a="evnow">'+(st.evForce?'下一楼必发（已排）':'下一楼来一个')+'</div>'+
      (s.evEvery>0?'<div class="x-mini2">上次事件在第'+st.evLast+'楼，当前第'+curTurn()+'楼，还差 '+Math.max(0,s.evEvery-(curTurn()-st.evLast))+' 楼</div>':'');
    const evs=st.events.slice().reverse();
    body+= evs.length ? evs.map(e=>'<div class="x-card"><div class="th"><span class="x-tag k-事件">第'+e.turn+'楼</span><span class="x-tt">'+esc(e.title)+'</span></div>'+(e.desc?'<div class="x-desc">'+esc(e.desc)+'</div>':'')+'</div>').join('') : '<div class="x-empty">还没发生过事件</div>';
  }
  else if(curTab==='set'){
    body+='<label class="x-chk"><input type="checkbox" data-s="inject"'+(s.inject?' checked':'')+'> 把故事线状态注入给模型</label>'+
      '<label class="x-chk"><input type="checkbox" data-s="askBlock"'+(s.askBlock?' checked':'')+'> 要求模型每楼末尾输出数据块（自动记进展/完成/新线/事件；插件会从正文里剪掉）</label>'+
      '<label class="x-chk"><input type="checkbox" data-s="hideOrb"'+(s.hideOrb?' checked':'')+'> 隐藏悬浮球（用 /xian 或魔法棒菜单打开）</label>'+
      '<label class="x-chk"><input type="checkbox" data-s="night"'+(s.night?' checked':'')+'> 深色面板</label>'+
      '<div class="x-ctl"><label>生成走向时带最近 <input type="number" min="2" max="20" class="x-num" data-s="genCtx" value="'+s.genCtx+'"> 楼正文</label></div>'+
      '<div class="x-mini2">数据块格式：&lt;xian&gt; 进展|线|一句话 / 完成|线 / 新线|类型|标题|描述 / 事件|标题|描述 &lt;/xian&gt;。模型不按格式输出时，线不会自动动，你可以手动记。</div>'+
      '<div class="x-mini2">线 v'+VER+'</div>';
  }
  p.innerHTML='<div class="x-head"><span class="x-name">线</span><span class="x-sub">故事线</span><span style="flex:1"></span><span class="x-hbtn" data-a="close">✕</span></div>'+
    '<div class="x-tabs">'+tab('line','故事线')+tab('fb','副本')+tab('gen','走向')+tab('fav','收藏')+tab('ev','事件')+tab('set','⚙')+'</div>'+
    '<div class="x-body">'+body+'</div>';
  bind(p);
}
function bind(p){
  const s=settings();
  makeDrag(p.querySelector('.x-head'),p,null);
  p.querySelectorAll('.x-tab').forEach(e=>e.addEventListener('click',()=>{ curTab=e.dataset.tab; renderPanel(); }));
  p.querySelectorAll('[data-s]').forEach(e=>{
    const k=e.dataset.s;
    e.addEventListener('change',()=>{ if(e.type==='checkbox'){ s[k]=e.checked; if(k==='night'){ document.getElementById('xian-root').classList.toggle('night',e.checked); } if(k==='hideOrb') applyOrb(); } else if(e.type==='number'){ s[k]=parseInt(e.value,10)||0; } else { s[k]=e.value; } saveS(); if(e.tagName!=='INPUT'||e.type!=='text') renderPanel(); });
  });
  p.querySelectorAll('[data-a]').forEach(e=>e.addEventListener('click',(ev)=>{ ev.stopPropagation(); action(e.dataset.a,e); }));
}
function action(a,el){
  const s=settings(), st=meta();
  if(a==='close'){ openPanel(false); return; }
  if(a==='gen'){ if(!genBusy) genDirections(); return; }
  if(!st) return;
  const card=el.closest('.x-card');
  const cid=card&&card.dataset.cid; const lid=card&&card.dataset.lid;
  let c=null; if(cid){ c=st.cands.find(x=>x.id===cid)||s.favs.find(x=>x.id===cid); }
  const l=lid?lineById(st,lid):null;
  switch(a){
    case 'fav': if(c){ if(favCand(c)) toastr.info('线：已收藏'); else toastr.info('线：已经在收藏里'); } break;
    case 'adopt': if(c){ adoptCand(c); toastr.info(c.kind==='事件'?'线：事件排到下一楼':'线：已登记为'+c.kind); curTab='line'; } break;
    case 'push': if(c) pushDir(c); break;
    case 'del': if(c){ st.cands=st.cands.filter(x=>x.id!==cid); s.favs=s.favs.filter(x=>x.id!==cid); saveMeta(); saveS(); } break;
    case 'clearc': st.cands=[]; saveMeta(); break;
    case 'addline': { const k=el.dataset.k; const t=prompt(k+'标题'); if(!t) return; const d=prompt('一句话描述（可空）')||''; addLine(st,k,t,d,'手动'); saveMeta(); break; }
    case 'edit': if(l){ const t=prompt('标题',l.title); if(t==null) return; const d=prompt('描述',l.desc); if(d==null) return; const k=prompt('类型（主线/小主线/支线）',l.kind); l.title=t.trim()||l.title; l.desc=d.trim(); if(KINDS.indexOf(k)>=0) l.kind=k; saveMeta(); } break;
    case 'done': if(l){ l.status='完成'; l.doneTurn=curTurn(); saveMeta(); } break;
    case 'hold': if(l){ l.status=l.status==='搁置'?'进行中':'搁置'; saveMeta(); } break;
    case 'reopen': if(l){ l.status='进行中'; delete l.doneTurn; saveMeta(); } break;
    case 'dell': if(l && confirm('删掉「'+l.title+'」？')){ st.lines=st.lines.filter(x=>x.id!==l.id); saveMeta(); } break;
    case 'hist': if(l){ alert(l.nodes.map(n=>'第'+n.turn+'楼：'+n.text).join('\n')); return; }
    case 'evnow': st.evForce=!st.evForce; saveMeta(); break;
    case 'fbnew': st.fb.pending=!st.fb.pending; saveMeta(); break;
    case 'fbpeek': st.fb.peek=!st.fb.peek; saveMeta(); break;
    case 'fbend': if(st.fb.cur && confirm('副本「'+(st.fb.cur.name||'')+'」通关结束？大boss会记进登记表，下个副本必须不同。')){ fbEnd(st,'通关'); saveMeta(); } break;
    case 'fbdead': if(st.fb.cur && confirm('标记为失败/离开并结束？')){ fbEnd(st,'失败/离开'); saveMeta(); } break;
    case 'fbdrop': if(st.fb.cur && confirm('作废这份底稿（不记入登记表）？')){ st.fb.cur=null; st.fb.pending=false; saveMeta(); } break;
    case 'fbshow': { const i=parseInt(card&&card.dataset.fbi,10); const x=(st.fb.log||[])[i]; if(x) alert(x.raw||x.line); return; }
    case 'fbdel': { const i=parseInt(card&&card.dataset.fbi,10); if(!isNaN(i) && confirm('从登记表删掉？')){ st.fb.log.splice(i,1); saveMeta(); } break; }
  }
  renderPanel();
}
function onChanged(){ curTab='line'; renderPanel(); }

jQuery(async ()=>{
  try{ mountUI(); }catch(e){ console.error('[线] UI挂载失败',e); }
  if(event_types.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
  eventSource.on(event_types.MESSAGE_RECEIVED, harvest);
  eventSource.on(event_types.CHAT_CHANGED, onChanged);
  if(event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, harvest);
  if(event_types.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, prune);
  if(event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, ()=>{ try{ const la=lastAiMsg(); if(la) harvest(la.i); }catch(_){} });
  try{
    const html='<div class="xian-settings"><div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>牛角门·线（故事线）</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input id="xian_enabled" type="checkbox"> 启用</label><label class="checkbox_label"><input id="xian_hideorb" type="checkbox"> 隐藏悬浮球</label><div class="menu_button" id="xian_open_btn" style="margin:6px 0">打开 / 收起面板</div><small>主线 / 小主线 / 支线登记与自动进展、每 N 楼随机事件、一键生成多条剧情走向并收藏。入口：悬浮球「线」、斜杠命令 /xian、魔法棒菜单。</small></div></div></div>';
    $('#extensions_settings').append(html);
    $('#xian_enabled').prop('checked',settings().enabled).on('change',function(){ settings().enabled=this.checked; saveS(); const r=document.getElementById('xian-root'); if(r) r.style.display=this.checked?'':'none'; });
    $('#xian_hideorb').prop('checked',!!settings().hideOrb).on('change',function(){ settings().hideOrb=this.checked; saveS(); applyOrb(); });
    $('#xian_open_btn').on('click',togglePanel);
  }catch(e){}
  try{
    const ctx=getContext(); let ok=false;
    try{ if(ctx.SlashCommandParser&&ctx.SlashCommand){ ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({name:'xian',callback:()=>{ togglePanel(); return ''; },helpString:'打开或收起「线」故事线面板'})); ok=true; } }catch(_){}
    if(!ok&&typeof ctx.registerSlashCommand==='function') ctx.registerSlashCommand('xian',()=>{ togglePanel(); return ''; },[],'打开或收起「线」故事线面板',true,true);
  }catch(e){}
  try{
    const add=()=>{ const m=document.getElementById('extensionsMenu'); if(!m||document.getElementById('xian_wand')) return !!m; const d=document.createElement('div'); d.id='xian_wand'; d.className='list-group-item flex-container flexGap5 interactable'; d.tabIndex=0; d.innerHTML='<div class="fa-solid fa-code-branch extensionsMenuExtensionButton"></div><span>线·故事线</span>'; d.addEventListener('click',togglePanel); m.appendChild(d); return true; };
    if(!add()) setTimeout(add,3000);
  }catch(e){}
  console.log('[线] 已加载 v'+VER);
});
