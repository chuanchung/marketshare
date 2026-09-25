export const marketsFor=m=>m==='both'?['twse','tpex']:[m];
export function shiftMonth(month,offset){
 const [year,value]=month.split('-').map(Number),index=year*12+value-1+offset;
 return `${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`;
}
export function growthRate(current,previous){
 return Number.isFinite(current)&&Number.isFinite(previous)&&previous!==0?(current/previous-1)*100:null;
}
export function monthRange(start,end){
 if(!/^\d{4}-\d{2}$/.test(start)||!/^\d{4}-\d{2}$/.test(end)||start>end)throw Error('請選擇有效的起訖月份，起始月份不可晚於結束月份。');
 const out=[];let [y,m]=start.split('-').map(Number);
 if(m<1||m>12||Number(end.slice(5))<1||Number(end.slice(5))>12)throw Error('月份格式不正確。');
 while(`${y}-${String(m).padStart(2,'0')}`<=end){out.push(`${y}-${String(m).padStart(2,'0')}`);if(++m===13){m=1;y++;}if(out.length>1500)throw Error('時間範圍過長。');}return out;
}
export function aggregate(reports,market,kind='group',parent=''){
 const selected=reports.filter(r=>marketsFor(market).includes(r.market));
 const totals={twse:0,tpex:0};const map=new Map();
 for(const report of selected){totals[report.market]+=report.total;
  for(const r of report.rows){if(kind==='group'?r.kind!=='group':!['head','branch'].includes(r.kind)||r.parent!==parent)continue;
   let item=map.get(r.code);if(!item){item={code:r.code,name:r.name,kind:r.kind,twse:0,tpex:0,seen:{twse:new Set(),tpex:new Set()},names:new Set()};map.set(r.code,item);}
   item.name=r.name;item.names.add(r.name);for(const alias of r.aliases||[])item.names.add(alias);item[report.market]+=r.amount;item.seen[report.market].add(report.month);
  }
 }
 const total=totals.twse+totals.tpex;
 const rows=[...map.values()].map(r=>({...r,amount:r.twse+r.tpex,share:total?(r.twse+r.tpex)/total*100:0,twseShare:total?r.twse/total*100:0,tpexShare:total?r.tpex/total*100:0})).sort((a,b)=>b.amount-a.amount||a.code.localeCompare(b.code));
 return {rows,total,totals};
}
export function monthly(reports,market,codes,kind='group',parent=''){
 return [...new Set(reports.map(r=>r.month))].sort().map(month=>{
  const a=aggregate(reports.filter(r=>r.month===month),market,kind,parent);
  return {month,values:codes.map(code=>a.rows.find(r=>r.code===code)??null)};
 });
}
export function monthlyEntities(reports,market,entities){
 return [...new Set(reports.map(r=>r.month))].sort().map(month=>({month,values:entities.map(entity=>{
  const a=aggregate(reports.filter(r=>r.month===month),market,entity.kind==='group'?'group':'branch',entity.parent||'');
  return a.rows.find(r=>r.code===entity.code)??null;
 })}));
}
