const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/mnt/skate/shots-profile';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await (await b.newContext({ viewport: { width: 1060, height: 1120 }, deviceScaleFactor: 1 })).newPage();
  await p.goto('file:///tmp/preview.html');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/panel-on-black.png` });
  await p.evaluate(() => { document.body.style.background = '#fff'; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/panel-on-white.png` });
  await b.close();
  console.log('ok');
})();
