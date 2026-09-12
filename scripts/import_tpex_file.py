"""Import a user-supplied TPEx XLS after full report validation."""
from __future__ import annotations
import argparse, hashlib
from pathlib import Path
from update_data import DATA, parse_tpex, rebuild_manifest, save

parser=argparse.ArgumentParser()
parser.add_argument('file',type=Path)
parser.add_argument('--month',required=True)
args=parser.parse_args()
blob=args.file.read_bytes()
report=parse_tpex(blob,args.month)
report.update(
    month=args.month,
    verifiedMonth=args.month,
    market='tpex',
    source='https://www.tpex.org.tw/zh-tw/mainboard/trading/statistics/securities-firms/trading-amount.html',
    provenance=f'使用者提供的官方月報檔案：{args.file.name}',
    sha256=hashlib.sha256(blob).hexdigest(),
)
save(DATA/'months'/f'{args.month}-tpex.json',report)
rebuild_manifest()
print(f'{args.month} tpex: {len(report["rows"])} rows, reconciled')
