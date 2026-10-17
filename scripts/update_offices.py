"""Publish TWSE's current head-office and branch address directory."""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import re
from pathlib import Path

from update_data import DATA, fetch, save

HEAD_URL = 'https://www.twse.com.tw/brokerService/brokerList?response=open_data'
BRANCH_URL = 'https://mopsfin.twse.com.tw/opendata/OpenData_BRK02.csv'
CATHAY_URL = 'https://www.cathaysec.com.tw/exclude_al/friendly/location.html'
TAISHIN_URL = 'https://www.tssco.com.tw/TSHOLDINGSMERGE/locations/index.html'
FIRST_URL = 'https://www.taifex.com.tw/cht/4/fCMData?fut_id=S538'
# These trading codes are absent from the current TWSE/MOPS office export.
# A head-office link supplies a city for historical brokerage departments; it
# must never be used to add their turnover to the head-office trading row.
EXTRA_OFFICES = {
    '538L': ('第一金華山／經紀部', '台北市中山區長安東路一段22號4樓', '5380', FIRST_URL),
    '8889': ('國泰敦南', '台北市大安區敦化南路二段218號5樓之1', None, CATHAY_URL),
    '888V': ('國泰敦南', '台北市大安區敦化南路二段218號5樓之1', None, CATHAY_URL),
    '9B17': ('台新營業部', '台北市中山區中山北路二段44號2樓', None, TAISHIN_URL),
    '9182': ('群益金鼎經紀部', None, '9100', None),
    '9203': ('凱基經紀部', None, '9200', None),
    '9699': ('富邦經紀部', None, '9600', None),
    '9887': ('元大經紀部', None, '9800', None),
    '9A95': ('永豐金經紀部', None, '9A00', None),
}
CITIES = (
    '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
    '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣',
    '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
    '臺東縣', '澎湖縣', '金門縣', '連江縣',
)


def city_for(address: str) -> str | None:
    text = re.sub(r'^\s*\d{3,6}\s*', '', address or '').replace('台', '臺').replace('巿', '市')
    aliases = {'臺北縣': '新北市', '臺中縣': '臺中市', '臺南縣': '臺南市',
               '高雄縣': '高雄市', '桃園縣': '桃園市', '北市': '臺北市',
               '南市': '臺南市'}
    for old, current in aliases.items():
        if text.startswith(old):
            return current
    for city in CITIES:
        if text.startswith(city):
            return city
    # Some official rows give the county-administered city without its county.
    for short, county in [('彰化市', '彰化縣'), ('屏東市', '屏東縣'),
                          ('苗栗市', '苗栗縣'), ('南投市', '南投縣'),
                          ('宜蘭市', '宜蘭縣'), ('花蓮市', '花蓮縣'),
                          ('臺東市', '臺東縣')]:
        if text.startswith(short):
            return county
    return None


def parse_directory(head_bytes: bytes, branch_bytes: bytes) -> dict:
    rows = []
    for kind, blob in [('head', head_bytes), ('branch', branch_bytes)]:
        reader = csv.DictReader(io.StringIO(blob.decode('utf-8-sig')))
        for item in reader:
            code = item['證券商代號'].strip()
            address = item['地址'].strip()
            if not re.fullmatch(r'[0-9A-Za-z]{4}', code):
                raise ValueError(f'Invalid office code: {code}')
            rows.append(dict(code=code, kind=kind, name=item['證券商名稱'].strip(),
                             address=address, city=city_for(address)))
    if len([row for row in rows if row['kind'] == 'head']) < 60:
        raise ValueError('Incomplete head-office directory')
    if len([row for row in rows if row['kind'] == 'branch']) < 800:
        raise ValueError('Incomplete branch directory')
    if len({row['code'] for row in rows}) != len(rows):
        raise ValueError('Duplicate office code across directories')
    indexed = {row['code']: row for row in rows}
    for code, (name, address, head_code, source) in EXTRA_OFFICES.items():
        # An official directory entry takes precedence if it appears later.
        if code in indexed:
            continue
        head = indexed.get(head_code) if head_code else None
        city = city_for(address) if address else head['city'] if head else None
        if not city:
            raise ValueError(f'No verified city for {code}')
        rows.append(dict(code=code, kind='branch', name=name,
                         address=address or '', city=city,
                         locationBasis='office' if address else 'head-city',
                         **({'relatedHeadCode': head_code} if head_code else {}),
                         **({'source': source} if source else {})))
    return dict(version=1, updated=dt.datetime.now(dt.timezone.utc).isoformat(),
                sources=dict(head=HEAD_URL, branch=BRANCH_URL), cities=CITIES, rows=rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--head-file', type=Path, help='Use downloaded TWSE CSV')
    parser.add_argument('--branch-file', type=Path, help='Use downloaded MOPS CSV')
    args = parser.parse_args()
    head = args.head_file.read_bytes() if args.head_file else fetch(HEAD_URL)
    branch = args.branch_file.read_bytes() if args.branch_file else fetch(BRANCH_URL)
    directory = parse_directory(head, branch)
    path = DATA / 'offices.json'
    if path.exists():
        old = json.loads(path.read_text(encoding='utf-8'))
        if old['rows'] == directory['rows']:
            print(f'Address directory unchanged: {len(old["rows"])} offices')
            return
    save(path, directory)
    print(f'Address directory updated: {len(directory["rows"])} offices')


if __name__ == '__main__':
    main()
