export const PUBLIC_BANKS = ['104*', '103*', '102*', '538*', '930*', '123*', '700*', '111*'];

// Current directory only: 138*, 152*, 153*, 157* and 891* have closed.
export const ACTIVE_FOREIGN = new Set([
 '136*', '144*', '147*', '148*', '156*', '159*', '165*',
 '844*', '889*', '890*', '896*'
]);

export function topBrokerCodes(rows, domesticOnly=false){
 return rows.filter(row=>row.amount>0&&(!domesticOnly||!ACTIVE_FOREIGN.has(row.code)))
  .slice().sort((a,b)=>b.amount-a.amount||a.code.localeCompare(b.code)).slice(0,15).map(row=>row.code);
}

export function turnoverLeaders(turnover, months, market='both', domesticOnly=false){
 const sums=new Map(), markets=market==='both'?['twse','tpex']:[market];
 for(const month of months)for(const name of markets){
  for(const [code,amount] of Object.entries(turnover.months[month]?.[name]||{}))
   sums.set(code,(sums.get(code)||0)+amount);
 }
 return topBrokerCodes([...sums].map(([code,amount])=>({code,amount})),domesticOnly);
}

export function officeCodesInCity(directory, city, kind=null){
 return new Set(directory.rows.filter(row=>row.city===city&&(!kind||row.kind===kind)).map(row=>row.code));
}

export function brokerCodeForOffice(code){return `${code.slice(0,3)}*`;}

export function brokerCodesInCity(directory,city,headOnly=false){
 return new Set([...officeCodesInCity(directory,city,headOnly?'head':null)].map(brokerCodeForOffice));
}
