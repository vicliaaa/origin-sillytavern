import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const MOD = 'origin';
const INJ_KEY = 'origin_state';
const DEFAULT_GACHA = [
  {name:'普通物资', tier:'N', weight:50, desc:'一点日常用度', effect:'积分+50'},
  {name:'灵石一袋', tier:'R', weight:28, desc:'', effect:'积分+200'},
  {name:'属性丹', tier:'SR', weight:15, desc:'魅力+5', effect:'魅力+5'},
  {name:'心意符', tier:'SSR', weight:6, desc:'指定对象好感+30', effect:'好感+30'},
  {name:'逆天改命券', tier:'UR', weight:1, desc:'一次改写命运的机会', effect:''},
];
const DEFAULT_SHOP = [
  {name:'凝神丹', price:200, desc:'服下立刻恢复精神、驱散疲惫', effect:''},
  {name:'易容面具', price:400, desc:'短时间改变容貌，不被认出', effect:''},
  {name:'魅力之种', price:800, desc:'使用后 魅力+10（永久）', effect:'魅力+10'},
  {name:'心意催化', price:600, desc:'【干涉】指定对象对你好感+20', effect:'好感+20'},
  {name:'回溯券', price:1200, desc:'【特权】回溯本回合，重来一次', effect:''},
  {name:'问天签', price:300, desc:'随机抽取一次（抽奖·第3期开放）', effect:''},
];
const PERSONA = {
  '冷澈': '冷静、克制、公事公办，偶尔一针见血。',
  '毒舌': '爱吐槽、损，但损得有分寸，刀子嘴。',
  '傲娇': '嘴上嫌弃、其实上心，会别扭地关心宿主。',
  '温和': '温和耐心，像个可靠的向导。',
};

function settings(){
  if(!extension_settings[MOD]) extension_settings[MOD] = {};
  const s = extension_settings[MOD];
  const d = {
    enabled:true, judgeMode:'A', freq:3, blockWhenUnfinished:true,
    taskSource:'auto', fourthWall:0, sysName:'Origin',
    personality:'冷澈', personaText:'', accent:'#b0684c', night:false, rewardPref:'', penaltyPref:'', bindTo:'宿主', autoEcon:false,
    budget:1400, drawCost:300, limitMin:0, limitMax:0, punishEvent:true, achieveOn:true, shopRefresh:0, gachaRefresh:0, px:null, py:null, open:false,
  };
  for(const k in d){ if(s[k]===undefined) s[k]=d[k]; }
  if(!s.mods) s.mods={};
  for(const mk of ['stat','bag','shop','gacha','ach']) if(s.mods[mk]===undefined) s.mods[mk]=true;
  return s;
}
function saveS(){ saveSettingsDebounced(); }

function meta(){
  const ctx = getContext();
  const m = ctx.chatMetadata ?? ctx.chat_metadata;
  if(!m) return null;
  if(!m[MOD]){
    m[MOD] = { world:'', points:0, level:1, exp:0, expMax:100,
      stats:[], tasks:[], log:[], lastTaskTurn:-99, lastShopTurn:-99, lastGachaTurn:-99, direction:'', nextId:1,
      bag:[], shop:DEFAULT_SHOP.map(x=>Object.assign({},x)), pendingUse:[],
      gachaPool:DEFAULT_GACHA.map(x=>Object.assign({},x)), pendingEvent:[], achievements:[] };
  }
  const o=m[MOD];
  if(!o.bag) o.bag=[];
  if(!o.pendingUse) o.pendingUse=[];
  if(!o.shop) o.shop=DEFAULT_SHOP.map(x=>Object.assign({},x));
  if(!o.gachaPool) o.gachaPool=DEFAULT_GACHA.map(x=>Object.assign({},x));
  if(!o.pendingEvent) o.pendingEvent=[];
  if(!o.achievements) o.achievements=[]; else { const _s={}; o.achievements=o.achievements.filter(a=>{ if(_s[a.name]) return false; _s[a.name]=1; return true; }); }
  if(o.lastShopTurn===undefined) o.lastShopTurn=-99;
  if(o.lastGachaTurn===undefined) o.lastGachaTurn=-99;
  return o;
}
function saveMeta(){
  const ctx = getContext();
  (ctx.saveMetadataDebounced ?? ctx.saveMetadata ?? (()=>{}))();
  snapshot();
}
function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function persona(){ const s=settings(); return (s.personaText&&s.personaText.trim()) ? s.personaText.trim() : (PERSONA[s.personality]||PERSONA['冷澈']); }

function curTurn(){ try{ const chat=getContext().chat||[]; let n=0; for(const m of chat){ if(m && !m.is_user && !m.is_system) n++; } return n; }catch(e){ return 0; } }
function lastAiMsg(){ const chat=getContext().chat||[]; for(let i=chat.length-1;i>=0;i--){ const m=chat[i]; if(m && !m.is_user && !m.is_system) return {m,i}; } return null; }
function snapshot(){ try{ const ctx=getContext(); const mm=ctx.chatMetadata??ctx.chat_metadata; if(!mm||!mm[MOD]) return; const la=lastAiMsg(); if(!la) return; if(!la.m.extra) la.m.extra={}; la.m.extra.originSnap=JSON.stringify(mm[MOD]); if(ctx.saveChat) ctx.saveChat(); }catch(_){}}
function restoreFromChat(){ try{ const ctx=getContext(); const mm=ctx.chatMetadata??ctx.chat_metadata; if(!mm) return; const la=lastAiMsg(); if(la && la.m.extra && la.m.extra.originSnap){ mm[MOD]=JSON.parse(la.m.extra.originSnap); } }catch(_){}}
function tRemain(t){ if(!t.limit || t.limit<=0) return null; const elapsed=curTurn()-(t.startTurn||t.turn||curTurn()); return t.limit - elapsed; }
function checkExpiry(){ const st=meta(); if(!st) return; let ch=false; for(const t of st.tasks){ if(t.status==='active'){ const r=tRemain(t); if(r!==null && r<=0){ t.status='failed'; applyEffects(st,t.penalty,-1); pushLog(st,'任务「'+t.title+'」超时失败'+(t.penalty?'　'+t.penalty:''),'!'); if(settings().punishEvent){ st.pendingEvent=st.pendingEvent||[]; st.pendingEvent.push('任务「'+t.title+'」超时失败'+(t.penalty?'（'+t.penalty+'）':'')+'，请让剧情出现一个相称的不利后果'+(settings().penaltyPref?'（后果倾向：'+settings().penaltyPref+'）':'')); } ch=true; } } } if(ch) saveMeta(); }
function allowNewTask(st){
  const s = settings();
  if(st.tasks.filter(t=>t.status==='active').length===0) return true;
  if(curTurn() - st.lastTaskTurn < s.freq) return false;
  if(s.blockWhenUnfinished && st.tasks.some(t=>t.status==='active' && (t.type==='主线'||t.type==='支线'))) return false;
  return true;
}

