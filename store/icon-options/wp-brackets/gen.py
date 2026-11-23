D='#23272B'; B='#0284C7'; SKY='#38BDF8'; WH='#F2F4F5'
def braces(c, sw=7.5):
    return ''.join(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>' for d in (
        'M38 30C28 30 28 37 28 45v8c0 6-4 9-9 9 5 0 9 3 9 9v8c0 8 0 15 10 15',
        'M90 30c10 0 10 7 10 15v8c0 6 4 9 9 9-5 0-9 3-9 9v8c0 8 0 15-10 15'))
def chevrons(c, sw=8):
    return ''.join(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>' for d in (
        'M38 42 20 64 38 86', 'M90 42 108 64 90 86'))
def w(c, sw=7, x0=44, x1=84, y0=50, y1=78):
    m=(x0+x1)/2; q=(x1-x0)/4
    return f'<path d="M{x0} {y0} {x0+q*0.8} {y1} {m} {y0+11} {x1-q*0.8} {y1} {x1} {y0}" fill="none" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
def wp(c, sw=5.5):
    return (w(c, sw, 41, 66, 52, 76) +
            f'<path d="M73 76V52h6.5a7.5 7.5 0 0 1 0 15H73" fill="none" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>')
def lens(c):
    return f'<circle cx="62" cy="62" r="11" fill="none" stroke="{c}" stroke-width="6"/><circle cx="62" cy="62" r="4" fill="{c}"/><path d="M70.5 70.5 78 78" stroke="{c}" stroke-width="6.5" stroke-linecap="round"/>'
tile=lambda c,rx=10: f'<rect width="128" height="128" rx="{rx}" fill="{c}"/>'
V={
 'a-braces-w':     tile(D)+braces(WH)+w(SKY),
 'b-chevrons-w':   tile(D)+chevrons(WH)+w(SKY),
 'c-braces-wp':    tile(D)+braces(WH)+wp(SKY),
 'd-chevrons-wp':  tile(D)+chevrons(WH)+wp(SKY),
 'e-chevrons-wp-blue': tile(B)+chevrons('#FFFFFF')+wp('#FFFFFF'),
 'f-chevrons-lens':    tile(D)+chevrons(WH)+lens(SKY),
}
for k,b in V.items():
    open(f'{k}.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">{b}</svg>')
