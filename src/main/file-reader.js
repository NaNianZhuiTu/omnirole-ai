/* 本机资料读取层：只认授权目录内的文件，输出带出处信息的结构化内容。
 * 支持 csv / xlsx / docx / md / txt / json，全部用 Node 内置模块实现，离线可用。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readZipEntries } = require('./zip');

// ---------- 编码 ----------
function decodeBuffer(buf) {
  let text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 2) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf).replace(/^\uFEFF/, '');
      if ((gbk.match(/\uFFFD/g) || []).length < bad) return gbk;
    } catch (e) { /* 环境不支持 GBK 时保持 UTF-8 结果 */ }
  }
  return text;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
}
function stripTag(s) { return decodeXml(String(s).replace(/<[^>]*>/g, '')); }

// ---------- CSV ----------
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

// ---------- XLSX ----------
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsxTable(file) {
  const entries = readZipEntries(fs.readFileSync(file));
  const ssXml = entries['xl/sharedStrings.xml'];
  const strings = [];
  if (ssXml) {
    const xml = ssXml.toString('utf8');
    (xml.match(/<si[\s\S]*?<\/si>/g) || []).forEach(si => {
      const parts = si.match(/<t[^>]*>[\s\S]*?<\/t>|<t[^>]*\/>/g) || [];
      strings.push(parts.map(p => stripTag(p)).join(''));
    });
  }
  const sheetName = Object.keys(entries).find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetName) throw new Error('xlsx 中未找到工作表');
  const xml = entries[sheetName].toString('utf8');
  const rows = (xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []).map(r => {
    const arr = [];
    (r.match(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\/>/g) || []).forEach(c => {
      const ref = (/\br="([A-Z]+\d+)"/.exec(c) || [])[1];
      const type = (/\bt="([^"]+)"/.exec(c) || [])[1];
      const idx = ref ? colIndex(ref) : arr.length;
      if (idx < 0) return;
      let val = '';
      if (type === 'inlineStr') {
        val = (c.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(p => stripTag(p)).join('');
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c);
        if (v) val = type === 's' ? (strings[Number(v[1])] || '') : decodeXml(v[1]);
      }
      arr[idx] = val;
    });
    for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = '';
    return arr.map(String);
  });
  return rows.filter(r => r.some(v => v !== ''));
}

// ---------- DOCX ----------
function readDocx(file) {
  const entries = readZipEntries(fs.readFileSync(file));
  const xml = (entries['word/document.xml'] || Buffer.from('')).toString('utf8');
  return xml.split(/<\/w:p>/).map(p =>
    (p.match(/<w:t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => stripTag(t)).join('')
  ).filter(Boolean).join('\n');
}

// ---------- 统一入口 ----------
function readTable(file) {
  const ext = path.extname(file).toLowerCase();
  const rows = ext === '.xlsx' || ext === '.xlsm' ? readXlsxTable(file) : parseCsv(decodeBuffer(fs.readFileSync(file)));
  return { rows, format: ext };
}

function readText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') return readDocx(file);
  if (ext === '.xlsx' || ext === '.xlsm') return readXlsxTable(file).map(r => r.join(' | ')).join('\n');
  return decodeBuffer(fs.readFileSync(file));
}

function readPoints(file, jsonPath) {
  const data = JSON.parse(readText(file));
  const value = jsonPath ? jsonPath.split('.').reduce((o, k) => (o == null ? o : o[k]), data) : data;
  return Array.isArray(value) ? value : (value && Array.isArray(value.points) ? value.points : []);
}

// ---------- glob 与目录遍历 ----------
function escapeRe(s) { return s.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') { re += '(?:.*/)?'; i++; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end > -1) {
        re += '(?:' + pattern.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')';
        i = end;
      } else re += '\\{';
    } else if (c === '?') re += '[^/]';
    else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$', 'i');
}

/** 在授权根目录内按 glob 找文件；任何越界路径都会被拒绝。 */
function listFiles(rootDir, pattern, maxFiles) {
  const root = path.resolve(rootDir);
  if (!fs.existsSync(root)) return [];
  const re = globToRegExp(pattern);
  const out = [];
  const limit = maxFiles || 300;
  const skip = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);
  (function walk(dir) {
    if (out.length >= limit) return;
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      if (out.length >= limit) return;
      if (it.name.startsWith('.') || skip.has(it.name)) continue;
      const abs = path.join(dir, it.name);
      if (!abs.startsWith(root + path.sep) && abs !== root) continue; // 目录穿越防护
      if (it.isDirectory()) { walk(abs); continue; }
      if (!it.isFile()) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const base = path.basename(rel);
      if (re.test(rel) || re.test(base)) out.push({ rel, abs });
    }
  })(root);
  return out;
}

function fileMeta(file) {
  const st = fs.statSync(file);
  const buf = fs.readFileSync(file);
  return {
    size: st.size,
    mtime: st.mtime.toISOString(),
    sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  };
}

/** 只列一层。本地资料页用它跟授权目录实时对齐，不经过岗位包的匹配规则。 */
function listDirectory(absDir, maxEntries) {
  const abs = path.resolve(absDir);
  if (!fs.existsSync(abs)) throw new Error('目录不存在：' + abs);
  if (!fs.statSync(abs).isDirectory()) throw new Error('不是文件夹：' + abs);
  const skip = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);
  const limit = maxEntries || 800;
  let items = [];
  try { items = fs.readdirSync(abs, { withFileTypes: true }); }
  catch (e) { throw new Error('无法读取目录：' + e.message); }
  const entries = [];
  let truncated = false;
  for (const it of items) {
    if (it.name.startsWith('.') || skip.has(it.name)) continue;
    const child = path.join(abs, it.name);
    let kind = null;
    let size = null;
    let mtime = null;
    try {
      if (it.isDirectory()) kind = 'dir';
      else if (it.isFile()) kind = 'file';
      else if (it.isSymbolicLink()) {
        const linked = fs.statSync(child);
        if (linked.isDirectory()) kind = 'dir';
        else if (linked.isFile()) kind = 'file';
      }
      if (kind === 'file') {
        const st = fs.statSync(child);
        size = st.size;
        mtime = st.mtime.toISOString();
      }
    } catch (e) { continue; }
    if (!kind) continue;
    if (entries.length >= limit) { truncated = true; break; }
    entries.push({ name: it.name, path: child, kind, size, mtime });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { path: abs, entries, truncated };
}

function excerpt(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, max || 160) + (clean.length > (max || 160) ? '…' : '');
}

module.exports = {
  decodeBuffer, parseCsv, readTable, readText, readPoints, readDocx,
  globToRegExp, listFiles, listDirectory, fileMeta, excerpt
};