function buildInjection(){
  const s = settings(); const st = meta(); if(!st) return '';
  checkExpiry(); checkAchievements();
  const active = st.tasks.filter(t=>t.status==='active');
  let out = '【'+s.sysName+' 状态】\n';
  const _host = (s.bindTo && s.bindTo!=='宿主') ? s.bindTo : '';
  const _autoEcon = s.autoEcon || !!_host;
  if(_host) out += '★本系统绑定的是角色【'+_host+'】，不是宿主(user)。任务/积分/属性/成就都属于 '+_host+'；请让 '+_host+' 像突然获得金手指系统的主角那样思考、并主动完成系统任务。宿主(user)是旁观者或其他在场角色，系统不向 user 派任务、也不对 user 说话（除非 user 正在扮演 '+_host+'）。\n';
  out += '世界：'+(st.world||'未设定')+'\n';
  out += '积分：'+st.points+' ｜ 等级 Lv.'+st.level+'\n';
  if(st.stats.length) out += '属性：'+st.stats.map(x=>x.name+x.val).join(' ')+'\n';
  const fmtT=(t)=>{ const rem=tRemain(t); return '  ['+t.type+'#'+t.id+'] '+t.title+'（进度'+(t.progress||0)+'%'+(rem!==null?('，剩'+Math.max(0,rem)+'回合'):'')+'）｜要求:'+(t.cond||'—')+(t.reward?'｜奖:'+t.reward:'')+(t.penalty?'｜罚:'+t.penalty:'')+'\n'; };
  const _primary=_host||'宿主'; const _mine=active.filter(t=>(t.owner||'宿主')===_primary); const _theirs=active.filter(t=>(t.owner||'宿主')!==_primary);
  out += (_host?('【'+_host+'】'):'宿主(user)')+'的进行中任务：\n';
  if(_mine.length){ for(const t of _mine) out+=fmtT(t); } else out += '  （暂无）\n';
  if(_theirs.length){ out += '系统给角色布置的任务（请让对应角色在剧情里自己朝这些目标行动、推进，不需要宿主指挥）：\n'; for(const t of _theirs) out += '  【给'+t.owner+'】'+fmtT(t).replace(/^\s+/,''); }
  if(s.mods.bag && st.bag && st.bag.length) out += (_host||'宿主')+'背包：'+st.bag.map(b=>b.name+'×'+(b.count||1)).join('，')+'\n';
  if(_autoEcon && s.mods.shop && st.shop && st.shop.length) out += '商城（可花积分买，当前积分'+st.points+'）：'+st.shop.slice(0,8).map(x=>x.name+'('+x.price+')').join(' ／ ')+'\n';
  if(st.pendingUse && st.pendingUse.length) out += '【本回合宿主动作】'+st.pendingUse.map(u=>'使用了道具「'+u.name+'」'+(u.desc?'（'+u.desc+'）':'')).join('；')+'——请让剧情与角色对此作出合理反应。\n';
  if(st.pendingEvent && st.pendingEvent.length) out += '【本回合系统事件】'+st.pendingEvent.join('；')+'——请把它自然写进正文（系统播报口吻，或让剧情直接呈现）。\n';
  if(s.mods.shop && s.shopRefresh>0 && (curTurn()-(st.lastShopTurn||-99))>=s.shopRefresh) out += '【商城可更新】本回合请在数据块用『新商品|名称|价格|说明|效果』提供 2-3 个贴合当前世界观与宿主玩法方向的新商品（可替换旧的）。\n';
  if(s.mods.gacha && s.gachaRefresh>0 && (curTurn()-(st.lastGachaTurn||-99))>=s.gachaRefresh) out += '【奖池可更新】本回合请在数据块用『新奖品|名称|稀有度|权重|说明|效果』给出 3-5 个贴合当前世界观与宿主玩法方向的奖品，整套替换奖池。\n';

  out += '\n【本回合规则】\n';
  out += '1. 依据本回合正文里实际发生的事，更新上面任务的进度或判定完成/失败；据实判定，没发生的进展不要写，禁止替宿主(user)自动完成任务。当某个进行中任务的完成条件在本回合剧情里达成了，必须输出一行『完成|任务id』（用上面列出的数字id），不要漏、不要只在嘴上说完成了。任务可以在被发布的同一回合就完成——只要本回合剧情已达成条件，就立刻报完成、进度直接给到100，禁止为了拉长节奏而故意压低进度或把已完成的任务拖到以后。\n'; if(_host) out += '（系统绑定于 '+_host+'：请让 '+_host+' 主动推进并完成自己的系统任务，这是主角在用金手指，不算替宿主完成。）\n';
  const allow = allowNewTask(st);
  if(s.taskSource==='manual'){
    out += '2. 本回合不要自动发任务（宿主设为只手写）。\n';
  } else if(allow){
    if(active.length===0){
      out += '2. 当前没有任何任务：请在本回合、或最迟下一回合，发起 1 个能把宿主带入这个世界目标的开场任务（优先主线），不要一直不发。';
    } else {
      out += '2. 允许发新任务：若当前剧情合适，可发起 1 个贴合此刻情节的新任务（主线/支线/日常）；若不适合也可以不发。';
    }
    if(st.direction) out += '宿主希望的任务方向：'+st.direction+'（尽量贴合，同时贴合当前剧情）。';
    out += '\n';
  } else {
    out += '2. 本回合不要发新任务（未到频率或尚有主线/支线未完成）。\n';
  }
  if(s.fourthWall>0) out += '3. 第四面墙：有约 '+s.fourthWall+'% 的概率，系统可短暂打破第四面墙做一句元叙事吐槽，其余时候照常演，不要每次都破。\n';
  else out += '3. 不要打破第四面墙。\n';
  out += '4. 系统说话风格：'+persona()+'\n';
  if(_autoEcon) out += '· '+(_host||'宿主')+'可以在剧情合理、且出于角色自己意愿时，自主使用系统：花积分从商城买东西、抽奖、用背包道具——由动机驱动，别每回合乱花、积分不够不能买。要做时在数据块报告：买|商品名 ／ 抽奖 ／ 用道具|名称。\n';
  out += '5. 若'+(_host||'宿主(user)')+'在正文里直接对系统说话或提问（如『系统，…』），系统要用上面的说话风格回应；可以解释任务、给提示、调侃、回应请求或商量；但不得替其做决定，任何积分/属性/任务的实际变动仍必须走下面的数据块。\n';
  out += '6. 奖励是对宿主有利的（加积分/加属性/加好感/给道具等）；失败惩罚才是不利的。禁止把不利内容写进奖励栏。\n';
  out += '7. 失败惩罚可以是扣积分、掉属性、失去道具、触发不利事件、或限时未达成的后果等，按剧情自由选，不必总是扣好感，也允许有的任务没有惩罚。\n';
  if(s.rewardPref) out += '8. 奖励偏好：'+s.rewardPref+'。\n';
  if(s.penaltyPref) out += '9. 惩罚偏好：'+s.penaltyPref+'。\n';

  if(s.limitMax>0) out += '给任务设时限时，请在 '+s.limitMin+'-'+s.limitMax+' 回合之间按任务轻重浮动取值，不要每次都用同一个数；不紧急的任务也可以不设时限（时限留空）。\n';
  out += '\n【输出】在回复最末尾另起一行，输出 '+s.sysName+' 数据块（此块不属于正文、不计字数、不影响文风）：\n';
  out += '<origin>\n';
  out += '进度|任务id|新百分比0-100|一句依据（正文里发生了什么）\n';
  out += '完成|任务id\n';
  out += '失败|任务id\n';
  out += '新任务|类型:主线或支线或日常|标题:…|描述:…|条件:…|奖励:积分300 魅力+2|惩罚:…（可空）|时限:'+(s.limitMax>0?('取 '+s.limitMin+'到'+s.limitMax+' 之间的整数，别用更小的'):'一个整数或留空')+'|对象:宿主或角色名（默认宿主，若这是系统给某角色布置的任务就写角色名）\n';
  out += '（新任务每个字段务必用「标签:值」写清楚，例如 奖励:积分300；缺的字段整段不写即可。）\n';
  out += '（★关键：正文里系统「发布/派发/给出」一个新任务时，必须用上面的『新任务|...』这一行来创建它，绝对不能用『进度|』代替。『进度|』只用于更新上面【已经列出】的现有任务。任务id只能用上面列出的数字，禁止自己编造 id、也别写「隐藏ID」。）\n';
  out += '积分|+N或-N|理由\n';
  out += '属性|名称|+N或-N\n';
  out += '播报|一句系统口吻的话（用上面的说话风格）\n';
  if(s.mods.bag){ out += '获得|名称|数量　（在剧情里得到某个物品时）\n'; out += '用道具|名称　（在剧情里用掉或消耗了背包里的某个物品时，我会从背包扣掉）\n'; }
  if(_autoEcon){ out += '买|商品名　（角色花积分从商城购买，自动进背包）\n'; if(s.mods.gacha) out += '抽奖　（角色花积分抽一次，结果自动进背包）\n'; }
  if(s.mods.ach) out += '成就|名称|一句描述（仅当剧情里真正达成了值得纪念的高光时才发，罕见，别滥发）\n';
  out += '新商品|名称|价格(整数)|说明|数值效果(可空)　（仅在收到『商城可更新』指令时才用）\n';
  if(s.mods.gacha) out += '新奖品|名称|稀有度(N/R/SR/SSR/UR)|权重(整数)|说明|数值效果(可空)　（仅在收到『奖池可更新』指令时才用，一次给全套3-5个）\n';
  out += '</origin>\n';
  out += '规则：任务id用上面列出的数字；没有对应内容就不写该行；完全无变化则输出 <origin>无</origin>。新任务的各字段请用「标签:值」写（如 奖励:积分300、时限:8）；描述与条件里不得出现竖线 |。\n';

  if(out.length > s.budget){ const cut = out.lastIndexOf('\n', s.budget); out = out.slice(0, cut>0?cut:s.budget); }
  return out;
}

