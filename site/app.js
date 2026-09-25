import{aggregate,growthRate,monthlyEntities,monthRange,marketsFor,positiveBaseGrowthRate,shiftMonth}from'./engine.js?v=eps-growth-3';
const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=2)=>x.toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=x=>`${fmt(x,3)}%`,money=x=>x>=1e12?`${fmt(x/1e12)} 兆`:`${fmt(x/1e8)} 億`;
const kindName={group:'經紀合計',head:'總公司營業單位',branch:'分公司'};
let manifest,epsManifest,closures=[],reports=[],comparisonReports=[],epsComparisonReports=[],market='both',mode='bars',barMetric='share',growthMetric='mom',epsMode='all',epsAllMetric='cumulative',marketSort={key:'rank',dir:'asc'},epsSort={key:'period',dir:'desc'},version=0,epsVersion=0,range=[],viewRows=[],groupRows=[],total=0,trendSelections=[];
const trendColors=['#157c9c','#dc982d','#5b64a0','#2b9d87','#9c567d','#805ad5','#d65f5f','#4c78a8','#72a33b','#8c6d5c'];
const cache=new Map();
const epsCache=new Map();
async function json(path){const r=await fetch(path);if(!r.ok)throw Error(`資料讀取失敗（${r.status}），請重新整理後再試。`);return r.json();}
function setStatus(message,error=false){$('#status').textContent=message;$('#status').className=error?'error':'';}
function option(code,name){return`<option value="${esc(code)}">${esc(name)}${code?' · '+esc(code):''}</option>`;}
function sortedRows(rows,state){return rows.slice().sort((a,b)=>{const av=a[state.key],bv=b[state.key];if(av==null&&bv==null)return String(a.code||'').localeCompare(String(b.code||''));if(av==null)return 1;if(bv==null)return-1;const compared=typeof av==='string'?av.localeCompare(String(bv),'zh-Hant'):(av-bv);return(state.dir==='asc'?compared:-compared)||String(a.code||'').localeCompare(String(b.code||''));});}
function sortableHead(label,key){return`<th><button data-eps-sort="${key}">${label}</button></th>`;}
function updateSortHeaders(selector,state,attribute){$(selector).querySelectorAll(`button[${attribute}]`).forEach(button=>{const active=button.getAttribute(attribute)===state.key;button.classList.toggle('sort-active',active);button.closest('th').setAttribute('aria-sort',active?(state.dir==='asc'?'ascending':'descending'):'none');});}
function selectedName(){return $('#broker').selectedOptions[0]?.textContent.split(' · ')[0]||'';}
function availability(row){return marketsFor(market).map(m=>`${m==='twse'?'上市':'上櫃'} ${row.seen[m].size}/${range.length}`).join(' · ');}
function isComplete(row){return marketsFor(market).every(m=>row.seen[m].size===range.length);}
async function query(){
 const ticket=++version;$('#results').hidden=true;setStatus('正在載入及核對所選期間…');
 try{
  const months=monthRange($('#from').value,$('#to').value),wanted=marketsFor(market);
  const missing=months.filter(m=>!wanted.every(k=>manifest.months[m]?.includes(k)));
  if(missing.length)throw Error(`以下月份尚未有完整${market==='both'?'雙市場':''}資料：${missing.join('、')}。請調整範圍；缺失資料不以零代替。`);
  const firstAvailable=Object.keys(manifest.months).sort()[0],historyStart=shiftMonth(months[0],-12)<firstAvailable?firstAvailable:shiftMonth(months[0],-12);
  const historyMonths=monthRange(historyStart,months.at(-1));
  const paths=historyMonths.flatMap(m=>wanted.filter(k=>manifest.months[m]?.includes(k)).map(k=>`data/months/${m}-${k}.json`));
  // Bound concurrency for long historical ranges.
  let loaded=[];
  for(let i=0;i<paths.length;i+=8){loaded.push(...await Promise.all(paths.slice(i,i+8).map(async p=>{if(!cache.has(p))cache.set(p,await json(p));return cache.get(p);})));if(ticket!==version)return;}
  if(ticket!==version)return;
  comparisonReports=loaded.sort((a,b)=>a.month.localeCompare(b.month)||a.market.localeCompare(b.market));
  reports=comparisonReports.filter(report=>months.includes(report.month));range=months;
  updateBranches();updateTrendBranches();render();$('#results').hidden=false;
  setStatus(`${months[0]} — ${months.at(-1)} · ${months.length} 個月 · ${market==='both'?'上市＋上櫃':market==='twse'?'上市':'上櫃'} · 成交金額加權計算${manifest.errors?.length?' · 部分來源更新未成功，僅顯示已驗證資料':''}`);
 }catch(e){if(ticket===version)setStatus(e.message,true);}
}
function updateBranches(){
 const b=$('#broker').value,previous=$('#branch').value;
 const a=aggregate(reports,market,'branch',b);
 $('#branch').innerHTML=option('','全部營業單位')+a.rows.map(r=>option(r.code,`${r.name}${r.kind==='head'?'（總公司）':''}`)).join('');
 $('#branch').disabled=!b;if(a.rows.some(r=>r.code===previous))$('#branch').value=previous;
}
function updateTrendBranches(){
 const parent=$('#trend-broker').value,previous=$('#trend-branch').value;
 if(!parent){$('#trend-branch').innerHTML=option('','券商經紀合計');$('#trend-branch').disabled=true;return;}
 const rows=aggregate(reports,market,'branch',parent).rows;
 $('#trend-branch').innerHTML=option('','券商經紀合計')+rows.map(r=>option(r.code,`${r.name}${r.kind==='head'?'（總公司）':''}`)).join('');
 $('#trend-branch').disabled=false;if(rows.some(r=>r.code===previous))$('#trend-branch').value=previous;
}
function trendEntity(){
 const parent=$('#trend-broker').value;if(!parent)return null;
 const code=$('#trend-branch').value;
 if(!code){const r=groupRows.find(x=>x.code===parent);return r&&{code:r.code,name:r.name,kind:'group',parent:'',label:`${r.name}・經紀合計`};}
 const r=aggregate(reports,market,'branch',parent).rows.find(x=>x.code===code);
 return r&&{code:r.code,name:r.name,kind:r.kind,parent,label:`${r.name}・${kindName[r.kind]}`};
}
function renderTrendPicker(){
 $('#trend-picker').hidden=!['trend','growth'].includes(mode);$('#bar-metrics').hidden=mode!=='bars';$('#growth-metrics').hidden=mode!=='growth';
 $('#trend-chips').innerHTML=trendSelections.length?trendSelections.map((r,i)=>`<button type="button" data-remove="${i}" title="移除 ${esc(r.label)}"><i style="--color:${trendColors[i]}"></i>${esc(r.label)} ×</button>`).join(''):'<span>尚未手動加入；目前依畫面條件顯示預設曲線。</span>';
 $('#trend-add').disabled=trendSelections.length>=10||!$('#trend-broker').value;
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
 $('#chart-title').textContent=mode==='bars'?(b?`${selectedName()} · 營業單位${barMetric==='share'?'市占':'成交金額'}`:`券商${barMetric==='share'?'市占':'成交金額'}排行`):mode==='trend'?'券商與分公司月度市占走勢':'券商、分點與市場成交成長比較';
 $('#chart-note').textContent=mode==='bars'?`${b?'各營業單位':'各券商經紀合計'}${barMetric==='share'?'占全市場比例':'區間成交金額'} · ${viewRows.length>15?'顯示前 15 名':`依${barMetric==='share'?'市占率':'成交金額'}排序`}`:mode==='trend'?`逐月市占率比較 · 已選 ${trendSelections.length}/10 條曲線`:`${{mom:'前月比較',yoy:'去年同月比較',period:'所選區間累計與去年同期比較'}[growthMetric]} · 券商／分點與市場同圖比較`;
 renderTrendPicker();
 $('#legend').hidden=mode!=='bars';
 $('#legend').innerHTML=marketsFor(market).map(m=>`<span><i class="${m}"></i>${m==='twse'?'上市':'上櫃'}</span>`).join('');
 if(mode==='bars')renderBars();else if(mode==='trend')renderTrend();else renderGrowth();
 $('#chart-foot').textContent=mode==='bars'?(barMetric==='amount'?(market==='both'?'藍色與金色分別表示上市、上櫃成交金額；兩段相加為區間總成交金額。':'成交金額為所選月份加總，單位顯示為億元。'):(market==='both'?'藍色＝上市金額 ÷ 合併市場金額；金色＝上櫃金額 ÷ 合併市場金額。兩段相加為合併市占率。':'市占率採同期間全市場成交金額為分母。'))+(b?' 總公司經紀合計顯示於上方，不與各營業單位重複排列。':' 點選券商名稱可展開總分公司資料。'):mode==='trend'?'各月份分別以該月全市場成交金額計算市占率；曲線上升代表市占成長、下降代表衰減。缺少券商資料時保留斷點。':'月增率＝本月與前月比較；年增率＝本月與去年同月比較；同期增長率＝從所選起始月累計至各月，再與去年相同月份區間比較。基期為零或資料未列示時保留斷點。';
 $('#table-title').textContent=b?'總公司與分公司成交明細':'券商成交明細';renderTable();renderClosures(b);
 $('#source-links').innerHTML=reports.map(r=>`<a href="${esc(r.source)}" target="_blank" rel="noopener">${r.month} · ${r.market==='twse'?'上市 ZIP':'上櫃 XLS'} ↗</a>`).join('');
}
function renderBars(){
 const rows=viewRows.slice(0,15),value=r=>barMetric==='share'?r.share:r.amount/1e8,twse=r=>barMetric==='share'?r.twseShare:r.twse/1e8,tpex=r=>barMetric==='share'?r.tpexShare:r.tpex/1e8,max=Math.max(.001,...rows.map(value))*1.08;
 if(!rows.length){$('#chart').innerHTML='<div class="empty">所選期間沒有這家券商的營業單位資料。</div>';return;}
 $('#chart').innerHTML=rows.map((r,i)=>`<div class="bar-row"><span class="bar-rank">${String(i+1).padStart(2,'0')}</span><button class="bar-name" data-code="${esc(r.code)}" title="${esc(r.name)} · ${esc(r.code)}">${esc(r.name)}</button><div class="bar-track" role="img" aria-label="${esc(r.name)}：${barMetric==='share'?pct(r.share):fmt(value(r))+' 億'}"><span class="twse" style="width:${twse(r)/max*100}%" title="上市 ${barMetric==='share'?pct(r.twseShare):fmt(r.twse/1e8)+' 億'}"></span><span class="tpex" style="width:${tpex(r)/max*100}%" title="上櫃 ${barMetric==='share'?pct(r.tpexShare):fmt(r.tpex/1e8)+' 億'}"></span></div><span class="bar-value">${barMetric==='share'?pct(r.share):fmt(value(r))+' 億'}${isComplete(r)?'':' *'}</span></div>`).join('')+`<div class="axis">${[0,.25,.5,.75,1].map(v=>`<span>${fmt(max*v,max<1?3:1)}${barMetric==='share'?'%':' 億'}</span>`).join('')}</div>`;
}
function renderTrend(){
 const b=$('#broker').value,branch=$('#branch').value;
 const fallback=b?(branch?viewRows.map(r=>({...r,parent:b,label:`${r.name}・${kindName[r.kind]}`})):groupRows.filter(r=>r.code===b).map(r=>({...r,parent:'',label:`${r.name}・經紀合計`}))):groupRows.slice(0,5).map(r=>({...r,parent:'',label:`${r.name}・經紀合計`}));
 const series=trendSelections.length?trendSelections:fallback;
 if(!series.length){$('#chart').innerHTML='<div class="empty">所選期間沒有可繪製的月度資料。</div>';return;}
 const points=monthlyEntities(reports,market,series);
 const colors=trendColors;
 const max=Math.max(.01,...points.flatMap(p=>p.values.map(r=>r?.share||0)))*1.15;
 const x=i=>65+i*900/Math.max(points.length-1,1),y=v=>265-v/max*230;
 let svg=`<svg class="trend-svg" viewBox="0 0 1000 310" role="img" aria-label="每月市占率折線圖"><title>每月市占率；完整數值在下方每月明細</title>`;
 for(let i=0;i<=4;i++){let v=max*i/4;svg+=`<line x1="65" x2="965" y1="${y(v)}" y2="${y(v)}" stroke="#e5ecf2"/><text x="52" y="${y(v)+4}" text-anchor="end">${fmt(v,1)}%</text>`;}
 points.forEach((p,i)=>{if(i%Math.max(1,Math.ceil(points.length/8))===0||i===points.length-1)svg+=`<text x="${x(i)}" y="293" text-anchor="middle">${p.month}</text>`;});
 series.forEach((r,j)=>{let path='',active=false;points.forEach((p,i)=>{const v=p.values[j];if(!v||!marketsFor(market).every(m=>v.seen[m].has(p.month))){active=false;return;}path+=`${active?'L':'M'}${x(i)} ${y(v.share)} `;active=true;svg+=`<circle cx="${x(i)}" cy="${y(v.share)}" r="3" fill="${colors[j]}"><title>${p.month} ${esc(r.name)} ${pct(v.share)}</title></circle>`;});svg+=`<path d="${path}" fill="none" stroke="${colors[j]}" stroke-width="2.5"/>`;});
 svg+='</svg>';
 $('#chart').innerHTML=svg+`<div class="trend-key">${series.map((r,i)=>`<span><i style="--color:${colors[i]}"></i>${esc(r.label||r.name)}</span>`).join('')}</div><details><summary>每月明細</summary><div class="table-wrap"><table><thead><tr><th>月份</th>${series.map(r=>`<th>${esc(r.label||r.name)}</th>`).join('')}</tr></thead><tbody>${points.map(p=>`<tr><td>${p.month}</td>${p.values.map(r=>`<td>${r&&marketsFor(market).every(m=>r.seen[m].has(p.month))?pct(r.share):'未列示'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
const growthLabel=value=>value==null?'未列示':`${value>0?'+':''}${fmt(value,2)}%`;
function growthDefinitions(){
 const b=$('#broker').value,branch=$('#branch').value;
 const fallback=b?(branch?viewRows.map(r=>({...r,parent:b,label:`${r.name}・${kindName[r.kind]}`})):groupRows.filter(r=>r.code===b).map(r=>({...r,parent:'',label:`${r.name}・經紀合計`}))):groupRows.slice(0,3).map(r=>({...r,parent:'',label:`${r.name}・經紀合計`}));
 const entities=trendSelections.length?trendSelections:fallback;
 const markets=market==='both'?[{targetMarket:'both',label:'上市＋上櫃市場',color:'#162f4b'},{targetMarket:'twse',label:'上市市場',color:'#157c9c'},{targetMarket:'tpex',label:'上櫃市場',color:'#dc982d'}]:[{targetMarket:market,label:market==='twse'?'上市市場':'上櫃市場',color:market==='twse'?'#157c9c':'#dc982d'}];
 return [...markets.map(r=>({...r,isMarket:true})),...entities.map((r,i)=>({...r,targetMarket:market,color:trendColors[(i+markets.length)%trendColors.length]}))];
}
function growthAmount(def,month){
 const monthReports=comparisonReports.filter(report=>report.month===month),required=marketsFor(def.targetMarket);
 if(!required.every(name=>monthReports.some(report=>report.market===name)))return null;
 const result=aggregate(monthReports,def.targetMarket,def.isMarket?'group':def.kind==='group'?'group':'branch',def.parent||'');
 if(def.isMarket)return result.total;
 const row=result.rows.find(row=>row.code===def.code);
 return row&&required.every(name=>row.seen[name].has(month))?row.amount:null;
}
function renderGrowth(){
 const definitions=growthDefinitions();
 if(!definitions.length){$('#chart').innerHTML='<div class="empty">所選期間沒有可比較的成交金額資料。</div>';return;}
 const amountMaps=definitions.map(def=>new Map([...new Set(comparisonReports.map(report=>report.month))].map(month=>[month,growthAmount(def,month)])));
 const series=definitions.map((def,index)=>({def,values:range.map((month,i)=>{
  const amounts=amountMaps[index],current=amounts.get(month);let previous;
  if(growthMetric==='mom')previous=amounts.get(shiftMonth(month,-1));
  else if(growthMetric==='yoy')previous=amounts.get(shiftMonth(month,-12));
  else{
   const currentValues=range.slice(0,i+1).map(value=>amounts.get(value)),previousValues=range.slice(0,i+1).map(value=>amounts.get(shiftMonth(value,-12)));
   if(currentValues.some(value=>value==null)||previousValues.some(value=>value==null))return null;
   return growthRate(currentValues.reduce((sum,value)=>sum+value,0),previousValues.reduce((sum,value)=>sum+value,0));
  }
  return current==null||previous==null?null:growthRate(current,previous);
 })}));
 const values=series.flatMap(item=>item.values.filter(value=>value!=null));
 if(!values.length){$('#chart').innerHTML='<div class="empty">所選期間缺少前月或去年同期基期，無法計算成長率。</div>';return;}
 let min=Math.min(0,...values),max=Math.max(0,...values),span=Math.max(max-min,1),pad=span*.08;min-=pad;max+=pad;span=max-min;
 const x=i=>65+i*900/Math.max(range.length-1,1),y=value=>260-(value-min)/span*220;
 let svg=`<svg class="trend-svg growth-svg" viewBox="0 0 1000 310" role="img" aria-label="成交金額成長率比較"><title>券商、分點與市場成交金額成長率比較</title>`;
 for(let i=0;i<=4;i++){const value=min+span*i/4;svg+=`<line x1="65" x2="965" y1="${y(value)}" y2="${y(value)}" stroke="${Math.abs(value)<span/50?'#8091a3':'#e5ecf2'}"/><text x="52" y="${y(value)+4}" text-anchor="end">${fmt(value,1)}%</text>`;}
 range.forEach((month,i)=>{if(i%Math.max(1,Math.ceil(range.length/8))===0||i===range.length-1)svg+=`<text x="${x(i)}" y="293" text-anchor="middle">${month}</text>`;});
 series.forEach(item=>{let path='',active=false;item.values.forEach((value,i)=>{if(value==null){active=false;return;}path+=`${active?'L':'M'}${x(i)} ${y(value)} `;active=true;svg+=`<circle cx="${x(i)}" cy="${y(value)}" r="3" fill="${value>=0?'#c44747':'#087c67'}"><title>${range[i]} ${esc(item.def.label)} ${growthLabel(value)}</title></circle>`;});svg+=`<path d="${path}" fill="none" stroke="${item.def.color}" stroke-width="${item.def.isMarket?3:2.3}" ${item.def.isMarket?'stroke-dasharray="8 4"':''}/>`;});
 svg+='</svg>';
 const latest=range.at(-1),periodMonths=range,summary=definitions.map((def,index)=>{const amounts=amountMaps[index],current=amounts.get(latest),mom=growthRate(current,amounts.get(shiftMonth(latest,-1))),yoy=growthRate(current,amounts.get(shiftMonth(latest,-12))),currentValues=periodMonths.map(month=>amounts.get(month)),priorValues=periodMonths.map(month=>amounts.get(shiftMonth(month,-12))),currentPeriod=currentValues.some(value=>value==null)?null:currentValues.reduce((sum,value)=>sum+value,0),priorPeriod=priorValues.some(value=>value==null)?null:priorValues.reduce((sum,value)=>sum+value,0);return{def,current,mom,yoy,currentPeriod,priorPeriod,period:growthRate(currentPeriod,priorPeriod)};});
 const rateCell=value=>`<td class="${value==null?'':value>0?'positive':value<0?'negative':''}">${growthLabel(value)}</td>`;
 $('#chart').innerHTML=svg+`<div class="trend-key">${definitions.map(def=>`<span><i style="--color:${def.color};${def.isMarket?'border-top:2px dashed '+def.color+';background:none;height:1px':''}"></i>${esc(def.label)}</span>`).join('')}</div><div class="table-wrap growth-table"><table><thead><tr><th>比較對象</th><th>${latest} 成交金額</th><th>月增率</th><th>年增率</th><th>所選區間成交金額</th><th>去年同期成交金額</th><th>同期增長率</th></tr></thead><tbody>${summary.map(row=>`<tr><td>${esc(row.def.label)}</td><td>${row.current==null?'未列示':money(row.current)}</td>${rateCell(row.mom)}${rateCell(row.yoy)}<td>${row.currentPeriod==null?'未列示':money(row.currentPeriod)}</td><td>${row.priorPeriod==null?'未列示':money(row.priorPeriod)}</td>${rateCell(row.period)}</tr>`).join('')}</tbody></table></div>`;
}
function renderTable(){
 const query=$('#search').value.trim().toLocaleLowerCase(),b=$('#broker').value;
 let items=viewRows.map((r,i)=>({...r,rank:i+1,sortRank:i+1}));
 if(b&&!$('#branch').value){const group=groupRows.find(r=>r.code===b);if(group)items.unshift({...group,rank:'合計',sortRank:0});}
 items=items.filter(r=>`${r.code} ${r.name} ${[...r.names].join(' ')}`.toLocaleLowerCase().includes(query));
 const metrics=row=>{const def={...row,targetMarket:market,parent:row.kind==='group'?'':b},latest=range.at(-1),current=growthAmount(def,latest),mom=growthRate(current,growthAmount(def,shiftMonth(latest,-1))),yoy=growthRate(current,growthAmount(def,shiftMonth(latest,-12))),currentValues=range.map(month=>growthAmount(def,month)),priorValues=range.map(month=>growthAmount(def,shiftMonth(month,-12))),currentPeriod=currentValues.some(value=>value==null)?null:currentValues.reduce((sum,value)=>sum+value,0),priorPeriod=priorValues.some(value=>value==null)?null:priorValues.reduce((sum,value)=>sum+value,0);return{mom,yoy,period:growthRate(currentPeriod,priorPeriod)};};
 items=sortedRows(items.map(r=>{const growth=metrics(r);return{...r,...growth,rankValue:r.sortRank,twseSort:r.seen.twse.size?r.twse:null,tpexSort:r.seen.tpex.size?r.tpex:null};}),{...marketSort,key:marketSort.key==='rank'?'rankValue':marketSort.key==='twse'?'twseSort':marketSort.key==='tpex'?'tpexSort':marketSort.key});
 updateSortHeaders('#market-thead',marketSort,'data-market-sort');
 $('#tbody').innerHTML=items.length?items.map(r=>{const cell=value=>`<td class="growth-rate ${value==null?'':value>0?'positive':value<0?'negative':''}">${growthLabel(value)}</td>`;return`<tr><td>${r.rank}</td><td><button data-code="${esc(r.code)}">${esc(r.name)}</button><small title="${esc([...r.names].join('、'))}">${esc(r.code)} · ${kindName[r.kind]}${r.names.size>1?' · 來源名稱有差異':''}</small></td><td>${market==='tpex'?'—':r.seen.twse.size?fmt(r.twse/1e8):'未列示'}</td><td>${market==='twse'?'—':r.seen.tpex.size?fmt(r.tpex/1e8):'未列示'}</td><td>${pct(r.share)}${isComplete(r)?'':' *'}</td>${cell(r.mom)}${cell(r.yoy)}${cell(r.period)}<td>${availability(r)}</td></tr>`;}).join(''):'<tr><td colspan="9" class="empty">沒有符合條件的資料</td></tr>';
 $('#table-note').textContent=`共 ${items.length} 筆。* 表示部分月份或市場未列示；百分比僅以已列示成交金額除以完整區間市場金額，不能視為完整期間市占率。月增率、年增率與同期增長率分別依前月、去年同月及去年同期成交金額計算；基期為零或未列示時顯示未列示。名稱採所選期間最新報表。`;
}
function renderClosures(b){
 const rows=closures.filter(r=>r.code===b.replace('*','0'));
 $('#closure-panel').hidden=!rows.length;
 $('#closure-info').innerHTML=rows.map(r=>`<p><strong>${esc(r.name)}（${esc(r.code)}）</strong> · ${r.date} · ${esc(r.reason)}<br>結束營業當時之存續公司或代辦券商：${esc(r.successor||'原始資料未提供')}</p>`).join('')+'<p>名冊記載最後營業日或合併基準日，不代表所有業務均已終止；歷史成交不自動轉入存續券商。</p>';
}
function epsChart(series,labels,aria,unit='元',signed=false){
 const values=series.flatMap(s=>s.values.filter(v=>v!=null).map(v=>v.value));
 if(!values.length)return '<div class="empty">所選條件沒有可繪製的 EPS 資料。</div>';
 const min=Math.min(0,...values),max=Math.max(0,...values),span=Math.max(max-min,.1);
 const x=i=>65+i*900/Math.max(labels.length-1,1),y=v=>260-(v-min)/span*220;
 let svg=`<svg class="trend-svg" viewBox="0 0 1000 310" role="img" aria-label="${esc(aria)}"><title>${esc(aria)}</title>`;
 for(let i=0;i<=4;i++){const v=min+span*i/4;svg+=`<line x1="65" x2="965" y1="${y(v)}" y2="${y(v)}" stroke="${Math.abs(v)<span/40?'#9aaabd':'#e5ecf2'}"/><text x="52" y="${y(v)+4}" text-anchor="end">${fmt(v,2)}</text>`;}
 labels.forEach((label,i)=>{if(i%Math.max(1,Math.ceil(labels.length/10))===0||i===labels.length-1)svg+=`<text x="${x(i)}" y="293" text-anchor="middle">${esc(label)}</text>`;});
 series.forEach(s=>{let path='',active=false;s.values.forEach((point,i)=>{if(point==null){active=false;return;}path+=`${active?'L':'M'}${x(i)} ${y(point.value)} `;active=true;const color=signed?(point.value>=0?'#c44747':'#087c67'):s.color;svg+=`<circle cx="${x(i)}" cy="${y(point.value)}" r="3.5" fill="${color}"><title>${esc(point.title)}：${fmt(point.value,3)} ${unit}</title></circle>`;});svg+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.7"/>`;});
 return svg+'</svg>'+`<div class="trend-key">${series.map(s=>`<span><i style="--color:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}
const epsGrowthRate=positiveBaseGrowthRate;
function epsValue(code,month,field='monthlyEstimatedEps'){
 const report=epsComparisonReports.find(item=>item.month===month),row=report?.rows.find(item=>item.code===code);
 return row&&Number.isFinite(row[field])?row[field]:null;
}
function epsPeriodValue(code,months){
 const values=months.map(month=>epsValue(code,month));
 return values.some(value=>value==null)?null:values.reduce((sum,value)=>sum+value,0);
}
function epsMetrics(code,months){
 const latest=months.at(-1),current=epsValue(code,latest),period=epsPeriodValue(code,months),prior=epsPeriodValue(code,months.map(month=>shiftMonth(month,-12)));
 return{current,mom:epsGrowthRate(current,epsValue(code,shiftMonth(latest,-1))),yoy:epsGrowthRate(current,epsValue(code,shiftMonth(latest,-12))),period,prior,periodRate:epsGrowthRate(period,prior)};
}
function epsAllChart(rows,months){
 const leaders=rows.filter(row=>row.period!=null).slice().sort((a,b)=>b.period-a.period).slice(0,10),metricNames={mom:'月增率','cumulative-growth':'累計 EPS 成長率',cumulative:'累計 EPS',annual:'逐年 EPS'},percent=!['cumulative','annual'].includes(epsAllMetric);
 if(epsAllMetric==='annual'){
  const years=[...new Set(months.map(month=>month.slice(0,4)))],yearEnds=years.map(year=>months.filter(month=>month.startsWith(year)).at(-1));
  const series=leaders.map((row,index)=>({name:row.name,color:trendColors[index%trendColors.length],values:yearEnds.map(month=>{const value=epsValue(row.code,month,'estimatedEps');return value==null?null:{value,title:`${month} ${row.name} 年度累計 EPS`};})}));
  return epsChart(series,years,'區間 EPS 排名前十家券商逐年累計 EPS 曲線','元',true);
 }
 const series=leaders.map((row,index)=>({name:row.name,color:trendColors[index%trendColors.length],values:months.map((month,i)=>{const currentMonths=months.slice(0,i+1);let value;if(epsAllMetric==='mom')value=epsGrowthRate(epsValue(row.code,month),epsValue(row.code,shiftMonth(month,-1)));else{const cumulative=epsPeriodValue(row.code,currentMonths);value=epsAllMetric==='cumulative'?cumulative:epsGrowthRate(cumulative,epsPeriodValue(row.code,currentMonths.map(item=>shiftMonth(item,-12))));}return value==null?null:{value,title:`${month} ${row.name} ${metricNames[epsAllMetric]}`};})}));
 return epsChart(series,months,`區間 EPS 排名前十家券商${metricNames[epsAllMetric]}曲線`,percent?'%':'元',true);
}
function renderAllEps(reports){
 const months=reports.map(report=>report.month),latest=months.at(-1),catalog=new Map(epsManifest.brokers.map(row=>[row.code,row.name]));
 const baseRows=[...catalog].map(([code,catalogName])=>{const listed=reports.flatMap(report=>report.rows.map(row=>({...row,month:report.month}))).filter(row=>row.code===code),last=listed.at(-1),metrics=epsMetrics(code,months);return{code,name:last?.name||catalogName,listed:listed.length,...metrics};}),chartRows=baseRows.slice().sort((a,b)=>(b.period??-Infinity)-(a.period??-Infinity)||a.code.localeCompare(b.code)),ranks=new Map(chartRows.map((row,index)=>[row.code,index+1])),rows=sortedRows(baseRows.map(row=>({...row,rank:ranks.get(row.code)})),epsSort);
 const metricName={mom:'月增率','cumulative-growth':'累計 EPS 成長率',cumulative:'累計 EPS',annual:'逐年 EPS'}[epsAllMetric];
 $('#eps-title').textContent=`所選區間全部券商・${metricName}`;
 $('#eps-chart').innerHTML=epsAllChart(chartRows,months);
 $('#eps-status').textContent=`${months[0]} — ${latest} · ${rows.length} 家券商 · 曲線顯示區間 EPS 排名前十家`;
 $('#eps-thead').innerHTML=`<tr>${sortableHead('排名','rank')}${sortableHead('券商','name')}${sortableHead('最新月份 EPS（元）','current')}${sortableHead('月增率','mom')}${sortableHead('年增率','yoy')}${sortableHead('區間 EPS（元）','period')}${sortableHead('去年同期 EPS（元）','prior')}${sortableHead('同期比率','periodRate')}${sortableHead('資料月份','listed')}</tr>`;
 updateSortHeaders('#eps-thead',epsSort,'data-eps-sort');
 const rate=value=>`<td class="growth-rate ${value==null?'':value>0?'positive':value<0?'negative':''}">${growthLabel(value)}</td>`;
 $('#eps-tbody').innerHTML=rows.map(row=>`<tr><td>${row.rank}</td><td><button data-eps-code="${esc(row.code)}">${esc(row.name)}</button><small>${esc(row.code)}</small></td><td class="signed-value ${row.current==null?'':row.current>0?'positive':row.current<0?'negative':''}">${row.current==null?'未列示':fmt(row.current,3)}</td>${rate(row.mom)}${rate(row.yoy)}<td class="signed-value ${row.period==null?'':row.period>0?'positive':row.period<0?'negative':''}">${row.period==null?'未列示':fmt(row.period,3)}</td><td class="signed-value ${row.prior==null?'':row.prior>0?'positive':row.prior<0?'negative':''}">${row.prior==null?'未列示':fmt(row.prior,3)}</td>${rate(row.periodRate)}<td>${row.listed}/${months.length}</td></tr>`).join('');
}
function renderEps(reports){
 $('.eps-broker-control').hidden=epsMode==='all';
 $('#eps-all-metrics').hidden=epsMode!=='all';
 if(epsMode==='all'){renderAllEps(reports);return;}
 const code=$('#eps-broker').value;
 const timeline=reports.map(report=>({month:report.month,row:report.rows.find(row=>row.code===code)})),points=timeline.filter(point=>point.row);
 if(!points.length){$('#eps-title').textContent='EPS 分析';$('#eps-chart').innerHTML='<div class="empty">所選期間沒有這家券商的財務資料。</div>';$('#eps-tbody').innerHTML='';return;}
 const broker=points.at(-1).row.name;
 if(epsMode==='seasonal'){
  const years=[...new Set(points.map(point=>point.month.slice(0,4)))];
  const series=years.map((year,index)=>{const byMonth=new Map(points.filter(point=>point.month.startsWith(year)).map(point=>[Number(point.month.slice(5)),point]));return{name:`${year} 年`,color:trendColors[index%trendColors.length],values:Array.from({length:12},(_,i)=>{const point=byMonth.get(i+1);return point?{value:point.row.estimatedEps,title:`${year}-${String(i+1).padStart(2,'0')} ${broker}`} :null;})};});
  $('#eps-title').textContent=`${broker}・各年同期累計 EPS`;
  $('#eps-chart').innerHTML=epsChart(series,Array.from({length:12},(_,i)=>`${i+1} 月`),'各年同期累計估算 EPS 曲線');
  $('#eps-status').textContent=`${reports[0].month} — ${reports.at(-1).month} · ${years.length} 個年度有列示 · 各線為報表列示「本期」估算 EPS（元）`;
 }else{
  const labels=timeline.map(point=>point.month);
  const series=[
   {name:'本月估算 EPS',color:trendColors[0],values:timeline.map(point=>point.row?{value:point.row.monthlyEstimatedEps,title:`${point.month} ${broker} 本月`}:null)},
   {name:'本期累計估算 EPS',color:trendColors[1],values:timeline.map(point=>point.row?{value:point.row.estimatedEps,title:`${point.month} ${broker} 本期`}:null)}
  ];
  $('#eps-title').textContent=`${broker}・每月與累計 EPS`;
  $('#eps-chart').innerHTML=epsChart(series,labels,'單一券商每月與累計估算 EPS 曲線');
  $('#eps-status').textContent=`${reports[0].month} — ${reports.at(-1).month} · ${points.length}/${reports.length} 個月列示 · 藍線為本月、金線為報表「本期」`;
 }
 $('#eps-thead').innerHTML=`<tr>${sortableHead('券商','name')}${sortableHead('月份','month')}${sortableHead('本月稅後淨利（千元）','monthlyNetIncomeThousands')}${sortableHead('本月估算 EPS（元）','monthlyEstimatedEps')}${sortableHead('月增率','mom')}${sortableHead('年增率','yoy')}${sortableHead('自起始月同期比率','periodRate')}${sortableHead('本期累計稅後淨利（千元）','netIncomeThousands')}${sortableHead('本期累計估算 EPS（元）','estimatedEps')}${sortableHead('資本（千元）','capitalThousands')}${sortableHead('推算流通股數','estimatedShares')}</tr>`;
 const detailRows=points.map(point=>{const index=reports.findIndex(report=>report.month===point.month),months=reports.slice(0,index+1).map(report=>report.month);return{...point.row,month:point.month,...epsMetrics(code,months)};});
 updateSortHeaders('#eps-thead',epsSort,'data-eps-sort');
 $('#eps-tbody').innerHTML=sortedRows(detailRows,epsSort).map(row=>epsRow(row,row.month,row)).join('');
}
async function queryEps(){
 if(!epsManifest)return;
 const ticket=++epsVersion;$('#eps-status').className='eps-status';$('#eps-status').textContent='正在載入及核對所選期間的財務資料…';
 try{
  const months=monthRange($('#eps-from').value,$('#eps-to').value);
  const missing=months.filter(month=>!epsManifest.months[month]);
  if(missing.length)throw Error(`以下月份尚無綜合證券商財務資料：${missing.join('、')}。請調整 EPS 日期範圍。`);
  const available=Object.keys(epsManifest.months).sort(),historyStart=shiftMonth(months[0],-12)<available[0]?available[0]:shiftMonth(months[0],-12),historyMonths=monthRange(historyStart,months.at(-1));
  let loaded=[];
  for(let i=0;i<historyMonths.length;i+=8){loaded.push(...await Promise.all(historyMonths.slice(i,i+8).map(async month=>{const path=`data/eps/${month}.json`;if(!epsCache.has(path))epsCache.set(path,await json(path));return epsCache.get(path);})));if(ticket!==epsVersion)return;}
  if(ticket===epsVersion){epsComparisonReports=loaded.sort((a,b)=>a.month.localeCompare(b.month));renderEps(epsComparisonReports.filter(report=>months.includes(report.month)));}
 }catch(error){if(ticket===epsVersion){$('#eps-status').textContent=error.message;$('#eps-status').className='eps-status error';$('#eps-chart').innerHTML='';$('#eps-tbody').innerHTML='';}}
}
function epsRow(r,month,metrics){const rate=value=>`<td class="growth-rate ${value==null?'':value>0?'positive':value<0?'negative':''}">${growthLabel(value)}</td>`,signed=(value,digits)=>`<td class="signed-value ${value>0?'positive':value<0?'negative':''}">${fmt(value,digits)}</td>`;return`<tr><td><button data-eps-code="${esc(r.code)}">${esc(r.name)}</button><small>${esc(r.code)}</small></td><td>${month}</td>${signed(r.monthlyNetIncomeThousands,0)}${signed(r.monthlyEstimatedEps,3)}${rate(metrics.mom)}${rate(metrics.yoy)}${rate(metrics.periodRate)}${signed(r.netIncomeThousands,0)}${signed(r.estimatedEps,3)}<td>${fmt(r.capitalThousands,0)}</td><td>${fmt(r.estimatedShares,0)}</td></tr>`;}
function choose(code){if(code.endsWith('*')){$('#broker').value=code;$('#branch').value='';updateBranches();}else{$('#branch').value=code;}render();}
$('#chart').addEventListener('click',e=>{const b=e.target.closest('[data-code]');if(b)choose(b.dataset.code);});
$('#tbody').addEventListener('click',e=>{const b=e.target.closest('[data-code]');if(b)choose(b.dataset.code);});
$('#markets').addEventListener('click',e=>{const b=e.target.closest('[data-market]');if(!b)return;market=b.dataset.market;$('#markets').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));query();});
$('#chart-modes').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;$('#chart-modes').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));if(reports.length)render();});
$('#bar-metrics').addEventListener('click',e=>{const b=e.target.closest('[data-metric]');if(!b)return;barMetric=b.dataset.metric;$('#bar-metrics').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));if(reports.length)render();});
$('#growth-metrics').addEventListener('click',e=>{const b=e.target.closest('[data-growth]');if(!b)return;growthMetric=b.dataset.growth;$('#growth-metrics').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));if(reports.length)render();});
$('#trend-broker').addEventListener('change',()=>{updateTrendBranches();renderTrendPicker();});
$('#trend-branch').addEventListener('change',renderTrendPicker);
$('#trend-add').addEventListener('click',()=>{const entity=trendEntity();if(!entity||trendSelections.length>=10||trendSelections.some(r=>r.code===entity.code&&r.kind===entity.kind&&r.parent===entity.parent))return;trendSelections.push(entity);render();});
$('#trend-chips').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;trendSelections.splice(Number(b.dataset.remove),1);render();});
$('#broker').addEventListener('change',()=>{$('#branch').value='';updateBranches();render();});
$('#branch').addEventListener('change',render);$('#search').addEventListener('input',renderTable);
$('#market-thead').addEventListener('click',e=>{const button=e.target.closest('[data-market-sort]');if(!button)return;const key=button.dataset.marketSort;marketSort=marketSort.key===key?{key,dir:marketSort.dir==='asc'?'desc':'asc'}:{key,dir:['name','rank'].includes(key)?'asc':'desc'};renderTable();});
$('#feature-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-feature]');if(!b)return;const eps=b.dataset.feature==='eps';$('#market-view').hidden=eps;$('#eps-view').hidden=!eps;$('#feature-tabs').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));$('.heading .eyebrow').textContent=eps?'BROKER PROFITABILITY':'MARKET SHARE EXPLORER';$('.heading h1').innerHTML=eps?'比較券商的獲利軌跡<span>。</span>':'看見券商的市場版圖<span>。</span>';$('.heading>div:first-child>p:not(.eyebrow)').textContent=eps?'依年度同期、每月與累計估算 EPS 觀察券商獲利變化。':'從整體市場到分公司，以官方成交金額追蹤市占變化。';});
$('#eps-modes').addEventListener('click',e=>{const b=e.target.closest('[data-eps-mode]');if(!b)return;epsMode=b.dataset.epsMode;epsSort=epsMode==='all'?{key:'period',dir:'desc'}:{key:'month',dir:'desc'};$('#eps-modes').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));queryEps();});
$('#eps-all-metrics').addEventListener('click',e=>{const b=e.target.closest('[data-eps-all-metric]');if(!b)return;epsAllMetric=b.dataset.epsAllMetric;$('#eps-all-metrics').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));queryEps();});
$('#eps-broker').addEventListener('change',queryEps);
$('.eps-panel').addEventListener('click',e=>{const b=e.target.closest('[data-eps-code]');if(!b)return;$('#eps-broker').value=b.dataset.epsCode;epsMode='monthly';epsSort={key:'month',dir:'desc'};$('#eps-modes').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',button.dataset.epsMode===epsMode));queryEps();});
$('#eps-thead').addEventListener('click',e=>{const button=e.target.closest('[data-eps-sort]');if(!button)return;const key=button.dataset.epsSort;epsSort=epsSort.key===key?{key,dir:epsSort.dir==='asc'?'desc':'asc'}:{key,dir:['name','month','rank'].includes(key)?'asc':'desc'};queryEps();});
$('#from').addEventListener('change',query);$('#to').addEventListener('change',query);
$('#eps-from').addEventListener('change',queryEps);$('#eps-to').addEventListener('change',queryEps);
document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{const available=Object.keys(manifest.months).filter(m=>marketsFor(market).every(k=>manifest.months[m].includes(k))).sort();const end=available.at(-1);$('#to').value=end;const all=monthRange(available[0],end);$('#from').value=b.dataset.period==='all'?all[0]:all[Math.max(0,all.length-Number(b.dataset.period))];query();}));
document.querySelectorAll('[data-eps-period]').forEach(b=>b.addEventListener('click',()=>{const available=Object.keys(epsManifest.months).sort(),end=available.at(-1);$('#eps-to').value=end;$('#eps-from').value=b.dataset.epsPeriod==='all'?available[0]:available[Math.max(0,available.length-Number(b.dataset.epsPeriod))];queryEps();}));
async function init(){try{
 manifest=await json('data/manifest.json');
 const gaps=Object.entries(manifest.months).filter(([m,markets])=>markets.length<2).map(([m,markets])=>`${m} ${markets.includes('twse')?'上櫃':'上市'}`);
 if(gaps.length){$('#data-warning').hidden=false;$('#data-warning').textContent=`資料缺口：${gaps.join('、')}尚無通過年月與金額核對的官方資料；含該月份的相關市場查詢將停用。`;}
 try{closures=(await json('data/closures.json')).rows;}catch{setStatus('結束營業名冊讀取失敗。',true);}
 const months=Object.keys(manifest.months).sort(),complete=months.filter(m=>manifest.months[m].length===2);
 if(!complete.length)throw Error('尚無完整雙市場資料，請先執行官方資料更新。');
 const latest=complete.at(-1);$('#latest').textContent=`資料至 ${latest.replace('-',' / ')}`;
 $('#updated').textContent=`資料整理 ${new Date(manifest.updated).toLocaleDateString('zh-TW')}`;
 for(const id of ['from','to']){$('#'+id).min=months[0];$('#'+id).max=months.at(-1);}
 $('#to').value=latest;$('#from').value=latest;
 $('#broker').innerHTML=option('','全部券商')+(manifest.brokers||[]).map(r=>option(r.code,r.name)).join('');
 $('#trend-broker').innerHTML=option('','選擇券商')+(manifest.brokers||[]).map(r=>option(r.code,r.name)).join('');
 try{epsManifest=await json('data/eps-manifest.json');const epsMonths=Object.keys(epsManifest.months).sort(),epsLatest=epsMonths.at(-1);for(const id of ['eps-from','eps-to']){$('#'+id).min=epsMonths[0];$('#'+id).max=epsLatest;}$('#eps-to').value=epsLatest;$('#eps-from').value=epsMonths[Math.max(0,epsMonths.length-60)];$('#eps-broker').innerHTML=epsManifest.brokers.map(r=>option(r.code,r.name)).join('');$('#eps-broker').value=epsManifest.brokers.some(r=>r.code==='980*')?'980*':epsManifest.brokers[0]?.code||'';}catch{$('#eps-status').textContent='EPS 資料讀取失敗。';}
 await Promise.all([query(),queryEps()]);
 }catch(e){setStatus(e.message,true);}}
init();
