/* 路径边界：导入、协议映射和页面接口共用，拒绝绝对路径与目录穿越。 */
'use strict';
const path = require('path');

function isInside(root, target) {
  const base = path.resolve(root);
  const abs = path.resolve(target);
  const rel = path.relative(base, abs);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

function assertInside(root, target, message) {
  if (!isInside(root, target)) throw new Error(message || '路径超出允许范围');
  return path.resolve(target);
}

function safeRelative(input, label) {
  const name = label || '路径';
  if (typeof input !== 'string' || !input.trim()) throw new Error(name + '不能为空');
  if (input.indexOf('\0') !== -1) throw new Error(name + '含有非法字符');
  const norm = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/^[A-Za-z]:/.test(norm)) throw new Error(name + '不允许使用绝对路径');
  const parts = norm.split('/');
  if (!parts.length || parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
    throw new Error(name + '不允许包含上级目录');
  }
  if (parts.some(function (part) { return part.length > 120 || /[<>:"|?*]/.test(part); })) {
    throw new Error(name + '含有非法字符');
  }
  return parts.join('/');
}

module.exports = { isInside, assertInside, safeRelative };
