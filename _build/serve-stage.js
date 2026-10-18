/* мини-сервер для проверки stage (как в Electron) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const STAGE = path.join(__dirname, 'stage');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const full = path.normalize(path.join(STAGE, p));
  if (!full.startsWith(STAGE)) { res.writeHead(403); return res.end(); }
  fs.stat(full, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
}).listen(3210, '127.0.0.1', () => console.log('stage server: http://127.0.0.1:3210'));
