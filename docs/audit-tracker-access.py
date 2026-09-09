#!/usr/bin/env python3
"""Probe every tracker endpoint with credentials it should not accept."""
import json, sqlite3, subprocess, urllib.request, urllib.error

API = 'http://localhost:3002'
DB = '/Users/danieljing/Desktop/locallink-lite/locallink.db'


def call(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method)
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    data = None
    if body is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=10) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def token_for(email):
    code, body = call('POST', '/api/auth/login',
                      body={'email': email, 'password': 'Password123!'})
    return json.loads(body).get('token', '') if code == 200 else ''


def q(sql):
    con = sqlite3.connect(DB)
    try:
        row = con.execute(sql).fetchone()
        return row[0] if row else None
    finally:
        con.close()


VOL = token_for('rosterA@demo.test')
OWNER = token_for('ecowarriors@example.com')
OTHER = token_for('foodforall@example.com')
ADMIN = token_for('linklocal2@gmail.com')
assert all([VOL, OWNER, OTHER, ADMIN]), 'could not sign in as every role'

EID = q("SELECT id FROM opportunities WHERE title='Somerville Park Planting'")
PC = q(f"SELECT printedCode FROM opportunities WHERE id='{EID}'")
OTHER_ID = q("SELECT id FROM users WHERE email='foodforall@example.com'")

fails = []
def probe(section, name, want, method, path, token=None, body=None):
    code, _ = call(method, path, token, body)
    ok = code == want
    print(f"  {'ok  ' if ok else 'LEAK'}  {name:<46} {code}"
          + ('' if ok else f'  (wanted {want})'))
    if not ok:
        fails.append(f'{section}: {name} returned {code}, wanted {want}')


print("=== the organizer's codes ===")
probe('codes', 'no credentials',                401, 'GET', f'/api/events/{EID}/codes')
probe('codes', 'a volunteer',                   403, 'GET', f'/api/events/{EID}/codes', VOL)
probe('codes', 'a different organization',      403, 'GET', f'/api/events/{EID}/codes', OTHER)
probe('codes', 'the owner',                     200, 'GET', f'/api/events/{EID}/codes', OWNER)

print('=== the roster ===')
probe('roster', 'no credentials',               401, 'GET', f'/api/events/{EID}/roster')
probe('roster', 'a volunteer',                  403, 'GET', f'/api/events/{EID}/roster', VOL)
probe('roster', 'a different organization',     403, 'GET', f'/api/events/{EID}/roster', OTHER)
probe('roster', 'the owner',                    200, 'GET', f'/api/events/{EID}/roster', OWNER)

print('=== scanning ===')
probe('scan', 'no credentials',                 401, 'GET', f'/api/scan/{PC}')
probe('scan', 'an organization trying to scan', 403, 'POST', f'/api/scan/{PC}', OTHER, {})
probe('scan', 'a made-up code',                 404, 'GET', '/api/scan/deadbeef', VOL)
probe('scan', "the public 'what is this'",      200, 'GET', f'/api/scan/{PC}/about')
probe('scan', 'that route on a bad code',       404, 'GET', '/api/scan/deadbeef/about')

print('=== tracker sessions ===')
body = {'title': 'x', 'location': 'y', 'date': '2026-09-01T09:00', 'duration': 2}
probe('sessions', 'no credentials',             401, 'GET', '/api/tracker-sessions')
probe('sessions', 'a volunteer creating one',   403, 'POST', '/api/tracker-sessions', VOL, body)
probe('sessions', 'an unverified organization', 403, 'POST', '/api/tracker-sessions', OTHER, body)

print('=== admin only ===')
probe('admin', 'no credentials',                401, 'GET', '/api/admin/tracker-orgs')
probe('admin', 'a volunteer',                   403, 'GET', '/api/admin/tracker-orgs', VOL)
probe('admin', 'an organization',               403, 'GET', '/api/admin/tracker-orgs', OTHER)
probe('admin', 'an org verifying itself',       403, 'POST', f'/api/admin/tracker-orgs/{OTHER_ID}/verify', OTHER, {'verified': True})
probe('admin', 'the admin',                     200, 'GET', '/api/admin/tracker-orgs', ADMIN)

print('=== committing ===')
probe('commit', 'no credentials',               401, 'POST', '/api/opportunities/COMMIT1/commit')
probe('commit', 'committing with no interest',  400, 'POST', '/api/opportunities/COMMIT1/commit', OTHER)
probe('commit', "reading commitments signed out", 401, 'GET', '/api/me/commitments')

print('=== what the responses actually contain ===')
_, body = call('GET', f'/api/opportunities/{EID}/interested', OWNER)
print(f"  {'LEAK' if '@' in body else 'ok  '}  interested list carries an email address: "
      f"{'YES' if '@' in body else 'no'}")
_, body = call('GET', f'/api/events/{EID}/roster', OWNER)
leaked = [k for k in ('email', 'birthYear', 'phone', 'password') if f'"{k}"' in body]
print(f"  {'LEAK' if leaked else 'ok  '}  roster carries personal fields: {leaked or 'none'}")
_, body = call('GET', f'/api/scan/{PC}/about')
extra = [k for k in json.loads(body) if k not in ('eventTitle', 'orgName')]
print(f"  {'LEAK' if extra else 'ok  '}  public route returns only a name: "
      f"{'extra: ' + str(extra) if extra else 'yes'}")

print()
print(f'{len(fails)} problem(s)' if fails else 'no problems found')
for f in fails:
    print('  -', f)
