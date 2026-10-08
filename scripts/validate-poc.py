"""Read-only dashboard queries, safe Loki schema and local Markdown link checks.

This is not UI automation or a manual E2E substitute. It prints panel names and
counts only; it never prints log bodies, request data, secrets or database rows.
"""
import argparse
import json
import math
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlencode, unquote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def get(base, path, **params):
    with urlopen(base + path + '?' + urlencode(params), timeout=20) as response:
        return json.load(response)


def markdown_links():
    paths = subprocess.check_output(
        ['git', 'ls-files', '-co', '--exclude-standard'], cwd=ROOT, text=True,
    ).splitlines()
    documents = sorted({ROOT / p for p in paths if p.endswith('.md') and (ROOT / p).is_file()})
    checked = 0
    for document in documents:
        content = re.sub(r'```[\s\S]*?```', '', document.read_text(encoding='utf-8'))
        for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', content):
            target = unquote(target.strip('<>'))
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            path = target.split('#', 1)[0]
            assert (document.parent / path).exists(), f'Broken link: {document.relative_to(ROOT)} -> {target}'
            checked += 1
    print(f'PASS Markdown: {len(documents)} documents; {checked} local links resolve')


def substitute(query):
    for key, value in {
        '$__rate_interval': '5m', '$__range': '30m', '$__interval': '1m',
        '${correlation_id:doublequote}': '""', '${journey:regex}': '.*',
        '${failure_category:regex}': '.*', '${slow_ms}': '100',
        '${correlation_id}': 'poc-final-no-match',
    }.items():
        query = query.replace(key, value)
    return query


def loki(query):
    now = time.time()
    result = get('http://localhost:3100', '/loki/api/v1/query_range', query=query,
                 start=int((now - 1800) * 1e9), end=int(now * 1e9), limit=200)
    assert result['status'] == 'success'
    return result['data']['result']


def dashboards(live):
    names = set()
    for file in sorted((ROOT / 'grafana/dashboards').glob('*.json')):
        dashboard = json.loads(file.read_text())
        assert dashboard['uid'] not in names, 'Duplicate dashboard UID'
        names.add(dashboard['uid'])
        ids = [p['id'] for p in dashboard['panels']]
        assert len(ids) == len(set(ids)), f'Duplicate panel ID: {file.name}'
        for panel in dashboard['panels']:
            for target in panel.get('targets', []):
                kind = target.get('datasource', panel.get('datasource', {})).get('type')
                query = target.get('expr', target.get('query', ''))
                guarded = '${correlation_id:doublequote}' in query
                if guarded:
                    assert 'correlation_id != ""' in query, f'Empty-ID guard missing: {panel["title"]}'
                if not live:
                    continue
                query = substitute(query)
                if kind == 'prometheus':
                    result = get('http://localhost:9090', '/api/v1/query', query=query)
                    assert result['status'] == 'success'
                    if panel['title'] == 'HTTP 5xx percentage':
                        assert all(math.isfinite(float(r['value'][1])) for r in result['data']['result'])
                elif kind == 'loki':
                    result = loki(query)
                    if guarded:
                        assert not result, f'Empty-ID logs matched: {panel["title"]}'
                elif kind == 'tempo':
                    now = int(time.time())
                    if '| quantile_over_time' in query:
                        result = get('http://localhost:3200', '/api/metrics/query_range',
                                     q=query, start=now-1800, end=now, step='60s')
                    else:
                        result = get('http://localhost:3200', '/api/search',
                                     q=query, start=now-1800, end=now, limit=50)
                        if guarded:
                            assert not result.get('traces'), f'Empty-ID traces matched: {panel["title"]}'
                else:
                    raise AssertionError(f'Unknown datasource: {panel["title"]}')
                print('PASS query:', file.stem, '/', panel['title'], '/', target['refId'])
        print('PASS dashboard JSON:', file.name)


def privacy_labels_and_fields():
    prohibited = {'correlation_id', 'trace_id', 'session_id', 'customer_id', 'user_id',
                  'account_id', 'payment_id', 'username', 'amount', 'idempotency_key'}
    result = get('http://localhost:9090', '/api/v1/query',
                 query='{__name__=~"banking_(web|api|login|transfer|payment|recipient)_.*"}')
    assert result['status'] == 'success'
    for row in result['data']['result']:
        assert not prohibited.intersection(row['metric']), 'Prohibited Prometheus label'
    print('PASS metric label privacy:', len(result['data']['result']), 'current series')
    # Query-result maps merge metadata and labels. Check the label API instead
    # of inferring indexing from a result row's keys.
    label_names = get('http://localhost:3100', '/loki/api/v1/labels')['data']
    assert not prohibited.intersection(label_names), 'Context/entity ID became indexed Loki label'
    print('PASS indexed Loki labels:', ', '.join(sorted(label_names)))
    fields = set()
    for row in loki('{service_name=~"happy-wallet-web|synthetic-banking-api"}'):
        fields.update(set(row['stream']) - set(label_names))
        for value in row.get('values', []):
            if len(value) > 2:
                fields.update(value[2])
    assert not (prohibited - {'correlation_id', 'trace_id', 'session_id'}).intersection(fields), 'Prohibited Loki metadata key'
    print('Observed safe schema keys:', ', '.join(sorted(fields)))
    # Field-name verification is not a full sensitive-value audit. Manual payload,
    # span/name/status/event inspection remains required for the real test journey.


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--static', action='store_true', help='No backend requests')
    args = parser.parse_args()
    markdown_links()
    dashboards(not args.static)
    if not args.static:
        privacy_labels_and_fields()
    print('PASS validation; manual browser E2E is a separate acceptance record')
