'use strict';
/*
 * 自己署名証明書(オレオレ証明書)を生成する最小限のモジュール。
 * 外部パッケージに依存せず、Node.js標準の crypto モジュールだけで
 * X.509証明書(DERエンコード)を組み立てる。デスクトップ通知など、
 * HTTPS(暗号化された接続)でないと使えないブラウザの機能を、
 * 社内LAN上のサーバーでも使えるようにするために server.js から利用する。
 */
const crypto = require('crypto');

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derTLV(tag, contentBuf) {
  return Buffer.concat([Buffer.from([tag]), derLen(contentBuf.length), contentBuf]);
}
function seq(...parts) { return derTLV(0x30, Buffer.concat(parts)); }
function set(...parts) { return derTLV(0x31, Buffer.concat(parts)); }
function integer(buf) {
  let b = buf;
  let i = 0;
  while (i < b.length - 1 && b[i] === 0x00 && (b[i + 1] & 0x80) === 0) i++;
  b = b.slice(i);
  if (b.length === 0) b = Buffer.from([0x00]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return derTLV(0x02, b);
}
function intFromNumber(n) {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return integer(Buffer.from(hex, 'hex'));
}
function bitstring(buf, unusedBits) {
  return derTLV(0x03, Buffer.concat([Buffer.from([unusedBits || 0]), buf]));
}
function octetstring(buf) { return derTLV(0x04, buf); }
function utf8String(str) { return derTLV(0x0C, Buffer.from(str, 'utf8')); }
function boolean(v) { return derTLV(0x01, Buffer.from([v ? 0xff : 0x00])); }
function contextExplicit(tagNum, contentBuf) { return derTLV(0xA0 | tagNum, contentBuf); }
function contextImplicitPrimitive(tagNum, contentBuf) { return derTLV(0x80 | tagNum, contentBuf); }

function utcTime(date) {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return derTLV(0x17, Buffer.from(yy + mm + dd + hh + mi + ss + 'Z', 'ascii'));
}

const OID_CN = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]); // 2.5.4.3
const ALG_SHA256_RSA = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
const OID_BASIC_CONSTRAINTS = Buffer.from([0x06, 0x03, 0x55, 0x1D, 0x13]);
const OID_SUBJECT_ALT_NAME = Buffer.from([0x06, 0x03, 0x55, 0x1D, 0x11]);
const OID_EXT_KEY_USAGE = Buffer.from([0x06, 0x03, 0x55, 0x1D, 0x25]);
const OID_SERVER_AUTH = Buffer.from([0x06, 0x08, 0x2B, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x01]); // 1.3.6.1.5.5.7.3.1

function nameFor(cn) {
  return seq(set(seq(OID_CN, utf8String(cn))));
}
function extension(oidBuf, critical, valueDER) {
  const parts = [oidBuf];
  if (critical) parts.push(boolean(true));
  parts.push(octetstring(valueDER));
  return seq(...parts);
}
function ipv4ToBuf(ip) {
  return Buffer.from(ip.split('.').map(function (x) { return parseInt(x, 10); }));
}

function generateSelfSignedCert(opts) {
  opts = opts || {};
  const commonName = opts.commonName || 'localhost';
  const dnsNames = opts.dnsNames || ['localhost'];
  const ipAddresses = opts.ipAddresses || ['127.0.0.1'];
  const days = opts.days || 3650;

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });

  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const serialBytes = crypto.randomBytes(8);

  const versionDer = contextExplicit(0, intFromNumber(2));
  const serialDer = integer(serialBytes);
  const issuerDer = nameFor(commonName);
  const subjectDer = issuerDer;
  const validityDer = seq(utcTime(notBefore), utcTime(notAfter));

  const sanEntries = Buffer.concat(
    dnsNames.map(function (d) { return contextImplicitPrimitive(2, Buffer.from(d, 'ascii')); })
      .concat(ipAddresses.map(function (ip) { return contextImplicitPrimitive(7, ipv4ToBuf(ip)); }))
  );
  const sanValue = seq(sanEntries);
  const basicConstraintsValue = seq(boolean(false));
  const extKeyUsageValue = seq(OID_SERVER_AUTH);

  const extensionsSeq = seq(
    extension(OID_BASIC_CONSTRAINTS, true, basicConstraintsValue),
    extension(OID_SUBJECT_ALT_NAME, false, sanValue),
    extension(OID_EXT_KEY_USAGE, false, extKeyUsageValue)
  );
  const extensionsDer = contextExplicit(3, extensionsSeq);

  const tbsDer = seq(versionDer, serialDer, ALG_SHA256_RSA, issuerDer, validityDer, subjectDer, spkiDer, extensionsDer);
  const sig = crypto.sign('RSA-SHA256', tbsDer, privateKey);
  const certDer = seq(tbsDer, ALG_SHA256_RSA, bitstring(sig, 0));

  function toPem(der, label) {
    const b64 = der.toString('base64');
    const lines = b64.match(/.{1,64}/g) || [];
    return '-----BEGIN ' + label + '-----\n' + lines.join('\n') + '\n-----END ' + label + '-----\n';
  }

  return {
    cert: toPem(certDer, 'CERTIFICATE'),
    key: privateKey.export({ type: 'pkcs1', format: 'pem' }),
  };
}

module.exports = { generateSelfSignedCert };
