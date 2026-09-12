import{aggregate,monthly,monthRange,marketsFor}from'./engine.js';
const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=2)=>x.toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=x=>`${fmt(x,3)}%`,money=x=>x>=1e12?`${fmt(x/1e12)} 兆`:`${fmt(x/1e8)} 億`;
const kindName={group:'經紀合計',head:'總公司營業單位',branch:'分公司'};
let manifest,closures=[],reports=[],market='both',mode='bars',version=0,range=[],viewRows=[],groupRows=[],total=0;
const cache=new Map();
async function json(path){const r=await fetch(path);if(!r.ok)throw Error(`資料讀取失敗（${r.status}），請重新整理後再試。`);return r.json();}
function setStatus(message,error=false){$('#status').textContent=message;$('#status').className=error?'error':'';}
function option(code,name){return`<option value="${esc(code)}">${esc(name)}${code?' · '+esc(code):''}</option>`;}
function selectedName(){return $('#broker').selectedOptions[0]?.textContent.split(' · ')[0]||'';}
function availability(row){return marketsFor(market).map(m=>`${m==='twse'?'上市':'上櫃'} ${row.seen[m].size}/${range.length}`).join(' · ');}
function isComplete(row){return marketsFor(market).every(m=>row.seen[m].size===range.length);}
async function query(){
 const ticket=++version;$('#results').hidden=true;setStatus('正在載入及核對所選期間…');
 try{
  const months=monthRange($('#from').value,$('#to').value),wanted=marketsFor(market);
  const missing=months.filter(m=>!wanted.every(k=>manifest.months[m]?.includes(k)));
  if(missing.length)throw Error(`以下月份尚未有完整${market==='both'?'雙市場':''}資料：${missing.join('、')}。請調整範圍；缺失資料不以零代替。`);
  const paths=months.flatMap(m=>wanted.map(k=>`data/months/${m}-${k}.json`));
  // Bound concurrency for long historical ranges.
  let loaded=[];
  for(let i=0;i<paths.length;i+=8){loaded.push(...await Promise.all(paths.slice(i,i+8).map(async p=>{if(!cache.has(p))cache.set(p,await json(p));return cache.get(p);})));if(ticket!==version)return;}
  if(ticket!==version)return;
  reports=loaded.sort((a,b)=>a.month.localeCompare(b.month)||a.market.localeCompare(b.market));range=months;
  updateBranches();render();$('#results').hidden=false;
  setStatus(`${months[0]} — ${months.at(-1)} · ${months.length} 個月 · ${market==='both'?'上市＋上櫃':market==='twse'?'上市':'上櫃'} · 成交金額加權計算${manifest.errors?.length?' · 部分來源更新未成功，僅顯示已驗證資料':''}`);
 }catch(e){if(ticket===version)setStatus(e.message,true);}
}
function updateBranches(){
 const b=$('#broker').value,previous=$('#branch').value;
 const a=aggregate(reports,market,'branch',b);
 $('#branch').innerHTML=option('','全部營業單位')+a.rows.map(r=>option(r.code,`${r.name}${r.kind==='head'?'（總公司）':''}`)).join('');
 $('#branch').disabled=!b;if(a.rows.some(r=>r.code===previous))$('#branch').value=previous;
}
function render(){
 const b=$('#broker').value,branch=$('#branch').value;
 const groups=aggregate(reports,market);groupRows=groups.rows;total=groups.total;
 const detail=b?aggregate(reports,market,'branch',b):groups;
 viewRows=branch?detail.rows.filter(r=>r.code===branch):detail.rows;
 const selected=b?groupRows.find(r=>r.code===b):null;
 const main=branch?viewRows[0]:b?selected:groupRows[0];
 $('#share-label').textContent=b?'所選券商／單位市占率':'領先券商市占率';
 $('#share').textContent=main?pct(main.share):'未列示';
 $('#share-note').textContent=main?`${main.name} · ${kindName[main.kind]}${isComplete(main)?'':' · 部分月份未列示'}`:'所選券商在本期間未列示';
 $('#amount-label').textContent=b?'所選券商／單位成交金額':'區間市場成交金額';
 $('#amount').textContent=b?(main?money(main.amount):'—'):money(total);
 $('#count-label').textContent=b?'納入比較的營業單位':'納入比較的券商';
 $('#count').textContent=`${detail.rows.length} 家`;
 $('#count-note').textContent=b?'含總公司營業單位與分公司':'總公司經紀合計・不含自營';
 $('#period').textContent=`${range.length} 個月`;$('#period-note').textContent=`${range[0]} — ${range.at(-1)}`;
 $('#chart-title').textContent=b?`${selectedName()} · ${mode==='bars'?'營業單位市占':'月度市占變化'}`:mode==='bars'?'券商市占排行':'領先券商月度走勢';
 $('#chart-note').textContent=mode==='bars'?`${b?'各營業單位':'各券商經紀合計'}占全市場比例 · ${viewRows.length>15?'顯示前 15 名':'依市占率排序'}`:b?(branch?'所選營業單位':'總公司經紀合計')+'每月市占率':'依所選區間成交金額前五名顯示';
 $('#legend').hidden=mode==='trend';
 $('#legend').innerHTML=marketsFor(market).map(m=>`<span><i class="${m}"></i>${m==='twse'?'上市':'上櫃'}</span>`).join('');
 if(mode==='bars')renderBars();else renderTrend();
 $('#chart-foot').textContent=mode==='bars'?(market==='both'?'藍色＝上市金額 ÷ 合併市場金額；金色＝上櫃金額 ÷ 合併市場金額。兩段合計為合併市占率。':'市占率採同期間全市場成交金額為分母。')+(b?' 總公司經紀合計顯示於上方，不與各營業單位重複排列。':' 點選券商名稱可展開總分公司資料。'):'各月份分別計算市占率，缺少券商資料時保留斷點。完整數值可展開圖表下方的每月明細。';
 $('#table-title').textContent=b?'總公司與分公司成交明細':'券商成交明細';renderTable();renderClosures(b);
 $('#source-links').innerHTML=reports.map(r=>`<a href="${esc(r.source)}" target="_blank" rel="noopener">${r.month} · ${r.market==='twse'?'上市 ZIP':'上櫃 XLS'} ↗</a>`).join('');
}
function renderBars(){
 const rows=viewRows.slice(0,15),max=Math.max(.001,...rows.map(r=>r.share))*1.08;
 if(!rows.length){$('#chart').innerHTML='<div class="empty">所選期間沒有這家券商的營業單位資料。</div>';return;}
 $('#chart').innerHTML=rows.map((r,i)=>`<div class="bar-row"><span class="bar-rank">${String(i+1).padStart(2,'0')}</span><button class="bar-name" data-code="${esc(r.code)}" title="${esc(r.name)} · ${esc(r.code)}">${esc(r.name)}</button><div class="bar-track" role="img" aria-label="${esc(r.name)}：${pct(r.share)}，上市貢獻 ${pct(r.twseShare)}、上櫃貢獻 ${pct(r.tpexShare)}"><span class="twse" style="width:${r.twseShare/max*100}%" title="上市貢獻 ${pct(r.twseShare)}"></span><span class="tpex" style="width:${r.tpexShare/max*100}%" title="上櫃貢獻 ${pct(r.tpexShare)}"></span></div><span class="bar-value">${pct(r.share)}${isComplete(r)?'':' *'}</span></div>`).join('')+`<div class="axis">${[0,.25,.5,.75,1].map(v=>`<span>${fmt(max*v,max<1?3:1)}%</span>`).join('')}</div>`;
}
function renderTrend(){
 const b=$('#broker').value,branch=$('#branch').value;
 const series=b?(branch?viewRows:groupRows.filter(r=>r.code===b)):groupRows.slice(0,5);
 if(!series.length){$('#chart').innerHTML='<div class="empty">所選期間沒有可繪製的月度資料。</div>';return;}
 const points=monthly(reports,market,series.map(r=>r.code),branch?'branch':'group',b);
 const colors=['#157c9c','#dc982d','#5b64a0','#2b9d87','#9c567d'];
 const max=Math.max(.01,...points.flatMap(p=>p.values.map(r=>r?.share||0)))*1.15;
 const x=i=>65+i*900/Math.max(points.length-1,1),y=v=>265-v/max*230;
 let svg=`<svg class="trend-svg" viewBox="0 0 1000 310" role="img" aria-label="每月市占率折線圖"><title>每月市占率；完整數值在下方每月明細</title>`;
 for(let i=0;i<=4;i++){let v=max*i/4;svg+=`<line x1="65" x2="965" y1="${y(v)}" y2="${y(v)}" stroke="#e5ecf2"/><text x="52" y="${y(v)+4}" text-anchor="end">${fmt(v,1)}%</text>`;}
 points.forEach((p,i)=>{if(i%Math.max(1,Math.ceil(points.length/8))===0||i===points.length-1)svg+=`<text x="${x(i)}" y="293" text-anchor="middle">${p.month}</text>`;});
 series.forEach((r,j)=>{let path='',active=false;points.forEach((p,i)=>{const v=p.values[j];if(!v||!marketsFor(market).every(m=>v.seen[m].has(p.month))){active=false;return;}path+=`${active?'L':'M'}${x(i)} ${y(v.share)} `;active=true;svg+=`<circle cx="${x(i)}" cy="${y(v.share)}" r="3" fill="${colors[j]}"><title>${p.month} ${esc(r.name)} ${pct(v.share)}</title></circle>`;});svg+=`<path d="${path}" fill="none" stroke="${colors[j]}" stroke-width="2.5"/>`;});
 svg+='</svg>';
 $('#chart').innerHTML=svg+`<div class="trend-key">${series.map((r,i)=>`<span><i style="--color:${colors[i]}"></i>${esc(r.name)}</span>`).join('')}</div><details><summary>每月明細</summary><div class="table-wrap"><table><thead><tr><th>月份</th>${series.map(r=>`<th>${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${points.map(p=>`<tr><td>${p.month}</td>${p.values.map(r=>`<td>${r&&marketsFor(market).every(m=>r.seen[m].has(p.month))?pct(r.share):'未列示'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function renderTable(){
 const query=$('#search').value.trim().toLocaleLowerCase(),b=$('#broker').value;
 let items=viewRows.map((r,i)=>({...r,rank:i+1}));
 if(b&&!$('#branch').value){const group=groupRows.find(r=>r.code===b);if(group)items.unshift({...group,rank:'合計'});}
 items=items.filter(r=>`${r.code} ${r.name} ${[...r.names].join(' ')}`.toLocaleLowerCase().includes(query));
 $('#tbody').innerHTML=items.length?items.map(r=>`<tr><td>${r.rank}</td><td><button data-code="${esc(r.code)}">${esc(r.name)}</button><small title="${esc([...r.names].join('、'))}">${esc(r.code)} · ${kindName[r.kind]}${r.names.size>1?' · 來源名稱有差異':''}</small></td><td>${market==='tpex'?'—':r.seen.twse.size?fmt(r.twse/1e8):'未列示'}</td><td>${market==='twse'?'—':r.seen.tpex.size?fmt(r.tpex/1e8):'未列示'}</td><td>${pct(r.share)}${isComplete(r)?'':' *'}</td><td>${availability(r)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">沒有符合條件的資料</td></tr>';
 $('#table-note').textContent=`共 ${items.length} 筆。* 表示部分月份或市場未列示；百分比僅以已列示成交金額除以完整區間市場金額，不能視為完整期間市占率。名稱採所選期間最新報表。`;
}
function renderClosures(b){
 const rows=closures.filter(r=>r.code===b.replace('*','0'));
 $('#closure-panel').hidden=!rows.length;
 $('#closure-info').innerHTML=rows.map(r=>`<p><strong>${esc(r.name)}（${esc(r.code)}）</strong> · ${r.date} · ${esc(r.reason)}<br>結束營業當時之存續公司或代辦券商：${esc(r.successor||'原始資料未提供')}</p>`).join('')+'<p>名冊記載最後營業日或合併基準日，不代表所有業務均已終止；歷史成交不自動轉入存續券商。</p>';
}
function choose(code){if(code.endsWith('*')){$('#broker').value=code;$('#branch').value='';updateBranches();}else{$('#branch').value=code;}render();}
$('#chart').addEventListener('click',e=>{const b=e.target.closest('[data-code]');if(b)choose(b.dataset.code);});
$('#tbody').addEventListener('click',e=>{const b=e.target.closest('[data-code]');if(b)choose(b.dataset.code);});
$('#markets').addEventListener('click',e=>{const b=e.target.closest('[data-market]');if(!b)return;market=b.dataset.market;$('#markets').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));query();});
$('#chart-modes').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;$('#chart-modes').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));if(reports.length)render();});
$('#broker').addEventListener('change',()=>{$('#branch').value='';updateBranches();render();});
$('#branch').addEventListener('change',render);$('#search').addEventListener('input',renderTable);
$('#from').addEventListener('change',query);$('#to').addEventListener('change',query);
document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{const available=Object.keys(manifest.months).filter(m=>marketsFor(market).every(k=>manifest.months[m].includes(k))).sort();const end=available.at(-1);$('#to').value=end;const all=monthRange(available[0],end);$('#from').value=b.dataset.period==='all'?all[0]:all[Math.max(0,all.length-Number(b.dataset.period))];query();}));
async function init(){try{
 manifest=await json('data/manifest.json');
 const gaps=Object.entries(manifest.months).filter(([m,markets])=>markets.length<2).map(([m,markets])=>`${m} ${markets.includes('twse')?'上櫃':'上市'}`);
 if(gaps.length){$('#data-warning').hidden=false;$('#data-warning').textContent=`資料缺口：${gaps.join('、')}尚無通過年月與金額核對的官方資料；含該月份的相關市場查詢將停用。`;}
 try{closures=(await json('data/closures.json')).rows;}catch{setStatus('結束營業名冊讀取失敗。',true);}
 const months=Object.keys(manifest.months).sort(),complete=months.filter(m=>manifest.months[m].length===2);
 if(!complete.length)throw Error('尚無完整双市場資料，請先執行官方資料更新。');
 const latest=complete.at(-1);$('#latest').textContent=`資料至 ${latest.replace('-',' / ')}`;
 $('#updated').textContent=`資料整理 ${new Date(manifest.updated).toLocaleDateString('zh-TW')}`;
 for(const id of ['from','to']){$('#'+id).min=months[0];$('#'+id).max=months.at(-1);}
 $('#to').value=latest;$('#from').value=latest;
 $('#broker').innerHTML=option('','全部券商')+(manifest.brokers||[]).map(r=>option(r.code,r.name)).join('');
 await query();
 }catch(e){setStatus(e.message,true);}}
init();