function onPromptReady(ev){
  try{
    const s = settings(); if(!s.enabled) return;
    if(!ev || ev.dryRun || !Array.isArray(ev.chat)) return;
    const val = buildInjection(); if(!val) return;
    const msg = { role:'system', content: val };
    const last = ev.chat[ev.chat.length-1];
    if(last && last.role==='user' && /^[\s​‌‍﻿]*$/.test(String(last.content||'')))
      ev.chat.splice(ev.chat.length-1, 0, msg);
    else ev.chat.push(msg);
    try{ const st=meta(); if(st && ((st.pendingUse&&st.pendingUse.length)||(st.pendingEvent&&st.pendingEvent.length))){ st.pendingUse=[]; st.pendingEvent=[]; saveMeta(); } }catch(_){}
  }catch(e){ console.error('[Origin] 注入失败', e); }
}

// ---------- 判定收块（模式A：解析AI回复里的 <origin> 块） ----------
const BLK = /<origin>([\s\S]*?)<\/origin>\s*/gi;
function cleanNum(x){ const n = parseInt(String(x).replace(/[^0-9-]/g,''),10); return isNaN(n)?0:n; }
function findTask(st,idOrTitle){ const d=String(idOrTitle==null?'':idOrTitle).replace(/[^0-9]/g,''); if(d!==''){ const t=st.tasks.find(x=>String(x.id)===d); if(t) return t; } const q=String(idOrTitle==null?'':idOrTitle).trim(); if(!q) return undefined; return st.tasks.find(x=>x.status==='active' && (x.title===q || q.indexOf(x.title)>=0 || (x.title&&x.title.indexOf(q)>=0))); }
function applyEffects(st, str, sign){
  // 解析 "积分300 魅力+2 好感-10" 之类，sign=+1奖励 / -1惩罚（惩罚里已带符号则尊重）
  if(!str) return;
  let m;
  const reP = /积分\s*([+-]?\d+)/g; while((m=reP.exec(str))) st.points += cleanNum(m[1])*(m[1].match(/^[+-]/)?1:sign>=0?1:-1);
  const reS = /([一-龥A-Za-z·]{1,8}?)\s*([+-]\d+)/g;
  while((m=reS.exec(str))){
    const name=m[1].trim(); if(name==='积分'||!name) continue;
    let st2 = st.stats.find(x=>x.name===name);
    if(!st2){ st2={name,val:0}; st.stats.push(st2); }
    st2.val += cleanNum(m[2]);
  }
}
function pushLog(st,text,mark){ st.log.push({text, mark:mark||''}); if(st.log.length>40) st.log=st.log.slice(-40); }
function doneCount(st){ return st.tasks.filter(t=>t.status==='done').length; }
function hasAch(st,id){ return (st.achievements||[]).some(a=>a.id===id); }
function unlockAch(st,id,name,desc,bonus){ if(hasAch(st,id)) return false; st.achievements=st.achievements||[]; if(st.achievements.some(a=>a.name===name)) return false; st.achievements.push({id,name,desc:desc||''}); if(bonus) st.points+=bonus; st.pendingEvent=st.pendingEvent||[]; st.pendingEvent.push('宿主解锁成就「'+name+'」'+(desc?'（'+desc+'）':'')+(bonus?'，奖励积分'+bonus:'')); pushLog(st,'解锁成就「'+name+'」'+(bonus?'　+'+bonus:''),'★'); return true; }
const ACHIEVEMENTS=[
  {id:'first',name:'初出茅庐',desc:'完成第一个任务',cond:st=>doneCount(st)>=1},
  {id:'five',name:'渐入佳境',desc:'完成5个任务',cond:st=>doneCount(st)>=5},
  {id:'fifteen',name:'任务达人',desc:'完成15个任务',cond:st=>doneCount(st)>=15},
  {id:'rich',name:'腰缠万贯',desc:'积分累积到1000',cond:st=>st.points>=1000},
];
function checkAchievements(){ const st=meta(); if(!st||!settings().achieveOn) return; let ch=false; for(const a of ACHIEVEMENTS){ if(!hasAch(st,a.id) && a.cond(st)){ unlockAch(st,a.id,a.name,a.desc,50); ch=true; } } if(ch){ saveMeta(); renderPanel(); } }


function completeTask(st,t){ if(!t||t.status!=='active') return; t.status='done'; t.progress=100; applyEffects(st,t.reward,1); const gain=t.type==='主线'?50:t.type==='支线'?20:10; st.exp+=gain; while(st.exp>=st.expMax){ st.exp-=st.expMax; st.level++; st.expMax=Math.round(st.expMax*1.4); } pushLog(st,'完成「'+t.title+'」'+(t.reward?'　奖励：'+t.reward:''),'✓'); }
function applyBlock(memo){
  const st = meta(); if(!st) return;
  st.lastRaw = memo;
  const lines = memo.split('\n').map(l=>l.trim()).filter(l=>l && l!=='无');
  let changed = 0, gotNew=false, _newG=[];
  for(const line of lines){
    const p = line.split('|').map(x=>x.trim());
    const tag = p[0];
    if(tag==='进度'){ const t=findTask(st,p[1]); if(t){ t.progress=Math.max(0,Math.min(100,cleanNum(p[2]))); if(p[3]) pushLog(st,t.title+'：'+p[3]); if(t.status==='active' && t.progress>=100){ completeTask(st,t); } changed++; } }
    else if(tag==='完成'){ const t=findTask(st,p[1]); if(t && t.status==='active'){ completeTask(st,t); changed++; } }
    else if(tag==='失败'){ const t=findTask(st,p[1]); if(t && t.status==='active'){ t.status='failed'; applyEffects(st,t.penalty,-1); pushLog(st,'任务「'+t.title+'」失败'+(t.penalty?'　'+t.penalty:''),'!'); if(settings().punishEvent){ st.pendingEvent=st.pendingEvent||[]; st.pendingEvent.push('任务「'+t.title+'」失败'+(t.penalty?'（'+t.penalty+'）':'')+'，请让剧情出现一个相称的不利后果'+(settings().penaltyPref?'（后果倾向：'+settings().penaltyPref+'）':'')); } changed++; } }
    else if(tag==='新任务'){
      const fields={}; let hasLabel=false;
      for(let i=1;i<p.length;i++){ const mm=String(p[i]||'').match(/^\s*(类型|标题|名称|描述|说明|完成条件|条件|奖励|失败惩罚|惩罚|时限|对象|归属|奖|罚)\s*[：:]\s*([\s\S]*)$/); if(mm){ fields[mm[1]]=mm[2].trim(); hasLabel=true; } }
      const g=(...ks)=>{ for(const k of ks){ if(fields[k]!=null && fields[k]!=='') return fields[k]; } return ''; };
      let ty,title,desc,cond,reward,penalty,lim;
      if(hasLabel){ ty=g('类型'); title=g('标题','名称')||'未命名'; desc=g('描述','说明'); cond=g('完成条件','条件'); reward=g('奖励'); penalty=g('失败惩罚','惩罚','罚'); lim=cleanNum(g('时限')); }
      else { ty=p[1]; title=p[2]||'未命名'; desc=p[3]||''; cond=p[4]||''; reward=p[5]||''; penalty=p[6]||''; lim=p[7]?cleanNum(p[7]):0; }
      if(!lim){ const _m=line.match(/时限\s*[：:]?\s*(\d+)/); if(_m) lim=parseInt(_m[1],10)||0; }
      if(!['主线','支线','日常'].includes(ty)) ty='支线';
      const t={ id:st.nextId++, type:ty, owner:((fields['对象']||fields['归属']|| (settings().bindTo&&settings().bindTo!=='宿主'?settings().bindTo:'宿主')).trim()||'宿主'), title, desc, cond, reward, penalty, limit:lim, progress:0, status:'active', turn:curTurn(), startTurn:curTurn() };
      st.tasks.push(t); st.lastTaskTurn=curTurn(); gotNew=true; pushLog(st,'新任务['+t.type+']「'+t.title+'」','·'); changed++; }
    else if(tag==='积分'){ st.points += cleanNum(p[1]); if(p[2]) pushLog(st,'积分'+p[1]+'（'+p[2]+'）'); changed++; }
    else if(tag==='属性'){ let s2=st.stats.find(x=>x.name===p[1]); if(!s2){ s2={name:p[1],val:0}; st.stats.push(s2);} s2.val+=cleanNum(p[2]); changed++; }
    else if(tag==='新奖品'){ const nm=p[1]; if(nm){ _newG.push({name:nm,tier:(p[2]||'R'),weight:cleanNum(p[3])||10,desc:p[4]||'',effect:(p[5]||'')}); } }
    else if(tag==='新商品'){ const nm=p[1]; if(nm){ const it={name:nm,price:cleanNum(p[2])||300,desc:p[3]||'',effect:(p[4]||'')}; const ex=st.shop.find(x=>x.name===nm); if(ex) Object.assign(ex,it); else st.shop.push(it); if(st.shop.length>12) st.shop=st.shop.slice(-12); st.lastShopTurn=curTurn(); changed++; } }
    else if(tag==='获得'){ const nm=p[1]; if(nm){ const c=cleanNum(p[2])||1; const ex=st.bag.find(b=>b.name===nm); if(ex) ex.count=(ex.count||1)+c; else st.bag.push({name:nm,count:c,desc:p[3]||'',effect:''}); pushLog(st,'获得物品「'+nm+'」×'+c,'·'); changed++; } }
    else if(tag==='买'||tag==='购买'){ const nm=p[1]; if(nm){ let it=st.shop.find(x=>x.name===nm); if(!it) it=st.shop.find(x=>nm.indexOf(x.name)>=0||x.name.indexOf(nm)>=0); if(it && st.points>=it.price){ st.points-=it.price; const ex=st.bag.find(b=>b.name===it.name); if(ex) ex.count=(ex.count||1)+1; else st.bag.push({name:it.name,count:1,desc:it.desc,effect:it.effect||''}); pushLog(st,'（角色）购买「'+it.name+'」(-'+it.price+')','·'); changed++; } } }
    else if(tag==='抽奖'){ const pk=drawCore(st,false); if(pk){ st.pendingEvent=st.pendingEvent||[]; st.pendingEvent.push('抽奖抽中了'+(pk.tier?pk.tier+'级':'')+'「'+pk.name+'」'+(pk.desc?'（'+pk.desc+'）':'')+'，请把开箱那一刻写进正文'); changed++; } }
    else if(tag==='用道具'||tag==='消耗'){ const nm=p[1]; if(nm){ let b=st.bag.find(x=>x.name===nm); if(!b) b=st.bag.find(x=>nm.indexOf(x.name)>=0||x.name.indexOf(nm)>=0); if(b){ b.count=(b.count||1)-(cleanNum(p[2])||1); if(b.count<=0) st.bag.splice(st.bag.indexOf(b),1); pushLog(st,'消耗物品「'+nm+'」','·'); changed++; } } }
    else if(tag==='播报'){ pushLog(st, p.slice(1).join('｜'),'“'); changed++; }
    else if(tag==='成就'){ if(unlockAch(st,'m_'+(p[1]||''),p[1]||'成就',p[2]||'',100)) changed++; }
  }
  if(_newG.length){ st.gachaPool=_newG; st.lastGachaTurn=curTurn(); changed++; }
  if(changed){ saveMeta(); renderPanel(); markNew(true); }
  checkAchievements();
}

