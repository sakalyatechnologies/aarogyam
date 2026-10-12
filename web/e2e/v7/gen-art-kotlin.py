# Turns docs/mockups/art/v7-art.json (from extract-art.ts) into the shared module's art catalogue.
# Run: python3 -I web/e2e/v7/gen-art-kotlin.py docs/mockups/art/v7-art.json mobile/shared/src/commonMain/kotlin/com/aarogyam/staff/art
import json,re,sys,os
src,out=sys.argv[1],sys.argv[2]
d=json.load(open(src))
ROLE={'--p':'primary','--p2':'primary2','--on-p':'onPrimary','--pc':'primaryContainer','--on-pc':'onPrimaryContainer','--t':'tertiary','--tc':'tertiaryContainer','--on-tc':'onTertiaryContainer','--bg':'background','--s1':'surface1','--s2':'surface2','--s3':'surface3','--card':'card','--on':'onSurface','--on-v':'onSurfaceVariant','--ol':'outline'}
def num(x):
    s=('%.4f'%x).rstrip('0').rstrip('.')
    if s in ('-0',''): s='0'
    return s+('.0' if '.' not in s else '')
def kstr(s): return '"'+s.replace('\\','\\\\').replace('"','\\"').replace('$','\\$')+'"'
def color(v):
    v=v.strip()
    if v=='currentColor': return 'ArtColor.Current'
    m=re.match(r'var\((--[a-z0-9-]+)\)',v)
    if m:
        if m.group(1) not in ROLE: raise SystemExit('unknown role '+v)
        return f'ArtColor.Role("{ROLE[m.group(1)]}")'
    m=re.match(r'rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)',v)
    if m:
        r,g,b=(int(float(m.group(i))) for i in (1,2,3)); a=float(m.group(4) or 1)
        return f'ArtColor.Fixed("#{r:02x}{g:02x}{b:02x}", {num(a)})'
    if re.match(r'#[0-9a-fA-F]{6}$',v): return f'ArtColor.Fixed("{v.lower()}")'
    if re.match(r'#[0-9a-fA-F]{3}$',v): return f'ArtColor.Fixed("#{"".join(c*2 for c in v[1:]).lower()}")'
    if v in ('white','#fff'): return 'ArtColor.Fixed("#ffffff")'
    if v=='black': return 'ArtColor.Fixed("#000000")'
    raise SystemExit('unknown colour '+v)
def pct(v,default):
    if v is None: return default
    v=v.strip()
    return float(v[:-1])/100 if v.endswith('%') else float(v)
def paint(p,grads):
    if p['kind']=='none': return None
    if p['kind']=='color': return f'ArtPaint.Solid({color(p["value"])})'
    g=grads.get(p['id'])
    if not g: raise SystemExit('missing gradient '+p['id'])
    a=g['attrs']; box=a.get('gradientUnits','objectBoundingBox')!='userSpaceOnUse'
    if 'gradientTransform' in a: raise SystemExit('gradientTransform unsupported '+p['id'])
    stops='listOf('+', '.join(f'ArtStop({num(s["offset"])}, {color(s["color"])}'+(f', {num(s["opacity"])})' if s['opacity']!=1 else ')') for s in g['stops'])+')'
    b='true' if box else 'false'
    if g['type']=='linear':
        return f'ArtPaint.Linear({num(pct(a.get("x1"),0))}, {num(pct(a.get("y1"),0))}, {num(pct(a.get("x2"),1))}, {num(pct(a.get("y2"),0))}, {stops}, {b})'
    return f'ArtPaint.Radial({num(pct(a.get("cx"),.5))}, {num(pct(a.get("cy"),.5))}, {num(pct(a.get("r"),.5))}, {stops}, {b})'
LOOPNAME={'floaty':'float','spk':'twinkle','spk s2':'twinkle2'}
def piece(a):
    grads={g['id']:g for g in a['gradients']}
    rows=[]
    for l in a['layers']:
        args=[kstr(l['d'])]
        if l['matrix']!=[1,0,0,1,0,0]: args.append('matrix = listOf('+', '.join(num(x) for x in l['matrix'])+')')
        f=paint(l['fill'],grads); s=paint(l['stroke'],grads)
        fo=l['fillOpacity']; so=l['strokeOpacity']
        if f: args.append(f'fill = {f}')
        if s: args.append(f'stroke = {s}')
        if s and l['strokeWidth']!=1: args.append(f'strokeWidth = {num(l["strokeWidth"])}')
        op=l['opacity']*(fo if f and not s else 1)
        if op!=1: args.append(f'opacity = {num(op)}')
        if l['cap']=='round': args.append('roundCaps = true')
        if l['join']=='round': args.append('roundJoins = true')
        if l['loops']: args.append('loops = listOf('+', '.join(f'ArtLoop("{LOOPNAME.get(x["loop"],x["loop"])}", {x["node"]})' for x in l['loops'])+')')
        rows.append('ArtLayer('+', '.join(args)+')')
    vb='listOf('+', '.join(num(x) for x in a['viewBox'])+')'
    loops='' if not a['rootLoops'] else ', loops = listOf('+', '.join(kstr(LOOPNAME.get(x,x)) for x in a['rootLoops'])+')'
    return vb, rows, loops
def emit(obj, name, doc, keyfn):
    lines=['// Generated from docs/mockups/art/v7-art.json by web/e2e/v7/gen-art-kotlin.py. Do not edit.','@file:Suppress("ktlint")','','package com.aarogyam.staff.art','',f'/** {doc} */',f'object {name} {{']
    keys=sorted(obj)
    for k in keys:
        vb,rows,loops=piece(obj[k])
        fn=keyfn(k)
        lines.append(f'    private fun {fn}() =')
        lines.append(f'        ArtPiece(')
        lines.append(f'            {vb},')
        lines.append('            listOf(')
        for r in rows: lines.append('                '+r+',')
        lines.append(f'            ){loops},')
        lines.append('        )')
        lines.append('')
    lines.append('    /** Every piece by its mockup name. */')
    lines.append('    val all: Map<String, ArtPiece> by lazy {')
    lines.append('        mapOf(')
    for k in keys: lines.append(f'            "{k}" to {keyfn(k)}(),')
    lines.append('        )')
    lines.append('    }')
    lines.append('}')
    open(os.path.join(out,name+'.kt'),'w').write('\n'.join(lines)+'\n')
emit(d['icons'],'IconArt','The v7 icon set: 24-point stroked icons in the text colour.',lambda k:'icon_'+re.sub(r'\W','_',k))
emit(d['avatars'],'AvatarArt','The illustrated dentist avatars (d1–d8), 100 by 100.',lambda k:'avatar_'+k)
emit(d['art'],'IllustrationArt','The welcome and empty-state illustrations: tooth, family and implant.',lambda k:'art_'+k)
print('ok')
