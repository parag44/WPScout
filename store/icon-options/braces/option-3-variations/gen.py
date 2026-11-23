import json
D='#23272B'; B='#0284C7'; SKY='#38BDF8'; WH='#F2F4F5'
def braces(c, sw=8, x0=34, top=32, bot=96):
    L=f'M{x0+10} {top}C{x0} {top} {x0} {top+7} {x0} {top+15}v8c0 6-4 9-9 9 5 0 9 3 9 9v8c0 8 0 15 10 15'
    xr=128-x0
    R=f'M{xr-10} {top}c10 0 10 7 10 15v8c0 6 4 9 9 9-5 0-9 3-9 9v8c0 8 0 15-10 15'
    return ''.join(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>' for d in (L,R))
def lensw(ring, w, cx=62, r=13, rw=4.5, ww=3.2, handle=5.5, fill=None, wscale=1.0):
    h=r*0.71
    s=wscale*r/13
    pts=[(-6.5,-4.5),(-3.4,5),(0,-0.4),(3.4,5),(6.5,-4.5)]
    W=' '.join(f'{cx+x*s:.1f} {cx+y*s:.1f}' for x,y in pts)
    disc=f'<circle cx="{cx}" cy="{cx}" r="{r}" fill="{fill}"/>' if fill else ''
    return (disc+f'<circle cx="{cx}" cy="{cx}" r="{r}" fill="none" stroke="{ring}" stroke-width="{rw}"/>'
            f'<path d="M{W.split(" ",2)[0]} {W.split(" ",2)[1]} L{W.split(" ",2)[2]}" fill="none" stroke="{w}" stroke-width="{ww}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M{cx+h+1.5:.1f} {cx+h+1.5:.1f} {cx+h+8:.1f} {cx+h+8:.1f}" stroke="{ring}" stroke-width="{handle}" stroke-linecap="round"/>')
tile=lambda c,rx=10: f'<rect width="128" height="128" rx="{rx}" fill="{c}"/>'
V={
 '3a': ('Bigger lens, bolder W',      tile(D)+braces(WH)+lensw(SKY,SKY,cx=62,r=15,rw=5.5,ww=4.4,handle=6.5)),
 '3b': ('Blue braces, white lens',    tile(D)+braces(SKY)+lensw(WH,WH,cx=62,r=15,rw=5.5,ww=4.4,handle=6.5)),
 '3c': ('White ring, blue W',         tile(D)+braces(WH)+lensw(WH,SKY,cx=62,r=15,rw=5.5,ww=4.6,handle=6.5)),
 '3d': ('Filled blue lens',           tile(D)+braces(WH)+lensw(SKY,D,cx=62,r=15,rw=5.5,ww=4.6,handle=6.5,fill=SKY)),
 '3e': ('Brand blue tile',            tile(B)+braces('#FFFFFF')+lensw('#FFFFFF','#FFFFFF',cx=62,r=15,rw=5.5,ww=4.4,handle=6.5)),
 '3f': ('Wide braces, large lens',    tile(D)+braces(WH,sw=7.5,x0=28,top=28,bot=100)+lensw(SKY,SKY,cx=62,r=18,rw=6,ww=5,handle=7.5,wscale=1.05)),
 '3g': ('Rounder tile, blue braces',  tile(D,rx=26)+braces(SKY)+lensw(WH,SKY,cx=62,r=15,rw=5.5,ww=4.6,handle=6.5)),
 '3h': ('Light tile',                 tile('#F4F6F8')+braces(D)+lensw(B,B,cx=62,r=15,rw=5.5,ww=4.4,handle=6.5)),
}
out={}
for k,(n,b) in V.items():
    open(f'braces-{k}.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">{b}</svg>')
    out[k]=[n,b]
json.dump(out,open('variants.json','w'))
