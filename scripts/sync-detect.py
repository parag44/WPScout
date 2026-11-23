#!/usr/bin/env python3
"""Copy detectWordPress() and deepChecks() from content.js into popup/detect.js.

popup/detect.js is the fallback the popup injects with chrome.scripting.executeScript
when the content script can't be reached. Run this after any change to the detector.
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = (root / 'content.js').read_text().split('\n')
start = next(i for i, l in enumerate(src) if l.startswith('  async function detectWordPress() {'))
end = next(i for i in range(start, len(src)) if src[i] == '}')
detect = src[start:end + 1]
detect[0] = detect[0][2:]
d0 = next(i for i, l in enumerate(src) if l.strip() == '// <deep-checks>')
d1 = next(i for i, l in enumerate(src) if l.strip() == '// </deep-checks>')
deep = [l[2:] if l.startswith('  ') else l for l in src[d0 + 1:d1]]

target = root / 'popup' / 'detect.js'
old = target.read_text()
head = old[:old.index('async function detectWordPress() {')]
target.write_text(head + '\n'.join(detect) + '\n\n' + '\n'.join(deep) + '\n')
print('popup/detect.js synced')
