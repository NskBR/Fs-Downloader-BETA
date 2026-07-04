const fs = require('fs');
const https = require('https');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { fs.writeFileSync(dest, data); resolve(); });
    }).on('error', reject);
  });
}

const base = 'https://raw.githubusercontent.com/nicedoc/xdm/master/app/xdm-browser-monitor/firefox/';
const base2 = 'https://raw.githubusercontent.com/nicedoc/xdm/master/app/xdm-browser-monitor/chrome/';
const files = [
  [base + 'lib.js', 'xdm_ff_lib.js'],
  [base + 'bg2.js', 'xdm_ff_bg2.js'],
  [base2 + 'lib.js', 'xdm_chrome_lib.js'],
  [base2 + 'bg2.js', 'xdm_chrome_bg2.js'],
];

(async () => {
  for (const [url, dest] of files) {
    try {
      await download(url, dest);
      console.log('OK: ' + dest);
    } catch (e) {
      console.log('FAIL: ' + dest + ' - ' + e.message);
    }
  }
})();
