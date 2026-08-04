'use strict';
/*
 * メモ板の簡易サーバー。
 * このファイルと同じフォルダに置いた メモ板.html を配信し、
 * 同じフォルダの memos.json を読み書きするAPIを提供する。
 * 依存パッケージなし。Node.js があれば `node server.js` で起動できる。
 *
 * デスクトップ通知はブラウザの仕様上「暗号化された接続(HTTPS)」でないと使えないが、
 * 自己署名証明書によるHTTPS化は警告画面やIPアドレス変更時の再設定など運用上の手間が
 * 大きかったため、通知機能は使わない前提で通常のHTTPで配信するシンプルな構成にしている。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const DIR = __dirname;
const DATA_FILE = path.join(DIR, 'memos.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// serialize writes so two near-simultaneous saves can't corrupt the file
let writeQueue = Promise.resolve();
function queueWrite(fn){
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

function readMemos(){
  return new Promise(function(resolve){
    fs.readFile(DATA_FILE, 'utf8', function(err, text){
      if (err) { resolve([]); return; }
      try {
        const parsed = JSON.parse(text || '[]');
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch(e){ resolve([]); }
    });
  });
}

function writeMemos(arr){
  return queueWrite(function(){
    return new Promise(function(resolve, reject){
      const tmp = DATA_FILE + '.tmp';
      fs.writeFile(tmp, JSON.stringify(arr), function(err){
        if (err) { reject(err); return; }
        fs.rename(tmp, DATA_FILE, function(err2){
          if (err2) reject(err2); else resolve();
        });
      });
    });
  });
}

function sendJson(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, maxBytes){
  return new Promise(function(resolve, reject){
    let size = 0;
    const chunks = [];
    req.on('data', function(chunk){
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('リクエストが大きすぎます')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', function(){ resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath){
  let rel = decodeURIComponent(urlPath === '/' ? '/メモ板.html' : urlPath);
  rel = rel.replace(/^\/+/, '');
  const filePath = path.join(DIR, rel);
  if (!filePath.startsWith(DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, function(err, data){
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async function(req, res){
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/memos' && req.method === 'GET') {
      const memos = await readMemos();
      sendJson(res, 200, memos);
      return;
    }
    if (url.pathname === '/api/memos' && req.method === 'POST') {
      const text = await readBody(req, 5 * 1024 * 1024);
      let arr;
      try { arr = JSON.parse(text); } catch(e){ sendJson(res, 400, { error: '不正なデータです' }); return; }
      if (!Array.isArray(arr)) { sendJson(res, 400, { error: 'データは配列である必要があります' }); return; }
      await writeMemos(arr);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET') {
      serveStatic(req, res, url.pathname);
      return;
    }
    res.writeHead(405);
    res.end('Method not allowed');
  } catch(e){
    sendJson(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

function localAddresses(){
  const nets = os.networkInterfaces();
  const out = [];
  Object.keys(nets).forEach(function(name){
    (nets[name] || []).forEach(function(net){
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    });
  });
  return out;
}

server.listen(PORT, function(){
  console.log('メモ板サーバーを起動しました。');
  console.log('このパソコンから: http://localhost:' + PORT + '/');
  localAddresses().forEach(function(addr){
    console.log('同じネットワークの他のパソコンから: http://' + addr + ':' + PORT + '/');
  });
  console.log('終了するには、このウィンドウで Ctrl+C を押してください。');
});
