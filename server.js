'use strict';
/*
 * メモ板の簡易サーバー。
 * このファイルと同じフォルダに置いた メモ板.html を配信し、
 * 同じフォルダの memos.json を読み書きするAPIを提供する。
 * 依存パッケージなし。Node.js があれば `node server.js` で起動できる。
 *
 * デスクトップ通知などブラウザの一部機能は「暗号化された接続(HTTPS)」でないと
 * 使えないため、自己署名証明書(オレオレ証明書、selfsigned.js で生成)を使って
 * HTTPSで配信する。初回アクセス時にブラウザで「保護されていません」という警告が
 * 出るが、これは正式な認証局の証明書ではないためで、想定内の動作。「詳細設定」→
 * 「アクセスする」で進めば、以後は暗号化された接続で通信できる。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateSelfSignedCert } = require('./selfsigned.js');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const DIR = __dirname;
const DATA_FILE = path.join(DIR, 'memos.json');
const CERT_FILE = path.join(DIR, 'server-cert.pem');
const KEY_FILE = path.join(DIR, 'server-key.pem');

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

// 証明書を使い回せるかどうか確認し、必要なら(初回、またはこのパソコンの
// IPアドレスが変わったときなど)新しく作り直してファイルに保存する。
function loadOrCreateCert(){
  const wantIps = ['127.0.0.1'].concat(localAddresses());
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    try {
      const cert = fs.readFileSync(CERT_FILE, 'utf8');
      const key = fs.readFileSync(KEY_FILE, 'utf8');
      const x509 = new (require('crypto').X509Certificate)(cert);
      const notExpired = new Date(x509.validTo).getTime() > Date.now() + 24 * 3600 * 1000;
      const coversAllIps = wantIps.every(function(ip){ return x509.checkIP(ip); });
      if (notExpired && coversAllIps) {
        return { cert, key };
      }
      console.log('証明書を作り直します(IPアドレスの変更または期限切れのため)。');
    } catch(e){
      console.log('既存の証明書を読み込めなかったため、作り直します。詳細: ' + (e && e.message ? e.message : e));
    }
  }
  const generated = generateSelfSignedCert({
    commonName: wantIps[1] || 'localhost',
    dnsNames: ['localhost'],
    ipAddresses: wantIps,
    days: 3650,
  });
  fs.writeFileSync(CERT_FILE, generated.cert);
  fs.writeFileSync(KEY_FILE, generated.key);
  return generated;
}

const server = https.createServer(loadOrCreateCert(), async function(req, res){
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

server.listen(PORT, function(){
  console.log('メモ板サーバーを起動しました。');
  console.log('このパソコンから: https://localhost:' + PORT + '/');
  localAddresses().forEach(function(addr){
    console.log('同じネットワークの他のパソコンから: https://' + addr + ':' + PORT + '/');
  });
  console.log('※ 初回アクセス時に「保護されていません」という警告が出ますが、');
  console.log('  自己署名証明書を使っているためで想定内です。「詳細設定」→');
  console.log('  「アクセスする(安全ではないページに進む)」で進んでください。');
  console.log('終了するには、このウィンドウで Ctrl+C を押してください。');
});
