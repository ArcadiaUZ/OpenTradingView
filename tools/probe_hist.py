import json, urllib.request, datetime, time

def fmt(b):
    return datetime.datetime.utcfromtimestamp(b['time']).strftime('%Y-%m-%d %H:%M')

def get(tf, count=1500, before=0):
    u = 'http://127.0.0.1:8787/api/history?symbol=EURUSD&tf=%s&count=%d' % (tf, count)
    if before:
        u += '&before=%d' % before
    t0 = time.time()
    with urllib.request.urlopen(u, timeout=240) as r:
        d = json.load(r)
    bars = d['bars']
    print('%-3s before=%-11s n=%-5d first=%s last=%s  %.1fs' % (tf, before or '-', len(bars), fmt(bars[0]) if bars else '-', fmt(bars[-1]) if bars else '-', time.time() - t0), flush=True)
    return bars

b = get('1m')
for _ in range(3):
    if not b:
        break
    b = get('1m', before=b[0]['time'])
for tf in ['5m', '15m', '1h', '4h', '1D']:
    get(tf)
print('DONE', flush=True)