/* 生成应用图标：暖橙渐变圆角方底 + Q 版小机器人。
 * 零外部依赖：逐像素绘制（4x4 超采样）→ 手写 PNG 编码 → 手写 ICO 封装。
 *   node tools/make-icon.js
 * 产物：build/icon.ico（16~256 多尺寸，供窗口/exe）、build/icon.png、build/icon-preview.png（512 预览）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'build');
const ASSETS = path.join(__dirname, '..', 'src', 'main', 'assets');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 绘制（归一化坐标 0..1） ----------
const C = {
  light: [255, 190, 112],
  dark: [220, 92, 38],
  white: [255, 255, 255],
  ink: [38, 50, 74],
  blush: [255, 146, 82],
  shade: [142, 54, 18]
};
function over(dst, col, a) {
  if (a <= 0) return dst;
  const da = dst[3];
  const oa = a + da * (1 - a);
  return [
    (col[0] * a + dst[0] * da * (1 - a)) / oa,
    (col[1] * a + dst[1] * da * (1 - a)) / oa,
    (col[2] * a + dst[2] * da * (1 - a)) / oa,
    oa
  ];
}
function rr(u, v, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}
function circle(u, v, cx, cy, r) {
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}
function segment(u, v, x0, y0, x1, y1, w) {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.min(1, Math.max(0, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy)));
  const px = u - (x0 + t * dx), py = v - (y0 + t * dy);
  return px * px + py * py <= (w / 2) * (w / 2);
}

function scene(u, v) {
  let c = [0, 0, 0, 0];

  // 底板：圆角方形 + 对角暖橙渐变 + 左上柔光
  if (rr(u, v, 0.031, 0.031, 0.969, 0.969, 0.219)) {
    const t = Math.min(1, Math.max(0, (u * 0.52 + v * 0.68) / 1.15));
    c = over(c, [
      C.light[0] + (C.dark[0] - C.light[0]) * t,
      C.light[1] + (C.dark[1] - C.light[1]) * t,
      C.light[2] + (C.dark[2] - C.light[2]) * t
    ], 1);
    const glow = Math.max(0, 1 - Math.sqrt(Math.pow((u - 0.24) * 1.7, 2) + Math.pow((v + 0.04) * 2.1, 2)));
    c = over(c, C.white, 0.17 * glow);
  }

  // 头下方投影，增加立体感（不画身体，小尺寸下更干净）
  if (rr(u, v, 0.223, 0.348, 0.789, 0.755, 0.135)) c = over(c, C.shade, 0.20);

  // 天线
  if (segment(u, v, 0.5, 0.227, 0.5, 0.332, 0.028)) c = over(c, C.white, 1);
  if (circle(u, v, 0.5, 0.211, 0.039)) c = over(c, C.white, 1);
  // 两侧耳块
  if (rr(u, v, 0.172, 0.453, 0.230, 0.594, 0.027)) c = over(c, C.white, 1);
  if (rr(u, v, 0.770, 0.453, 0.828, 0.594, 0.027)) c = over(c, C.white, 1);
  // 头
  if (rr(u, v, 0.219, 0.320, 0.781, 0.727, 0.137)) c = over(c, C.white, 1);

  // 脸颊
  if (circle(u, v, 0.297, 0.585, 0.030)) c = over(c, C.blush, 0.55);
  if (circle(u, v, 0.703, 0.585, 0.030)) c = over(c, C.blush, 0.55);
  // 眼睛 + 高光
  if (circle(u, v, 0.391, 0.487, 0.043)) c = over(c, C.ink, 1);
  if (circle(u, v, 0.609, 0.487, 0.043)) c = over(c, C.ink, 1);
  if (circle(u, v, 0.378, 0.471, 0.014)) c = over(c, C.white, 0.92);
  if (circle(u, v, 0.596, 0.471, 0.014)) c = over(c, C.white, 0.92);
  // 微笑：与眼睛留出间隙的下半圆环
  const dx = u - 0.5, dy = v - 0.552, d = Math.sqrt(dx * dx + dy * dy), R = 0.086, w = 0.024;
  if (v > 0.556 && Math.abs(dx) < R && d >= R - w / 2 && d <= R + w / 2) c = over(c, C.ink, 0.88);

  return c;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 4, n = S * S;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = scene((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a);
      }
      buf[o + 3] = Math.round(a / n * 255);
    }
  }
  return buf;
}

// ---------- 输出 ----------
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(s => ({ size: s, png: encodePNG(s, render(s)) }));
fs.writeFileSync(path.join(OUT, 'icon.png'), images[images.length - 1].png);
fs.writeFileSync(path.join(OUT, 'icon-preview.png'), encodePNG(512, render(512)));

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(im => {
  const e = Buffer.alloc(16);
  e[0] = e[1] = im.size >= 256 ? 0 : im.size;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(im.png.length, 8); e.writeUInt32LE(offset, 12);
  offset += im.png.length;
  return e;
});
const ico = Buffer.concat([dir, ...entries, ...images.map(i => i.png)]);
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
// 同一份也放进 src/main/assets：随 asar 打包，BrowserWindow 在两种模式下都能用相对路径取到
fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);

console.log('ICON_OK sizes=' + sizes.join(',') +
  ' ico=' + fs.statSync(path.join(OUT, 'icon.ico')).size + 'B' +
  ' preview=' + fs.statSync(path.join(OUT, 'icon-preview.png')).size + 'B');