function harvest(mesId){
  const s = settings(); if(!s.enabled) return;
  const ctx = getContext(); const chat = ctx.chat||[];
  const idx = (mesId!=null && chat[mesId]) ? mesId : chat.length-1;
  const m = chat[idx];
  if(!m || m.is_user || m.is_system) return;
  if(!m.extra) m.extra={};
  m.extra.originBlocks = m.extra.originBlocks || {};
  const sidx = (typeof m.swipe_id==='number') ? m.swipe_id : 0;
  const text = m.mes || '';
  let memo=null, mm, re=new RegExp(BLK.source,'gi');
  while((mm=re.exec(text))!==null) memo=mm[1];
  if(memo!==null){
    m.extra.originBlocks[sidx] = memo.trim();
    m.mes = text.replace(new RegExp(BLK.source,'gi'),'').trimEnd();
    try{ ctx.updateMessageBlock?.(idx, m); }catch(e){}
  }
  let base=null;
  for(let i=idx-1;i>=0;i--){ const pm=chat[i]; if(pm && !pm.is_user && !pm.is_system && pm.extra && pm.extra.originSnap){ base=pm.extra.originSnap; break; } }
  if(!base){ if(m.extra.originBase===undefined){ const _mm=ctx.chatMetadata??ctx.chat_metadata; m.extra.originBase=(_mm&&_mm[MOD])?JSON.stringify(_mm[MOD]):null; } base=m.extra.originBase; }
  if(base){ try{ (ctx.chatMetadata??ctx.chat_metadata)[MOD]=JSON.parse(base); }catch(_){}}
  const block=m.extra.originBlocks[sidx];
  if(block && block!=='无') applyBlock(block);
  snapshot();
  renderPanel();
}

// =================== 悬浮 UI ===================
let curTab='task';
let genBusy=false, genBusyAt=0;
function markNew(v){ const orb=document.getElementById('origin-orb'); if(orb) orb.classList.toggle('has-new', !!v); }

function mountUI(){
  if(document.getElementById('origin-root')) return;
  const s = settings();
  const root = document.createElement('div'); root.id='origin-root'; if(s.night) root.classList.add('night');
  root.style.setProperty('--o-acc', s.accent||'#b0684c');
  const orb = document.createElement('div'); orb.id='origin-orb';
  orb.innerHTML='<div class="o-ring"><i></i></div><div class="o-dot"></div>';
  const panel = document.createElement('div'); panel.id='origin-panel'; panel.style.display='none';
  root.appendChild(orb); root.appendChild(panel);
  document.body.appendChild(root);
  // 位置
  let px = s.px!=null?s.px:(window.innerWidth-74), py = s.py!=null?s.py:(window.innerHeight-74);
  px=Math.max(4,Math.min(px, window.innerWidth-54)); py=Math.max(4,Math.min(py, window.innerHeight-54));
  orb.style.left=px+'px'; orb.style.top=py+'px';
  panel.style.left=Math.max(8,Math.min(px, window.innerWidth-342))+'px';
  panel.style.top=Math.max(8, py-380)+'px';

  makeDrag(orb, orb, ()=>openPanel(true));
  if(s.open) openPanel(true);
  try{ restoreFromChat(); }catch(_){}
  if(!s.enabled) root.style.display='none';
  renderPanel();
}
function openPanel(v){ const s=settings(); const p=document.getElementById('origin-panel'), o=document.getElementById('origin-orb'); if(!p)return; p.style.display=v?'block':'none'; o.style.display=v?'none':'flex'; s.open=v; saveS(); if(v){ markNew(false); renderPanel(); } }

function makeDrag(handle, mover, onClick){
  handle.style.touchAction='none';
  handle.addEventListener('pointerdown', e=>{
    if(e.target.closest && e.target.closest('.o-hbtn')) return;
    e.preventDefault();
    let moved=false, raf=0;
    const sx=e.clientX, sy=e.clientY, r=mover.getBoundingClientRect(), ox=r.left, oy=r.top;
    let curX=ox, curY=oy;
    try{ handle.setPointerCapture(e.pointerId); }catch(_){}
    mover.style.cursor='grabbing';
    function apply(){ raf=0; mover.style.left=curX+'px'; mover.style.top=curY+'px'; }
    function mv(ev){ const dx=ev.clientX-sx, dy=ev.clientY-sy; if(Math.abs(dx)+Math.abs(dy)>3) moved=true;
      curX=Math.max(4,Math.min(ox+dx, window.innerWidth-mover.offsetWidth-4));
      curY=Math.max(4,Math.min(oy+dy, window.innerHeight-mover.offsetHeight-4));
      if(!raf) raf=requestAnimationFrame(apply); }
    function up(){ handle.removeEventListener('pointermove',mv); handle.removeEventListener('pointerup',up); if(raf) cancelAnimationFrame(raf);
      mover.style.cursor='grab';
      if(!moved){ if(onClick) onClick(); return; }
      mover.style.left=curX+'px'; mover.style.top=curY+'px';
      const s=settings(); if(mover.id==='origin-orb'){ s.px=curX; s.py=curY; } saveS(); }
    handle.addEventListener('pointermove',mv); handle.addEventListener('pointerup',up);
  });
}

