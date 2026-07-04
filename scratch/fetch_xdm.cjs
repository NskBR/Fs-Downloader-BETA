const fs = require('fs');
const https = require('https');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to get URL, status code: ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

const base = 'https://raw.githubusercontent.com/subhra74/xdm/master/app/xdm-browser-monitor--depricated/firefox/';
Promise.all([
  download(base + 'bg2.js', 'bg2_fetched.js'),
  download(base + 'bg3.js', 'bg3_fetched.js'),
  download(base + 'network.js', 'bg1_fetched.js'),
  download(base + 'util.js', 'util_fetched.js')
]).then(() => {
  console.log('Download complete!');
}).catch(console.error);
