"""Build data/bestiary.json: a compact, searchable index of every creature in the 5etools bestiary.

Usage:  python -I tools/build_bestiary.py [--src DIR] [--out data/bestiary.json]

Without --src the files are downloaded from the 5etools mirror (data/bestiary/*.json, books.json, adventures.json).
The index keeps names and game numbers only (size, type, CR, AC, HP, speed, ability scores, flags) plus the token art
path; stat-block text is never committed. The app reads the full stat block from the mirror at runtime, in the DM's
browser, when it is opened (assets/js/ring/bestiary.js).
"""
import argparse
import json
import os
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone

MIRROR = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/'
COLS = ['name', 'src', 'size', 'type', 'cr', 'ac', 'hp', 'hpf', 'speed', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'flags', 'token', 'page', 'alias']
# flags: s = SRD / basic rules, l = legendary, n = named NPC, t = has token art


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=90) as r:
        return json.loads(r.read().decode('utf-8'))


def load(src_dir, name):
    if src_dir:
        path = os.path.join(src_dir, name)
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                return json.load(f)
    sub = '' if name in ('books.json', 'adventures.json') else 'bestiary/'
    return fetch_json(MIRROR + sub + name)


def token_name(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    return s.replace('"', '')


def type_str(t):
    if t is None:
        return ''
    if isinstance(t, str):
        return t
    base = t.get('type', '')
    if isinstance(base, dict):
        base = '/'.join(base.get('choose', [])) or ''
    if t.get('swarmSize'):
        base = f"swarm of {size_name(t['swarmSize'])} {base}s"
    tags = []
    for tag in t.get('tags', []) or []:
        tags.append(tag if isinstance(tag, str) else (tag.get('prefix', '') + ' ' + tag.get('tag', '')).strip())
    return f"{base} ({', '.join(tags)})" if tags else base


SIZES = {'T': 'Tiny', 'S': 'Small', 'M': 'Medium', 'L': 'Large', 'H': 'Huge', 'G': 'Gargantuan', 'V': 'Varies'}


def size_name(letter):
    return SIZES.get(letter, letter)


def cr_str(cr):
    if cr is None:
        return ''
    if isinstance(cr, dict):
        return str(cr.get('cr', ''))
    return str(cr)


def ac_num(ac):
    if not ac:
        return None
    first = ac[0]
    if isinstance(first, (int, float)):
        return int(first)
    if isinstance(first, dict):
        if 'ac' in first:
            return int(first['ac'])
        if 'special' in first:
            return None
    return None


def speed_str(sp):
    if not sp:
        return '', None
    if isinstance(sp, (int, float)):
        return f'{sp} ft.', int(sp)
    parts = []
    walk = None
    for k in ('walk', 'burrow', 'climb', 'fly', 'swim'):
        v = sp.get(k)
        if v is None:
            continue
        if isinstance(v, dict):
            num = v.get('number')
            cond = v.get('condition', '')
        else:
            num, cond = v, ''
        if k == 'walk':
            walk = num if isinstance(num, (int, float)) else None
            parts.append(f'{num} ft.' + (f' {cond}' if cond else ''))
        else:
            hover = ' (hover)' if k == 'fly' and sp.get('canHover') else ''
            parts.append(f'{k} {num} ft.{hover}' + (f' {cond}' if cond else ''))
    return ', '.join(parts), walk


def resolve(m, by_key, depth=0):
    """Apply _copy shallowly: the copied creature's fields, then this one's (the index needs numbers, not text)."""
    c = m.get('_copy')
    if not c or depth > 6:
        return m
    base = by_key.get((c.get('name', '').lower(), c.get('source', '').lower()))
    if not base:
        return m
    base = resolve(base, by_key, depth + 1)
    out = {k: v for k, v in base.items() if not k.startswith('_')}
    for k, v in m.items():
        if k != '_copy':
            out[k] = v
    mod = c.get('_mod') or {}
    # The few _mod operations that change indexed numbers.
    for prop, ops in mod.items():
        if prop == '*' or not isinstance(ops, (list, dict)):
            continue
        for op in ops if isinstance(ops, list) else [ops]:
            if not isinstance(op, dict):
                continue
            if op.get('mode') == 'scalarAddProp' and prop in ('str', 'dex', 'con', 'int', 'wis', 'cha'):
                out[prop] = (out.get(prop) or 10) + int(op.get('scalar', 0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', help='local folder with index.json, bestiary-*.json, books.json, adventures.json')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'bestiary.json'))
    a = ap.parse_args()

    index = load(a.src, 'index.json')
    monsters = []
    for code, fname in index.items():
        try:
            monsters += load(a.src, fname).get('monster', [])
        except Exception as e:  # noqa: BLE001
            print(f'skip {fname}: {e}', file=sys.stderr)
    by_key = {(m['name'].lower(), m['source'].lower()): m for m in monsters}

    sources = {}
    for fname, key in (('books.json', 'book'), ('adventures.json', 'adventure')):
        try:
            for b in load(a.src, fname).get(key, []):
                sources[b['id']] = b['name']
        except Exception as e:  # noqa: BLE001
            print(f'no {fname}: {e}', file=sys.stderr)

    rows = []
    for raw in monsters:
        m = resolve(raw, by_key)
        size = m.get('size') or []
        speed, walk = speed_str(m.get('speed'))
        hp = m.get('hp') or {}
        flags = ''
        if m.get('srd') or m.get('srd52') or m.get('basicRules') or m.get('basicRules2024'):
            flags += 's'
        if m.get('legendary'):
            flags += 'l'
        if m.get('isNamedCreature'):
            flags += 'n'
        if raw.get('hasToken') or m.get('hasToken'):
            flags += 't'
        tok = token_name(raw['name']) if 't' in flags else ''
        alias = m.get('alias') or []
        rows.append([
            raw['name'], raw['source'], '/'.join(size), type_str(m.get('type')), cr_str(m.get('cr')),
            ac_num(m.get('ac')), hp.get('average'), hp.get('formula') or hp.get('special') or '', speed,
            m.get('str'), m.get('dex'), m.get('con'), m.get('int'), m.get('wis'), m.get('cha'),
            flags, '' if tok == raw['name'] else tok, raw.get('page') or None, alias[:4] if isinstance(alias, list) else [],
        ])
        if walk is not None:
            pass
    rows.sort(key=lambda r: (r[0].lower(), r[1]))
    used = sorted({r[1] for r in rows})
    out = {
        'v': 1,
        'built': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'about': 'Index of the 5etools bestiary (names and game numbers only). Full stat blocks are read from the mirror at runtime.',
        'cols': COLS,
        'sources': {s: sources.get(s, s) for s in used},
        'rows': rows,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'{len(rows)} creatures from {len(used)} sources -> {os.path.abspath(a.out)} ({os.path.getsize(a.out) // 1024} KB)')


if __name__ == '__main__':
    main()
