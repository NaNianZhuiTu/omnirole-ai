/* 本地资料的剪切、复制、移动。调用前路径必须已经落在授权目录内。 */
'use strict';
const fs = require('fs');
const path = require('path');

function real(p) {
  try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); }
}

function assertNotIntoSelf(src, dir) {
  const s = real(src);
  const d = real(dir);
  if (d.toLowerCase() === s.toLowerCase() || d.toLowerCase().startsWith(s.toLowerCase() + path.sep)) {
    throw new Error('不能粘贴到自身或它的子文件夹里');
  }
}

function uniqueDest(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  if (!fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  for (let i = 1; i < 100; i++) {
    const label = (i === 1 ? base + ' - 副本' : base + ' - 副本 (' + i + ')') + ext;
    const candidate = path.join(dir, label);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('同名项目太多，无法粘贴');
}

function copyInto(src, dir) {
  if (!fs.existsSync(src)) throw new Error('原文件已不存在');
  if (!fs.statSync(dir).isDirectory()) throw new Error('目标不是文件夹');
  assertNotIntoSelf(src, dir);
  const dest = uniqueDest(dir, path.basename(src));
  fs.cpSync(src, dest, { recursive: true, errorOnExist: true });
  return dest;
}

function moveInto(src, dir) {
  if (!fs.existsSync(src)) throw new Error('原文件已不存在');
  if (!fs.statSync(dir).isDirectory()) throw new Error('目标不是文件夹');
  if (real(dir).toLowerCase() === path.dirname(real(src)).toLowerCase()) return src;
  assertNotIntoSelf(src, dir);
  const dest = uniqueDest(dir, path.basename(src));
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
  return dest;
}

function props(abs) {
  const st = fs.statSync(abs);
  return {
    name: path.basename(abs),
    path: abs,
    dir: path.dirname(abs),
    isDir: st.isDirectory(),
    size: st.isDirectory() ? null : st.size,
    mtime: st.mtime.toISOString()
  };
}

module.exports = { copyInto, moveInto, props };
