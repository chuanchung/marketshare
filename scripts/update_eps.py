"""Download TWSE integrated broker financials and calculate estimated EPS."""
from __future__ import annotations
import argparse, datetime as dt, hashlib, io, json, os, re, ssl, urllib.parse, urllib.request
from pathlib import Path
import openpyxl
import xlrd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'site/data'
EPS_DIR = DATA / 'eps'

def fetch(url):
    context = ssl.create_default_context()
    if os.environ.get('BROKER_TLS_COMPAT') == '1':
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, context=context, timeout=60) as response:
        return response.read()

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)

def compact(value):
    return re.sub(r'\s+', '', str(value or ''))

def parse(blob, expected_month, source):
    if blob.startswith(b'PK'):
        # TWSE workbooks define a print area that can truncate read-only iteration.
        sheet = openpyxl.load_workbook(io.BytesIO(blob), data_only=True).active
        rows = list(sheet.iter_rows(values_only=True))
    else:
        sheet = xlrd.open_workbook(file_contents=blob).sheet_by_index(0)
        rows = [sheet.row_values(i) for i in range(sheet.nrows)]
    period = next((compact(v) for row in rows[:3] for v in row if '月份' in str(v)), '')
    roc_year, month = map(int, re.search(r'(\d+)年(\d+)月份', period).groups())
    actual = f'{roc_year + 1911:04d}-{month:02d}'
    if actual != expected_month:
        raise ValueError(f'Wrong EPS report month: {actual} != {expected_month}')
    records = []
    for i, row in enumerate(rows):
        if compact(row[0] if row else '') != '證券商名稱及代號':
            continue
        block = range(i + 1, min(i + 36, len(rows)))
        capital_row = next((n for n in block if compact(rows[n][0]) == '資本'), None)
        current_period = next((n for n in block if compact(rows[n][0]) == '本期'), None)
        profit_row = next((n for n in block if current_period is not None and n > current_period and
                           '稅後淨利' in {compact(rows[n][0]), compact(rows[n][1])}), None)
        if capital_row is None or profit_row is None:
            raise ValueError(f'Unexpected financial report layout near row {i + 1}')
        for col in range(2, len(row)):
            label = compact(row[col])
            match = re.fullmatch(r'([0-9A-Za-z]{4})(.+)', label)
            if not match:
                continue
            raw_code, name = match.groups()
            capital = rows[capital_row][col]
            profit = rows[profit_row][col]
            if not isinstance(capital, (int, float)) or capital <= 0 or not isinstance(profit, (int, float)):
                continue
            code = raw_code[:3] + '*' if raw_code.endswith('0') else raw_code
            shares = round(capital * 100)  # 千元 × 1,000 ÷ 每股面額 10 元
            eps = profit * 1000 / shares
            records.append(dict(code=code, rawCode=raw_code, name=name, capitalThousands=capital,
                                netIncomeThousands=profit, preferredDividends=None,
                                estimatedShares=shares, estimatedEps=round(eps, 6)))
    if len(records) < 20 or len({r['code'] for r in records}) != len(records):
        raise ValueError(f'Invalid EPS broker rows: {len(records)}')
    return dict(month=expected_month, source=source, unit='NTD', basis='cumulative-period',
                formula='netIncomeThousands * 1000 / (capitalThousands * 100)',
                preferredDividendsAvailable=False, rows=records)

def catalog(year):
    url = f'https://www.twse.com.tw/rwd/zh/statistics/download?type=03&date={year}0101&response=json'
    data = json.loads(fetch(url))['data']
    if len(data) < 4:
        raise ValueError(f'No integrated financial report catalog for {year}')
    row = data[3]
    return {f'{year}-{month:02d}': urllib.parse.urljoin('https://www.twse.com.tw', link)
            for month, link in enumerate(row[1:13], 1) if link}

def rebuild_manifest():
    months = {}
    brokers = {}
    for path in sorted(EPS_DIR.glob('*.json')):
        report = json.loads(path.read_text(encoding='utf-8'))
        months[report['month']] = path.name
        for row in report['rows']:
            brokers[row['code']] = dict(code=row['code'], name=row['name'])
    save(DATA / 'eps-manifest.json', dict(version=1, updated=dt.datetime.now(dt.timezone.utc).isoformat(),
         months=months, brokers=sorted(brokers.values(), key=lambda r: r['code'])))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default='2015-01')
    parser.add_argument('--end', default=dt.date.today().strftime('%Y-%m'))
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    EPS_DIR.mkdir(parents=True, exist_ok=True)
    changed = False
    for year in range(int(args.start[:4]), int(args.end[:4]) + 1):
        selected = [f'{year}-{m:02d}' for m in range(1, 13) if args.start <= f'{year}-{m:02d}' <= args.end]
        if selected and all((EPS_DIR / f'{m}.json').exists() for m in selected) and not args.refresh:
            continue
        available = catalog(year)
        for month, url in sorted(available.items()):
            if not args.start <= month <= args.end:
                continue
            path = EPS_DIR / f'{month}.json'
            if path.exists() and not args.refresh:
                continue
            blob = fetch(url)
            report = parse(blob, month, url)
            report['sha256'] = hashlib.sha256(blob).hexdigest()
            save(path, report)
            changed = True
            print(f'{month} EPS: {len(report["rows"])} brokers', flush=True)
    if changed or not (DATA / 'eps-manifest.json').exists():
        rebuild_manifest()

if __name__ == '__main__':
    main()
