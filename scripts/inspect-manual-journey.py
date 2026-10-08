"""Read-only safe evidence for a user-selected manual journey; no UI automation."""
import argparse
import json
import re
import time
from urllib.parse import urlencode
from urllib.request import urlopen


def get(base, path, **params):
    with urlopen(base + path + '?' + urlencode(params), timeout=20) as response:
        return json.load(response)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('correlation_id')
args = parser.parse_args()
assert re.fullmatch(r'[A-Za-z0-9._-]{1,128}', args.correlation_id), 'Invalid safe ID'
now = time.time()
logs = get('http://localhost:3100', '/loki/api/v1/query_range',
           query='{service_name=~"happy-wallet-web|synthetic-banking-api"} | correlation_id = "' + args.correlation_id + '"',
           start=int((now - 86400) * 1e9), end=int(now * 1e9), limit=200)['data']['result']
trace_ids = set()
for stream in logs:
    fields = stream['stream']
    safe = {key: fields[key] for key in ('service_name', 'http_route', 'http_status', 'journey_type', 'journey_stage', 'outcome', 'failure_category') if key in fields}
    print('Log metadata:', json.dumps(safe), 'records:', len(stream['values']))
    trace_id = fields.get('trace_id', '')
    if re.fullmatch(r'[0-9a-f]{32}', trace_id):
        trace_ids.add(trace_id)
print('Matching log streams:', len(logs), 'trace IDs:', len(trace_ids))
assert logs and trace_ids, 'No matching stored journey evidence within one day'
for trace_id in sorted(trace_ids):
    trace = get('http://localhost:3200', '/api/traces/' + trace_id)
    print('Trace ID:', trace_id)
    spans = []
    for batch in trace.get('batches', trace.get('resourceSpans', [])):
        attrs = batch.get('resource', {}).get('attributes', [])
        service = next((a['value'].get('stringValue') for a in attrs if a['key'] == 'service.name'), 'unknown')
        for scope in batch.get('scopeSpans', batch.get('instrumentationLibrarySpans', [])):
            for span in scope.get('spans', []):
                spans.append((service, span))
                name = span.get('name', '')
                # Print only known fixed instrumentation names; never arbitrary span text.
                allowed = bool(re.fullmatch(r'(browser\.[a-z.]+|login\.authenticate|recipient\.verify|payment\.[a-z_]+|(?:GET|POST) /[a-z0-9/{}/_-]+|(?:SELECT|INSERT|UPDATE|COMMIT|ROLLBACK)(?: [a-z_]+)?)', name))
                print('Span:', service, name if allowed else '[name withheld]', 'kind:', span.get('kind'),
                      'attribute keys:', sorted(a['key'] for a in span.get('attributes', [])),
                      'event count:', len(span.get('events', [])))
    servers = [s for service, s in spans if service == 'synthetic-banking-api' and s.get('kind') == 'SPAN_KIND_SERVER']
    clients = [s for service, s in spans if service == 'happy-wallet-web' and s.get('name') == 'browser.api.request']
    roots = [s for service, s in spans if service == 'happy-wallet-web' and s.get('name') in ('browser.login', 'browser.transfer')]
    assert servers and clients and roots, 'Missing frontend/backend spans'
    assert all(any(s.get('parentSpanId') == c.get('spanId') for c in clients) for s in servers), 'Server parent differs from frontend CLIENT'
    assert all(any(c.get('parentSpanId') == r.get('spanId') for r in roots) for c in clients), 'Frontend CLIENT parent differs from journey'
    print('PASS parent relationship: browser journey -> frontend CLIENT -> FastAPI SERVER')
    allowed_keys = {'banking.correlation_id', 'correlation_id', 'session_id', 'journey.type', 'journey.stage',
                    'outcome', 'failure.category', 'http.method', 'http.route', 'http.status_code',
                    'http.request.method', 'http.status_class', 'db.system'}
    for _, span in spans:
        assert {a['key'] for a in span.get('attributes', [])} <= allowed_keys, 'Unexpected span attribute keys'
        for attribute in span.get('attributes', []):
            if attribute['key'] in ('correlation_id', 'banking.correlation_id'):
                assert attribute['value'].get('stringValue') == args.correlation_id, 'Correlation mismatch'
        assert not span.get('status', {}).get('message'), 'Unexpected status description'
        for event in span.get('events', []):
            assert {a['key'] for a in event.get('attributes', [])} <= allowed_keys, 'Unexpected event attribute keys'
    print('PASS exported span/event attribute keys and empty status descriptions')
