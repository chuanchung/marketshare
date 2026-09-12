import{test}from'node:test';
import assert from'node:assert/strict';
import{readFileSync,readdirSync}from'node:fs';
import{aggregate,monthly,monthlyEntities,monthRange}from'../site/engine.js';
const row=(code,amount,kind='group',parent=code)=>({code,name:code,amount,kind,parent});
const report=(month,market,total,rows)=>({month,market,total,rows});
test('cross-month percentages use turnover weights, not arithmetic mean',()=>{
 const a=aggregate([report('2025-01','twse',100,[row('102*',20)]),report('2025-02','twse',900,[row('102*',90)])],'twse');
 assert.equal(a.rows[0].share,11);
});
test('combined bar contributions sum to combined share; parents are not double counted',()=>{
 const a=aggregate([report('2025-01','twse',100,[row('102*',20),row('1020',20,'head','102*')]),report('2025-01','tpex',300,[row('102*',90)])],'both');
 assert.equal(a.rows.length,1);assert.equal(a.rows[0].share,27.500000000000004);
 assert.ok(Math.abs(a.rows[0].twseShare+a.rows[0].tpexShare-a.rows[0].share)<1e-12);
});
test('branch identity retains case and explicit monthly parent mapping',()=>{
 const reports=[report('2025-01','twse',100,[row('601D',10,'branch','601*'),row('601d',20,'branch','601*'),row('9182',30,'branch','910*')])];
 assert.equal(aggregate(reports,'twse','branch','601*').rows.length,2);
 assert.equal(aggregate(reports,'twse','branch','910*').rows[0].amount,30);
});
test('missing broker stays missing in trend, reported zero stays zero',()=>{
 const p=monthly([report('2025-01','twse',100,[row('102*',0)]),report('2025-02','twse',100,[])],'twse',['102*']);
 assert.equal(p[0].values[0].share,0);assert.equal(p[1].values[0],null);
});
test('mixed company and branch trend selections retain their own parent mapping',()=>{
 const reports=[report('2025-01','twse',100,[row('102*',30),row('1020',10,'head','102*'),row('1021',20,'branch','102*'),row('980*',40),row('9801',40,'branch','980*')])];
 const p=monthlyEntities(reports,'twse',[{code:'102*',kind:'group'},{code:'9801',kind:'branch',parent:'980*'}]);
 assert.deepEqual(p[0].values.map(x=>x.amount),[30,40]);
});
test('range spans years and rejects inverted dates',()=>{
 assert.deepEqual(monthRange('2024-12','2025-02'),['2024-12','2025-01','2025-02']);
 assert.throws(()=>monthRange('2025-02','2025-01'));
});
test('every bundled report reconciles and official percentages match',()=>{
 const dir=new URL('../site/data/months/',import.meta.url);let count=0;
 for(const filename of readdirSync(dir)){
  const r=JSON.parse(readFileSync(new URL(filename,dir),'utf8'));
  assert.equal(r.verifiedMonth,r.month,filename);
  const groups=r.rows.filter(x=>x.kind==='group');
  assert.equal(new Set(r.rows.map(x=>x.code)).size,r.rows.length,filename);
  assert.equal(r.rows.filter(x=>['group','dealer'].includes(x.kind)).reduce((s,x)=>s+x.amount,0),r.total,filename);
  for(const g of groups){assert.equal(r.rows.filter(x=>['head','branch'].includes(x.kind)&&x.parent===g.code).reduce((s,x)=>s+x.amount,0),g.amount,`${filename} ${g.code}`);}
  for(const x of r.rows){assert.ok(Number.isSafeInteger(x.amount));if(x.officialShare!==undefined)assert.ok(Math.abs(x.amount/r.total*100-x.officialShare)<=.00051,filename);}
  count++;
 }
 assert.ok(count>=88);
});
test('known official January 2025 report values are preserved',()=>{
 const dir=new URL('../site/data/months/',import.meta.url);
 const r=['twse','tpex'].map(m=>JSON.parse(readFileSync(new URL(`2025-01-${m}.json`,dir),'utf8')));
 assert.equal(r[0].rows.find(x=>x.code==='980*').amount,1313001969141);
 assert.equal(r[1].rows.find(x=>x.code==='980*').amount,418822892841);
 assert.equal(r[1].total,2835634883484);
});