function tab(name,label){ return '<span class="o-tab'+(curTab===name?' on':'')+'" data-tab="'+name+'">'+label+'</span>'; }
function renderPanel(){
  const p=document.getElementById('origin-panel'); if(!p) return; const s=settings(); const st=meta(); if(st) checkExpiry();
  const root=document.getElementById('origin-root'); if(root){ root.classList.toggle('night', !!s.night); root.style.setProperty('--o-acc', s.accent||'#b0684c'); }
  if(!st){ p.innerHTML='<div class="o-head"><div class="o-ring2"><i></i></div><div class="o-name">'+esc(s.sysName)+'</div><span style="flex:1"></span><span class="o-hbtn" data-a="close">－</span></div><div class="o-empty">先打开一个聊天。</div>'; bind(p); return; }
  let h='';
  h+='<div class="o-head" data-drag="1"><div class="o-ring2"><i></i></div><div class="o-name">'+esc(s.sysName)+'</div><span style="flex:1"></span>';
  h+='<span class="o-hbtn" data-a="night" title="日夜">'+(s.night?'☀':'☾')+'</span>';
  h+='<span class="o-hbtn" data-a="set" title="设置">⚙</span>';
  h+='<span class="o-hbtn" data-a="close" title="收起">－</span></div>';
  h+='<div class="o-persona">'+esc(persona())+'</div>';
  h+='<div class="o-meta"><span class="pt">积分 <b>'+st.points+'</b></span><span class="lv">Lv.'+st.level+'</span><span class="o-bar"><i style="width:'+Math.round(st.exp/st.expMax*100)+'%"></i></span></div>';
  h+='<div class="o-world">当前世界 · '+esc(st.world||'未设定')+'</div>';
  if(['stat','bag','shop','gacha','ach'].includes(curTab) && s.mods[curTab]===false) curTab='task';
  let _tabs=tab('task','任务');
  if(s.mods.stat)_tabs+=tab('stat','属性'); if(s.mods.bag)_tabs+=tab('bag','背包'); if(s.mods.shop)_tabs+=tab('shop','商城'); if(s.mods.gacha)_tabs+=tab('gacha','抽奖'); if(s.mods.ach)_tabs+=tab('ach','成就'); _tabs+=tab('log','记录');
  h+='<div class="o-tabs">'+_tabs+'</div>';
  h+='<div class="o-body">';
  if(curTab==='task'){
    const act=st.tasks.filter(t=>t.status==='active');
    if(!act.length) h+='<div class="o-empty">暂无进行中的任务。</div>';
    for(const t of act){
      h+='<div class="o-card"><div class="th"><span class="o-tag tg-'+t.type+'">'+t.type+'</span>'+((t.owner&&t.owner!=='宿主')?'<span class="o-tag" style="background:rgba(120,120,160,.2);color:var(--o-text2)">给'+esc(t.owner)+'</span>':'')+'<span class="o-tt">'+esc(t.title)+'</span>'+(function(){ var r=tRemain(t); return r!==null?'<span style="margin-left:auto;font-size:11px;color:'+(r<=1?'var(--o-fail)':'var(--o-text3)')+'">剩'+Math.max(0,r)+'回合</span>':''; })()+'</div>';
      if(t.desc) h+='<div class="o-desc">'+esc(t.desc)+'</div>';
      h+='<div class="o-prog"><span class="o-bar" style="height:3px"><i style="width:'+(t.progress||0)+'%"></i></span><span style="font-size:11px;color:var(--o-text3)">'+(t.progress||0)+'%</span></div>';
      h+='<div class="o-rp">'+(t.reward?'<span class="rw">奖 · '+esc(t.reward)+'</span>':'')+(t.penalty?'<span class="fl">罚 · '+esc(t.penalty)+'</span>':'')+'</div>';
      h+='<div style="margin-top:6px;text-align:right"><span class="o-mini" data-a="done" data-tid="'+t.id+'">完成</span><span class="o-mini" data-a="edit" data-tid="'+t.id+'">编辑</span><span class="o-mini" data-a="del" data-tid="'+t.id+'">删除</span></div></div>';
    }
    h+='<button class="o-act" data-a="gen">让系统现在派个任务</button>';
    h+='<button class="o-act" data-a="addtask">＋ 手动添加任务</button>';
    h+='<button class="o-act dash" data-a="direction">给个方向让系统出任务</button>';
  } else if(curTab==='stat'){
    if(!st.stats.length) h+='<div class="o-empty">还没有属性。</div>';
    for(let i=0;i<st.stats.length;i++){ const x=st.stats[i]; h+='<div class="o-srow"><span>'+esc(x.name)+'</span><span><span class="v">'+x.val+'</span><span class="x" data-del="'+i+'">✕</span></span></div>'; }
    h+='<button class="o-act dash" data-a="addstat">＋ 自定义属性</button>';
  } else if(curTab==='bag'){
    if(!st.bag.length) h+='<div class="o-empty">背包是空的。</div>';
    for(let i=0;i<st.bag.length;i++){ const b=st.bag[i];
      h+='<div class="o-card"><div class="th"><span class="o-tt">'+esc(b.name)+'</span><span style="color:var(--o-text3);font-size:12px;margin-left:auto">×'+(b.count||1)+'</span></div>';
      if(b.desc) h+='<div class="o-desc">'+esc(b.desc)+'</div>';
      h+='<div style="margin-top:6px;text-align:right"><span class="o-mini" data-a="use" data-bi="'+i+'">使用</span><span class="o-mini" data-a="delbag" data-bi="'+i+'">删除</span></div></div>';
    }
    h+='<button class="o-act dash" data-a="addbag">＋ 添加物品</button>';
  } else if(curTab==='shop'){
    h+='<div class="o-desc" style="margin-bottom:6px">当前积分 <b style="color:var(--o-acc)">'+st.points+'</b></div>';
    h+='<button class="o-act" data-a="shopgen">刷新商城（按世界/方向生成）</button>';
    if(!st.shop.length) h+='<div class="o-empty">商城是空的。</div>';
    for(let i=0;i<st.shop.length;i++){ const it=st.shop[i];
      h+='<div class="o-card"><div class="th"><span class="o-tt">'+esc(it.name)+'</span><span style="color:var(--o-acc);margin-left:auto">'+it.price+'</span></div>';
      if(it.desc) h+='<div class="o-desc">'+esc(it.desc)+'</div>';
      h+='<div style="margin-top:6px;text-align:right"><span class="o-mini" data-a="buy" data-si="'+i+'">购买</span><span class="o-mini" data-a="delshop" data-si="'+i+'">删除</span></div></div>';
    }
    h+='<button class="o-act dash" data-a="addshop">＋ 添加商品</button>';
  } else if(curTab==='gacha'){
    h+='<div class="o-desc" style="margin-bottom:6px">积分 <b style="color:var(--o-acc)">'+st.points+'</b>　单抽 '+s.drawCost+'</div>';
    h+='<button class="o-act" data-a="draw">抽一次（-'+s.drawCost+'积分）</button>';
    const tot=st.gachaPool.reduce((a,b)=>a+(b.weight||0),0)||1;
    h+='<div style="margin-top:8px">';
    for(let i=0;i<st.gachaPool.length;i++){ const g=st.gachaPool[i];
      h+='<div class="o-srow"><span><b style="color:var(--o-acc)">'+esc(g.tier||'')+'</b> '+esc(g.name)+(g.desc?' · '+esc(g.desc):'')+'</span><span><span style="color:var(--o-text3);font-size:11px">'+Math.round((g.weight||0)/tot*100)+'%</span> <span class="x" data-a="delgacha" data-gi="'+i+'">✕</span></span></div>';
    }
    h+='</div><button class="o-act" data-a="gachagen">按世界/方向重出奖池</button><button class="o-act dash" data-a="addgacha">＋ 添加奖品</button>';
  } else if(curTab==='ach'){
    if(!st.achievements || !st.achievements.length) h+='<div class="o-empty">还没有成就。达成里程碑、或剧情高光会解锁。</div>';
    else for(const a of st.achievements){ h+='<div class="o-card"><div class="th"><span class="o-tt">★ '+esc(a.name)+'</span></div>'+(a.desc?'<div class="o-desc">'+esc(a.desc)+'</div>':'')+'</div>'; }
  } else if(curTab==='log'){
    if(!st.log.length) h+='<div class="o-empty">还没有记录。</div>';
    for(let i=st.log.length-1;i>=0;i--){ const l=st.log[i]; h+='<div class="o-lg">'+(l.mark?'<b>'+esc(l.mark)+'</b> ':'')+esc(l.text)+'</div>'; }
  } else if(curTab==='set'){
    h+='<div class="o-desc" style="margin-bottom:6px">世界名/简述</div><input data-i="world" value="'+esc(st.world)+'">';
    h+='<div class="o-desc" style="margin:8px 0 2px">任务频率：每 <b data-fv>'+s.freq+'</b> 回合最多一个</div><input type="range" min="1" max="10" step="1" value="'+s.freq+'" data-i="freq">';
    h+='<div class="o-desc" style="margin:8px 0 2px">任务时限范围（回合，0=不强制）</div><div class="o-row2"><input type="number" data-i="limitMin" value="'+s.limitMin+'" placeholder="最少"><input type="number" data-i="limitMax" value="'+s.limitMax+'" placeholder="最多"></div>';
    h+='<label class="o-desc" style="display:flex;gap:6px;align-items:center;margin:4px 0"><input type="checkbox" style="width:auto;margin:0" data-i="blockWhenUnfinished"'+(s.blockWhenUnfinished?' checked':'')+'>上一个主线/支线没做完就不发新的</label>';
    h+='<div class="o-desc" style="margin:8px 0 2px">任务来源</div><select data-i="taskSource"><option value="auto"'+(s.taskSource==='auto'?' selected':'')+'>自动</option><option value="direction"'+(s.taskSource==='direction'?' selected':'')+'>按我给的方向</option><option value="manual"'+(s.taskSource==='manual'?' selected':'')+'>只手写</option></select>';
    h+='<label class="o-desc" style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="checkbox" style="width:auto;margin:0" data-i="punishEvent"'+(s.punishEvent?' checked':'')+'>任务失败时触发剧情惩罚事件</label>';
    h+='<label class="o-desc" style="display:flex;gap:6px;align-items:center;margin:4px 0"><input type="checkbox" style="width:auto;margin:0" data-i="achieveOn"'+(s.achieveOn?' checked':'')+'>开启成就系统</label>';
    h+='<div class="o-desc" style="margin:8px 0 2px">商城每几回合请模型更新（0=关）</div><input type="number" data-i="shopRefresh" value="'+s.shopRefresh+'">';
    h+='<div class="o-desc" style="margin:8px 0 2px">奖池每几回合请模型更新（0=关）</div><input type="number" data-i="gachaRefresh" value="'+s.gachaRefresh+'">';
    h+='<div class="o-desc" style="margin:10px 0 2px">模块开关</div><div>';
    [['stat','属性'],['bag','背包'],['shop','商城'],['gacha','抽奖'],['ach','成就']].forEach(function(m){ h+='<label class="o-desc" style="display:inline-flex;gap:5px;align-items:center;margin:2px 12px 2px 0"><input type="checkbox" style="width:auto;margin:0" data-i="mod_'+m[0]+'"'+(s.mods[m[0]]!==false?' checked':'')+'>'+m[1]+'</label>'; });
    h+='</div>';
    h+='<div class="o-desc" style="margin:8px 0 2px">奖励偏好（生成任务时参考，如：多给道具/偏情感向）</div><input data-i="rewardPref" value="'+esc(s.rewardPref)+'">';
    h+='<div class="o-desc" style="margin:8px 0 2px">惩罚偏好（如：不要动好感度/惩罚偏物质）</div><input data-i="penaltyPref" value="'+esc(s.penaltyPref)+'">';
    h+='<div class="o-desc" style="margin:8px 0 2px">第四面墙几率：<b data-wv>'+s.fourthWall+'</b>%</div><input type="range" min="0" max="100" step="5" value="'+s.fourthWall+'" data-i="fourthWall">';
    h+='<div class="o-desc" style="margin:8px 0 2px">单次抽奖消耗积分</div><input type="number" data-i="drawCost" value="'+s.drawCost+'">';
    h+='<div class="o-desc" style="margin:8px 0 2px">系统绑定对象（填「宿主」=给你派；填角色名=反串，系统归该角色、你旁观）</div><input data-i="bindTo" value="'+esc(s.bindTo)+'">';
    h+='<label class="o-desc" style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="checkbox" style="width:auto;margin:0" data-i="autoEcon"'+(s.autoEcon?' checked':'')+'>允许角色自主用系统（买/抽奖/用道具·反串模式默认开）</label>';
    h+='<div class="o-desc" style="margin:8px 0 2px">系统名</div><input data-i="sysName" value="'+esc(s.sysName)+'">';
    h+='<div class="o-desc" style="margin:8px 0 2px">人格腔调</div><select data-i="personality"><option>冷澈</option><option>毒舌</option><option>傲娇</option><option>温和</option></select>';
    h+='<div class="o-desc" style="margin:8px 0 2px">自定义人格（填了就覆盖上面）</div><textarea data-i="personaText" rows="2">'+esc(s.personaText)+'</textarea>';
    h+='<div class="o-desc" style="margin:8px 0 2px">主色</div><input data-i="accent" value="'+esc(s.accent)+'">';
    h+='<button class="o-act" data-a="reset" style="border-color:var(--o-fail);color:var(--o-fail);margin-top:10px">清空本局存档</button>';
  }
  h+='</div>';
  p.innerHTML=h;
  const sel=p.querySelector('select[data-i="personality"]'); if(sel) sel.value=s.personality;
  bind(p);
}

