"""Fetch official monthly reports; reject inconsistent data before publication."""
from __future__ import annotations
import argparse, datetime as dt, hashlib, io, json, os, re, ssl, time, urllib.request, urllib.parse, zipfile
from pathlib import Path
import xlrd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'site/data'
CACHE = ROOT / '.cache'
class UnavailableMonth(ValueError):
    """Official download exists but contains a different reporting month."""

def fetch(url):
    context = ssl.create_default_context()
    # Optional compatibility for enterprise root certificates; verification stays enabled.
    if os.environ.get('BROKER_TLS_COMPAT') == '1':
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    elif os.environ.get('BROKER_TLS_COMPAT') == 'insecure-local':
        # Explicit local-only escape hatch for hosts whose TLS interception chain
        # cannot be validated. CI and normal runs keep certificate verification.
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    for attempt in range(3):
        try:
            req = urllib.request.Request(url,headers={
                'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
                'Accept':'*/*',
                'Referer':'https://www.twse.com.tw/zh/trading/statistics/index03.html',
            })
            with urllib.request.urlopen(req, context=context, timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 2: raise
            time.sleep(2 ** attempt)

def cached(url):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if not path.exists(): path.write_bytes(fetch(url))
    return path.read_bytes()

def code(value):
    # Case is significant: e.g. 601d must not be merged with 601D.
    if isinstance(value, (float,int)): return f'{int(value):04d}'
    return str(value).strip().replace('＊','*')

def amount(value):
    if isinstance(value,str): value=value.replace(',','').strip()
    value=float(value)
    if value < 0 or not value.is_integer(): raise ValueError(f'Invalid NTD amount {value}')
    return int(value)

def rows(blob):
    if blob.startswith(b'PK'):
        z=zipfile.ZipFile(io.BytesIO(blob))
        names=[n for n in z.namelist() if n.lower().endswith('.xls')]
        if len(names)!=1: raise ValueError('Expected exactly one XLS report')
        blob=z.read(names[0])
    sheet=xlrd.open_workbook(file_contents=blob).sheet_by_index(0)
    return [sheet.row_values(i) for i in range(sheet.nrows)]

def validate(result):
    records=result['rows']
    if len(records)<100: raise ValueError('Report has too few rows')
    if len({r['code'] for r in records})!=len(records): raise ValueError('Duplicate broker code')
    groups={r['code']:r for r in records if r['kind']=='group'}
    totals={k:0 for k in groups}
    for r in records:
        if r['kind'] in ('head','branch'):
            if r['parent'] not in groups: raise ValueError(f'Missing parent: {r}')
            totals[r['parent']]+=r['amount']
    for k,r in groups.items():
        if totals[k]!=r['amount']: raise ValueError(f'Branch reconciliation failed: {k}: {totals[k]} != {r["amount"]}')
    expected=sum(r['amount'] for r in records if r['kind'] in ('group','dealer'))
    if expected!=result['total']: raise ValueError(f'Market reconciliation failed: {expected} != {result["total"]}')
    for r in records:
        if r.get('officialShare') is not None:
            if abs(r['amount']/result['total']*100-r['officialShare'])>0.00101:
                raise ValueError(f'Official share mismatch {r["code"]}')
    return result

def known_names():
    """Use the newest already verified spelling when legacy XLS text is damaged."""
    found={}
    for path in sorted((DATA/'months').glob('*.json')):
        try: report=json.loads(path.read_text(encoding='utf-8'))
        except Exception: continue
        for r in report.get('rows',[]):
            if r.get('name') and '\ufffd' not in r['name']: found[r['code']]=r['name']
    return found

def known_group_codes():
    groups=set()
    for path in sorted((DATA/'months').glob('*-twse.json')):
        try: report=json.loads(path.read_text(encoding='utf-8'))
        except Exception: continue
        groups.update(r['code'] for r in report.get('rows',[]) if r.get('kind')=='group')
    return groups

def clean_name(c,name,names):
    name=str(name).strip()
    return names.get(c,name if name and '\ufffd' not in name else c)

def parse_twse_legacy(source):
    names=known_names(); raw=[]
    # Early 2015 workbooks can place records in two five-column print blocks.
    for row in source:
        for offset in (0,6):
            if len(row)<offset+5: continue
            c=code(row[offset])
            if not re.fullmatch(r'[0-9A-Za-z]{3}[0-9A-Za-z*]',c): continue
            try: value=amount(row[offset+3]); share=float(row[offset+4])
            except Exception: continue
            raw.append((c,row[offset+1],value,share))
    group_codes={c for c,_,_,_ in raw if c.endswith('*')}
    out=[]; missing_groups={}
    for c,name,value,share in raw:
        if c.endswith('*'): kind='group'; parent=c
        elif c.endswith('T'): kind='dealer'; parent=None
        else:
            parent=c[:3]+'*'
            if parent not in group_codes:
                candidates=[g for g in group_codes if g[:2]==c[:2]]
                if len(candidates)==1: parent=candidates[0]
            kind='head' if c==parent[:3]+'0' else 'branch'
            if parent not in group_codes: missing_groups[parent]=missing_groups.get(parent,0)+value
        out.append(dict(code=c,name=clean_name(c,name,names),kind=kind,parent=parent,amount=value))
    out.extend(dict(code=c,name=clean_name(c,c,names),kind='group',parent=c,amount=value) for c,value in missing_groups.items())
    total=sum(r['amount'] for r in out if r['kind'] in ('group','dealer'))
    return validate(dict(total=total,rows=out))

def parse_twse(blob, expected_month=None):
    source=rows(blob)
    if expected_month:
        actual=xlrd.xldate_as_datetime(source[0][0],0).strftime('%Y-%m')
        if actual!=expected_month: raise UnavailableMonth(f'Wrong report month: {actual} != {expected_month}')
    if not any('當月成交金額' in str(x) for r in source[:5] for x in r):
        if any('Amount (NTD)' in str(x) for r in source[:5] for x in r): return parse_twse_legacy(source)
        raise ValueError('Unrecognized TWSE headers')
    out=[]; parent=None
    group_codes={code(r[0]) for r in source if code(r[0]).endswith('*')}
    for r in source:
        c=code(r[0])
        if not re.fullmatch(r'[0-9A-Za-z]{3}[0-9A-Za-z*]',c): continue
        label=re.sub(r'\s','',str(r[2]))
        if c.endswith('*'): kind='group'; p=c
        elif label=='自營商': kind='dealer'; p=None
        elif label=='分公司': kind='branch'; p=parent
        elif label=='證券':
            candidate=c[:3]+'*'
            if candidate not in group_codes:
                candidates=[g for g in group_codes if g[:2]==c[:2]]
                if len(candidates)!=1: raise ValueError(f'Ambiguous parent for {c}')
                candidate=candidates[0]
            parent=candidate; p=parent
            kind='head' if c==parent[:3]+'0' else 'branch'
        else: raise ValueError(f'Unknown TWSE row type: {r}')
        out.append(dict(code=c,name=str(r[1]).strip(),kind=kind,parent=p,amount=amount(r[3]),officialShare=float(r[4])))
    total=sum(r['amount'] for r in out if r['kind'] in ('group','dealer'))
    return validate(dict(total=total,rows=out))

def parse_tpex(blob, expected_month=None):
    source=rows(blob)
    if expected_month:
        match=re.search(r'(\d{2,3})年\s*(\d{1,2})月',str(source[0]))
        if not match: raise ValueError('Missing TPEx report date')
        actual=f'{int(match[1])+1911}-{int(match[2]):02d}'
        if actual!=expected_month: raise UnavailableMonth(f'Wrong report month: {actual} != {expected_month}')
    if not any('AMOUNT(NTD)' in str(x).replace(' ','') for r in source[:10] for x in r):
        raise ValueError('Unrecognized TPEx headers')
    names=known_names()
    # Older TPEx exports list each office and dealer without broker subtotal rows.
    compact=[[x for x in row if x!=''] for row in source]
    flat=[r for r in compact if len(r)>=3 and re.fullmatch(r'[0-9A-Za-z]{3}[0-9A-Za-z*]',code(r[0])) and isinstance(r[2],(int,float))]
    if flat and not any(code(r[0]).endswith('*') for r in flat):
        items={}; total=None
        for r in flat:
            c=code(r[0]); value=amount(r[2]); name=clean_name(c,r[1],names)
            if c in items: items[c]['amount']+=value
            else: items[c]=dict(code=c,name=name,kind='dealer' if c.endswith('T') else ('head' if c.endswith('0') else 'branch'),parent=None,amount=value)
        for r in compact:
            if r and 'Total' in str(r[0]) and len(r)>1 and isinstance(r[1],(int,float)): total=amount(r[1])
        if total is None: raise ValueError('Missing TPEx legacy market total')
        out=list(items.values()); groups={}; known_groups=known_group_codes()
        for item in out:
            if item['kind']=='dealer': continue
            parent=item['code'][:3]+'*'
            if parent not in known_groups:
                candidates=[g for g in known_groups if g[:2]==item['code'][:2]]
                if len(candidates)==1: parent=candidates[0]
            item['parent']=parent
            groups.setdefault(parent,dict(code=parent,name=clean_name(parent,item['name'],names),kind='group',parent=parent,amount=0))['amount']+=item['amount']
        out.extend(groups.values())
        return validate(dict(total=total,rows=out))
    out=[]; pending=[]; total=None
    # Export has merged cells: compact each physical row and read the first amount,
    # never the year-to-date value. Some years put % on the following row.
    for i,row in enumerate(source):
        r=[x for x in row if x!='']
        if len(r)<3: continue
        c=code(r[0]); name=str(r[1]).strip()
        if re.fullmatch(r'[0-9A-Za-z]{3}[0-9A-Za-z*]',c) and isinstance(r[2],(int,float)):
            if '自營' in name or (c.endswith('T') and not pending): kind='dealer'
            elif c.endswith('*'): kind='group'
            else: kind='head' if not pending else 'branch'
            item=dict(code=c,name=name,kind=kind,parent=None,amount=amount(r[2]))
            if kind=='dealer': out.append(item)
            elif kind=='group':
                for entry in pending: entry['parent']=c
                item['parent']=c; out.extend(pending); out.append(item); pending=[]
            else: pending.append(item)
        elif '經紀合計' in str(r[0]):
            if not pending: raise ValueError('Subtotal without branches')
            parent=pending[0]['code'][:3]+'*'
            for entry in pending: entry['parent']=parent
            out.extend(pending)
            out.append(dict(code=parent,name=str(r[0]).replace('經紀合計','').strip(),kind='group',parent=parent,amount=amount(r[1])))
            pending=[]
        elif re.sub(r'\s','',str(r[0])) in ('合計Total','合計','總計Total'):
            total=amount(r[1])
    if pending: raise ValueError('Unclosed TPEx broker group')
    if total is None: raise ValueError('Missing TPEx market total')
    # Renames may split a month's activity across old/new name rows of one code.
    # Sum within the same parent, preserve aliases, and reconcile to the official subtotal.
    unique={}
    for r in out:
        old=unique.get(r['code'])
        if old:
            if old['parent']!=r['parent'] or ((old['kind']=='dealer')!=(r['kind']=='dealer')):
                raise ValueError(f'Ambiguous duplicate {r["code"]}')
            chosen=r if r['amount'] else old
            combined_amount=old['amount']+r['amount']
            chosen['aliases']=sorted(set(old.get('aliases',[])+[old['name'],r['name']]))
            if old['kind']=='head' or r['kind']=='head': chosen['kind']='head'
            chosen['amount']=combined_amount
            unique[r['code']]=chosen
        else: unique[r['code']]=r
    out=list(unique.values())
    return validate(dict(total=total,rows=out))

def catalog(year,market):
    if market=='twse':
        j=json.loads(fetch(f'https://www.twse.com.tw/rwd/zh/statistics/download?type=03&date={year}0101&response=json'))
        row=next(r for r in j['data'] if r[0]=='證券商成交金額表')
        return {f'{year}-{m:02d}':'https://www.twse.com.tw'+urllib.parse.parse_qs(urllib.parse.urlsplit(u).query).get('url',[u])[0] for m,u in enumerate(row[1:13],1) if u}
    j=json.loads(fetch(f'https://www.tpex.org.tw/www/zh-tw/statistics/brokerMonthly?type=vol&date={year}&response=json'))
    return {f'{year}-{int(r[0].split("/")[1]):02d}':'https://www.tpex.org.tw/www'+r[1] for r in j['tables'][0]['data']}

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    tmp.replace(path)

def closures():
    url='https://dsp.twse.com.tw/brokerClose/outPutExcel'
    out=[]
    for r in rows(fetch(url))[1:]:
        c=code(r[0]); date=str(r[3]).strip()
        if not re.fullmatch('[0-9A-Za-z]{4}',c): continue
        match=re.fullmatch(r'(\d{2,3})/(\d{2})/(\d{2})',date)
        if not match: raise ValueError(f'Unrecognized closure date {date}')
        y,m,d=map(int,match.groups())
        out.append(dict(code=c,name=r[1],reason=r[2],date=dt.date(y+1911,m,d).isoformat(),successor=r[4]))
    if len(out)<300: raise ValueError('Incomplete closure list')
    return dict(source=url,updated=dt.datetime.now(dt.timezone.utc).isoformat(),rows=out)

def rebuild_manifest(errors=None,warnings=None):
    months={}; brokers={}
    for path in sorted((DATA/'months').glob('*.json')):
        j=json.loads(path.read_text(encoding='utf-8'))
        months.setdefault(j['month'],[]).append(j['market'])
        for r in j['rows']:
            if r['kind']=='group': brokers[r['code']]=dict(code=r['code'],name=r['name'])
    save(DATA/'manifest.json',dict(
        version=1,
        updated=dt.datetime.now(dt.timezone.utc).isoformat(),
        months=months,
        brokers=sorted(brokers.values(),key=lambda r:r['code']),
        errors=errors or [], warnings=warnings or [],
    ))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--start',default='2023-01')
    parser.add_argument('--end',default=dt.date.today().strftime('%Y-%m'))
    parser.add_argument('--refresh',action='store_true',help='Redownload all selected months')
    args=parser.parse_args()
    for value in (args.start,args.end): dt.datetime.strptime(value,'%Y-%m')
    if args.start>args.end: parser.error('start must not exceed end')
    errors=[]; warnings=[]
    for year in range(int(args.start[:4]),int(args.end[:4])+1):
        for market,parse in [('twse',parse_twse),('tpex',parse_tpex)]:
            selected=[f'{year}-{m:02d}' for m in range(1,13) if args.start<=f'{year}-{m:02d}'<=args.end]
            if all((DATA/'months'/f'{month}-{market}.json').exists() for month in selected) and not args.refresh: continue
            try: available=catalog(year,market)
            except Exception as e: errors.append(f'{year}/{market}: {e}'); continue
            for month,url in sorted(available.items()):
                if not args.start<=month<=args.end: continue
                path=DATA/'months'/f'{month}-{market}.json'
                if path.exists() and not args.refresh: continue
                try:
                    blob=fetch(url) if args.refresh else cached(url)
                    report=parse(blob,month)
                    report.update(month=month,verifiedMonth=month,market=market,source=url,sha256=hashlib.sha256(blob).hexdigest())
                    save(path,report)
                    print(f'{month} {market}: {len(report["rows"])} rows, reconciled',flush=True)
                except UnavailableMonth as e:
                    warnings.append(f'{month}/{market}: {e}')
                    print('WARNING: '+warnings[-1],flush=True)
                except Exception as e: errors.append(f'{month}/{market}: {e}'); print(errors[-1],flush=True)
                time.sleep(.15)
    try: save(DATA/'closures.json',closures())
    except Exception as e: errors.append(f'closures: {e}')
    rebuild_manifest(errors,warnings)
    if errors: raise SystemExit('\n'.join(errors))

if __name__=='__main__': main()