function bind(p){
  const s=settings(), st=meta();
  const head=p.querySelector('.o-head'); if(head) makeDrag(head, document.getElementById('origin-panel'), null);
  p.querySelectorAll('.o-tab').forEach(t=>t.onclick=()=>{ curTab=t.getAttribute('data-tab'); renderPanel(); });
  p.querySelectorAll('[data-a]').forEach(el=>el.onclick=()=>action(el.getAttribute('data-a'), el));
  p.querySelectorAll('[data-del]').forEach(el=>el.onclick=()=>{ st.stats.splice(+el.getAttribute('data-del'),1); saveMeta(); renderPanel(); });
  p.querySelectorAll('[data-i]').forEach(el=>{
    const k=el.getAttribute('data-i');
    const ev = (el.type==='range')?'input':'change';
    el.addEventListener(ev, ()=>{
      if(k.indexOf('mod_')===0){ s.mods=s.mods||{}; s.mods[k.slice(4)]=el.checked; saveS(); renderPanel(); return; }
      let v = el.type==='checkbox'?el.checked:el.value;
      if(el.type==='range'||el.type==='number') v=parseInt(v,10)||0;
      if(k==='world'){ st.world=v; saveMeta(); const wv=p.querySelector('.o-world'); }
      else { s[k]=v; saveS(); }
      if(k==='freq'){ const b=p.querySelector('[data-fv]'); if(b)b.textContent=v; }
      if(k==='fourthWall'){ const b=p.querySelector('[data-wv]'); if(b)b.textContent=v; }
      if(['accent','night','sysName','personality','personaText'].includes(k)) renderPanel();
    });
  });
}

function drawCore(st, free){
  const s=settings();
  if(!st.gachaPool || !st.gachaPool.length) return null;
  if(!free){ if(st.points < s.drawCost) return null; st.points-=s.drawCost; }
  const tot=st.gachaPool.reduce((a,b)=>a+(b.weight||0),0); let r=Math.random()*tot, pick=st.gachaPool[0];
  for(const g of st.gachaPool){ r-=(g.weight||0); if(r<=0){ pick=g; break; } }
  const ex=st.bag.find(b=>b.name===pick.name); if(ex) ex.count=(ex.count||1)+1; else st.bag.push({name:pick.name,count:1,desc:pick.desc||'',effect:pick.effect||''});
  if(pick.tier==='SSR'||pick.tier==='UR') unlockAch(st,'lucky','欧皇附体','抽到 SSR 及以上',0);
  pushLog(st,'抽奖 → '+(pick.tier?'['+pick.tier+']':'')+pick.name+'（入背包）','★');
  return pick;
}
function drawGacha(free){
  const st=meta(); if(!st) return;
  if(!st.gachaPool || !st.gachaPool.length){ try{ toastr.warning('Origin：奖池是空的'); }catch(_){}; return; }
  if(!free && st.points < settings().drawCost){ try{ toastr.warning('Origin：积分不够（需'+settings().drawCost+'）'); }catch(_){}; return; }
  const pick=drawCore(st, free); saveMeta(); renderPanel();
  if(pick){ try{ toastr.info('Origin：抽中「'+pick.name+'」，已放入背包'); }catch(_){} }
}
function editTask(id){
  const st=meta(); if(!st) return; const t=st.tasks.find(x=>String(x.id)===String(id)); if(!t) return;
  let v;
  v=prompt('标题', t.title); if(v===null) return; if(v.trim()) t.title=v.trim();
  v=prompt('类型（主线/支线/日常）', t.type); if(v && ['主线','支线','日常'].includes(v.trim())) t.type=v.trim();
  v=prompt('描述', t.desc); if(v!==null) t.desc=v;
  v=prompt('完成条件', t.cond); if(v!==null) t.cond=v;
  v=prompt('奖励（例：积分300 魅力+2）', t.reward); if(v!==null) t.reward=v;
  v=prompt('失败惩罚（可空）', t.penalty); if(v!==null) t.penalty=v;
  v=prompt('对象（宿主/角色名）', t.owner||'宿主'); if(v!==null && v.trim()) t.owner=v.trim();
  v=prompt('时限（回合数，0=不限）', String(t.limit||0)); if(v!==null){ const n=parseInt(v,10); if(!isNaN(n)){ t.limit=Math.max(0,n); if(t.limit>0 && !t.startTurn) t.startTurn=curTurn(); } }
  v=prompt('进度 %（0-100）', String(t.progress||0)); if(v!==null){ const n=parseInt(v,10); if(!isNaN(n)) t.progress=Math.max(0,Math.min(100,n)); }
  saveMeta(); renderPanel();
}
async function genGacha(){
  const ctx=getContext(), st=meta(); if(!st) return; if(genBusy && Date.now()-genBusyAt<60000) return; genBusy=true; genBusyAt=Date.now();
  try{
    let cd=''; try{ const c=(ctx.characters||[])[ctx.characterId]; if(c) cd=String(c.description||'').slice(0,300); }catch(_){}
    const dir = st.direction ? ('宿主玩法方向：'+st.direction+'。') : '';
    const prompt='【抽奖奖池生成】为一个穿越系统的抽奖，生成 5 件贴合下面世界观与宿主玩法方向的奖品，从常见到稀有都要有。'+dir+'\n每件一行，严格格式，不要多余文字、不要解释：\n奖品|名称|稀有度(N/R/SR/SSR/UR)|权重(整数,越大越常出,如N=50 UR=1)|说明|数值效果(可空,例 积分+200 或 好感+30)\n\n【世界】'+(st.world||'未定')+'\n【角色】'+cd;
    try{ toastr.info('Origin：正在重出奖池…'); }catch(_){}
    let out=''; try{ out=await ctx.generateQuietPrompt(prompt); }catch(e){ try{ out=await ctx.generateRaw({prompt}); }catch(e2){ try{ out=await ctx.generateRaw(prompt,'',false,false); }catch(e3){} } }
    try{ st.lastGenRaw=String(out||'').slice(0,1500); saveMeta(); }catch(_){}
    const SL=x=>String(x||'').replace(/^(名称|稀有度|权重|说明|效果|奖品)\s*[：:]\s*/,'').trim();
    const items=[]; String(out||'').split('\n').forEach(function(l){ l=l.replace(/｜/g,'|').replace(/^[\s\d.、)）*_>\-]+/,'').trim(); if(l.indexOf('奖品|')===0){ const p=l.split('|').map(x=>x.trim()); if(p[1]) items.push({name:SL(p[1]),tier:SL(p[2])||'R',weight:parseInt(SL(p[3]),10)||10,desc:SL(p[4]),effect:(SL(p[5])&&SL(p[5])!=='无')?SL(p[5]):''}); } });
    if(items.length){ st.gachaPool=items; pushLog(st,'奖池已重出（'+items.length+'件）','·'); saveMeta(); renderPanel(); try{ toastr.info('Origin：奖池已刷新'); }catch(_){}} 
    else { try{ toastr.warning('Origin：重出失败，重试'); }catch(_){}; console.log('[Origin] genGacha:', out); }
  } finally { genBusy=false; }
}
async function genShop(){
  const ctx=getContext(), st=meta(), s=settings(); if(!st) return; if(genBusy && Date.now()-genBusyAt<60000) return; genBusy=true; genBusyAt=Date.now();
  try{
    let cd=''; try{ const c=(ctx.characters||[])[ctx.characterId]; if(c) cd=String(c.description||'').slice(0,300); }catch(_){}
    const dir = st.direction ? ('宿主玩法方向：'+st.direction+'。') : '';
    const prompt='【商城生成】为一个穿越系统的积分商城，生成 5 件贴合下面世界观与宿主玩法方向的商品（其中含 1 件作弊/特权类）。'+dir+'\n每件一行，严格格式，不要多余文字、不要解释：\n商品|名称|价格(整数积分)|说明|数值效果(可空,例 魅力+10)\n\n【世界】'+(st.world||'未定')+'\n【角色】'+cd;
    try{ toastr.info('Origin：正在刷新商城…'); }catch(_){}
    let out=''; try{ out=await ctx.generateQuietPrompt(prompt); }catch(e){ try{ out=await ctx.generateRaw({prompt}); }catch(e2){ try{ out=await ctx.generateRaw(prompt,'',false,false); }catch(e3){} } }
    try{ st.lastGenRaw=String(out||'').slice(0,1500); saveMeta(); }catch(_){}
    const SL=x=>String(x||'').replace(/^(名称|价格|说明|效果|商品)\s*[：:]\s*/,'').trim();
    const items=[]; String(out||'').split('\n').forEach(function(l){ l=l.replace(/｜/g,'|').replace(/^[\s\d.、)）*_>\-]+/,'').trim(); if(l.indexOf('商品|')===0){ const p=l.split('|').map(x=>x.trim()); if(p[1]) items.push({name:SL(p[1]),price:parseInt(SL(p[2]),10)||300,desc:SL(p[3]),effect:(SL(p[4])&&SL(p[4])!=='无')?SL(p[4]):''}); } });
    if(items.length){ st.shop=items; st.lastShopTurn=curTurn(); pushLog(st,'商城已刷新（'+items.length+'件）','·'); saveMeta(); renderPanel(); try{ toastr.info('Origin：商城已刷新'); }catch(_){}} 
    else { try{ toastr.warning('Origin：刷新失败，重试'); }catch(_){}; console.log('[Origin] genShop:', out); }
  } finally { genBusy=false; }
}
async function genTask(){
  const ctx=getContext(), st=meta(), s=settings(); if(!st) return;
  if(genBusy && Date.now()-genBusyAt<60000){ return; } genBusy=true; genBusyAt=Date.now();
  try{
    const dir = st.direction ? ('任务方向：'+st.direction+'。') : '贴合当前剧情。';
    const limHint = s.limitMax>0 ? ('若设时限，请在 '+s.limitMin+'-'+s.limitMax+' 回合内浮动取值，不紧急可不设。') : '';
    const rewardPref = s.rewardPref ? ('奖励偏好：'+s.rewardPref+'。') : '';
    const penPref = s.penaltyPref ? ('惩罚偏好：'+s.penaltyPref+'。') : '';
    let cd=''; try{ const c=(ctx.characters||[])[ctx.characterId]; if(c) cd=String(c.description||'').slice(0,400); }catch(_){}
    const recent=(ctx.chat||[]).filter(m=>!m.is_system).slice(-4).map(m=>(m.is_user?'我：':'')+(m.mes||'')).join('\n').slice(-900);
    const parts=[];
    if(st.world) parts.push('【世界】'+st.world);
    if(cd) parts.push('【角色设定】'+cd);
    parts.push('【最近剧情】\n'+(recent||'（暂无，请出一个开场任务）'));
    const prompt='【系统任务生成】你是这个世界的系统，要贴着上面的世界观与角色，为宿主(user)生成 1 个新任务，'+dir+rewardPref+limHint+'\n'
      +'奖励必须是对宿主有利的（加积分/加属性/加好感/给道具）；失败惩罚是不利的，可以是扣积分/掉属性/失去道具/触发不利事件，按剧情选，不必总扣好感，也可留空。'+penPref+'\n'
      +'只输出一行，严格用这个格式，不要任何多余文字、不要解释、不要思维链：\n新任务|类型:主线或支线或日常|标题:…|描述:…|条件:…|奖励:…|惩罚:…|时限:数字\n每个字段用「标签:值」写清楚，缺的整段不写。\n\n'+parts.join('\n');
    try{ toastr.info('Origin：正在生成任务…'); }catch(_){}
    let out='';
    try{ out=await ctx.generateQuietPrompt(prompt); }
    catch(e){ try{ out=await ctx.generateRaw({prompt}); }catch(e2){ try{ out=await ctx.generateRaw(prompt,'',false,false); }catch(e3){ console.error('[Origin] 生成失败',e3); } } }
    let line=String(out||'').split('\n').map(l=>l.trim()).find(l=>l.indexOf('新任务|')===0);
    if(!line){ const mm=String(out||'').match(/新任务\|[^\n]+/); if(mm) line=mm[0]; }
    if(line){ applyBlock(line); curTab='task'; renderPanel(); try{ toastr.info('Origin：任务已派发'); }catch(_){}} 
    else { try{ toastr.warning('Origin：没生成出来，再点一次或手动添加'); }catch(_){}; console.log('[Origin] genTask原始输出:', out); }
  } finally { genBusy=false; }
}
function action(a, el){
  const s=settings(), st=meta();
  if(a==='close') openPanel(false);
  else if(a==='night'){ s.night=!s.night; saveS(); renderPanel(); }
  else if(a==='set'){ curTab='set'; renderPanel(); }
  else if(a==='use'){ const b=st.bag[+el.getAttribute('data-bi')]; if(b){ const isTicket=/签|抽奖/.test(b.name); b.count=(b.count||1)-1; if(b.count<=0) st.bag.splice(st.bag.indexOf(b),1); if(isTicket){ pushLog(st,'使用「'+b.name+'」抽奖','·'); saveMeta(); drawGacha(true); } else { if(b.effect) applyEffects(st,b.effect,1); st.pendingUse=st.pendingUse||[]; st.pendingUse.push({name:b.name, desc:b.effect||b.desc||''}); pushLog(st,'使用道具「'+b.name+'」','·'); saveMeta(); renderPanel(); try{ toastr.info('Origin：已使用「'+b.name+'」，下一回合剧情会回应'); }catch(_){}} } }
  else if(a==='delbag'){ st.bag.splice(+el.getAttribute('data-bi'),1); saveMeta(); renderPanel(); }
  else if(a==='addbag'){ const n=prompt('物品名'); if(n){ const c=parseInt(prompt('数量','1')||'1',10)||1; const d=prompt('说明（可空）','')||''; st.bag.push({name:n.trim(),count:c,desc:d,effect:''}); saveMeta(); renderPanel(); } }
  else if(a==='buy'){ const it=st.shop[+el.getAttribute('data-si')]; if(it){ if(st.points<it.price){ try{ toastr.warning('Origin：积分不够（需'+it.price+'）'); }catch(_){}} else { st.points-=it.price; const ex=st.bag.find(b=>b.name===it.name); if(ex) ex.count=(ex.count||1)+1; else st.bag.push({name:it.name,count:1,desc:it.desc,effect:it.effect||''}); pushLog(st,'购买「'+it.name+'」(-'+it.price+')','·'); saveMeta(); renderPanel(); try{ toastr.info('Origin：已购入「'+it.name+'」，去背包使用'); }catch(_){}} } }
  else if(a==='delshop'){ st.shop.splice(+el.getAttribute('data-si'),1); saveMeta(); renderPanel(); }
  else if(a==='addshop'){ const n=prompt('商品名'); if(n){ const pr=parseInt(prompt('价格(积分)','300')||'300',10)||300; const d=prompt('说明','')||''; const ef=prompt('数值效果(可空，例 魅力+10 / 好感+20)','')||''; st.shop.push({name:n.trim(),price:pr,desc:d,effect:ef.trim()}); saveMeta(); renderPanel(); } }
  else if(a==='addstat'){ const n=prompt('属性名（如 魅力/体魄/好感）'); if(n){ const v=parseInt(prompt('初始值','0')||'0',10)||0; st.stats.push({name:n.trim(),val:v}); saveMeta(); renderPanel(); } }
  else if(a==='addtask'){ const title=prompt('任务标题'); if(!title)return; const type=(prompt('类型：主线/支线/日常','支线')||'支线').trim(); const desc=prompt('一句描述','')||''; const cond=prompt('完成条件','')||''; const reward=prompt('奖励（如 积分300 魅力+2）','')||''; const penalty=prompt('失败惩罚（可空）','')||''; const limit=parseInt(prompt('时限（几回合内完成，0=不限）','0')||'0',10)||0; const owner=(prompt('对象（宿主 / 或某角色名）','宿主')||'宿主').trim()||'宿主'; st.tasks.push({id:st.nextId++,type:['主线','支线','日常'].includes(type)?type:'支线',owner,title:title.trim(),desc,cond,reward,penalty,limit,progress:0,status:'active',turn:curTurn(),startTurn:curTurn()}); st.lastTaskTurn=curTurn(); pushLog(st,'手动添加任务「'+title.trim()+'」','·'); saveMeta(); curTab='task'; renderPanel(); }
  else if(a==='gen'){ genTask(); }
  else if(a==='shopgen'){ genShop(); }
  else if(a==='gachagen'){ genGacha(); }
  else if(a==='draw'){ drawGacha(false); }
  else if(a==='delgacha'){ st.gachaPool.splice(+el.getAttribute('data-gi'),1); saveMeta(); renderPanel(); }
  else if(a==='addgacha'){ const n=prompt('奖品名'); if(n){ const tier=(prompt('稀有度(N/R/SR/SSR/UR)','R')||'R').trim(); const w=parseInt(prompt('权重(越大越常出)','20')||'20',10)||20; const d=prompt('说明','')||''; const ef=prompt('数值效果(可空，例 积分+200 / 好感+30)','')||''; st.gachaPool.push({name:n.trim(),tier,weight:w,desc:d,effect:ef.trim()}); saveMeta(); renderPanel(); } }
  else if(a==='edit'){ editTask(el.getAttribute('data-tid')); }
  else if(a==='done'){ const st2=meta(); const t=st2&&st2.tasks.find(x=>String(x.id)===String(el.getAttribute('data-tid'))); if(t&&t.status==='active'){ if(confirm('把「'+t.title+'」标记为完成并发奖？')){ applyBlock('完成|'+t.id); } } }
  else if(a==='del'){ const st2=meta(); const i=st2?st2.tasks.findIndex(x=>String(x.id)===String(el.getAttribute('data-tid'))):-1; if(i>=0 && confirm('删除任务「'+st2.tasks[i].title+'」？')){ st2.tasks.splice(i,1); saveMeta(); renderPanel(); } }
  else if(a==='direction'){ const d=prompt('你希望下一个任务大概是什么方向？（例：一个复仇任务 / 让他吃醋）', st.direction||''); if(d!=null){ st.direction=d.trim(); s.taskSource='direction'; saveS(); saveMeta(); toastr?.info?.('Origin：方向已记下，下次允许发任务时用它'); } }
  else if(a==='reset'){ if(confirm('清空本局 Origin 存档？任务/积分/属性/记录都会没。')){ const ctx=getContext(); const m=ctx.chatMetadata??ctx.chat_metadata; if(m){ delete m[MOD]; } meta(); saveMeta(); curTab='task'; renderPanel(); } }
}

function onChanged(){ restoreFromChat(); curTab='task'; renderPanel(); }

jQuery(async ()=>{
  try{ mountUI(); }catch(e){ console.error('[Origin] UI挂载失败', e); }
  if(event_types.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
  eventSource.on(event_types.MESSAGE_RECEIVED, harvest);
  eventSource.on(event_types.CHAT_CHANGED, onChanged);
  if(event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, harvest);
  // 设置面板入口（酒馆扩展设置里）
  try{
    const html='<div class="origin-settings"><div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Origin 系统</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input id="origin_enabled" type="checkbox"> 启用 Origin</label><small>面板在屏幕上那颗悬浮球，拖动、点开。详细设置在面板里的⚙。</small></div></div></div>';
    $('#extensions_settings').append(html);
    $('#origin_enabled').prop('checked', settings().enabled).on('change', function(){ settings().enabled=this.checked; saveS(); var r=document.getElementById('origin-root'); if(r) r.style.display=this.checked?'':'none'; });
  }catch(e){}
  console.log('[Origin] 已加载');
});
