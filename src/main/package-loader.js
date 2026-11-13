/* 助手安装包只接受 HTML 工作台：manifest.json + assistant.json + workspace/。
 * 导入时只复制文件，不执行安装包里的任何脚本。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const schema = require('../shared/schema');
const { isInside } = require('./safe-path');

const APP_VERSION = require('../../package.json').version;
const MAX_PACKAGE_FILES = 4000;
const MAX_PACKAGE_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_BYTES = 200 * 1024 * 1024;

function readJsonFile(file, label) {
  if (!fs.existsSync(file)) throw new Error('安装包缺少 ' + label);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(label + ' 不是合法 JSON：' + e.message); }
  return data;
}

function entryFile(dir, entry) {
  const abs = path.resolve(dir, ...entry.split('/'));
  if (!isInside(dir, abs)) throw new Error('工作台入口超出安装包目录');
  return abs;
}

function inspectHtmlDir(dir) {
  const manifest = readJsonFile(path.join(dir, 'manifest.json'), 'manifest.json');
  const assistant = readJsonFile(path.join(dir, 'assistant.json'), 'assistant.json');
  let symlinkEntry = false;
  const result = schema.validateHtmlBundle({
    manifest,
    assistant,
    appVersion: APP_VERSION,
    fileExists: function (rel) {
      let abs;
      try { abs = entryFile(dir, rel); }
      catch (e) { return false; }
      if (!fs.existsSync(abs)) return false;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) { symlinkEntry = true; return false; }
      return st.isFile();
    }
  });
  if (!result.ok) {
    const errors = result.errors.slice();
    if (symlinkEntry) {
      for (let i = 0; i < errors.length; i++) {
        if (errors[i].indexOf('找不到工作台入口文件') === 0) errors[i] = '工作台入口不能是符号链接';
      }
    }
    throw new Error('HTML 助手安装包校验未通过：' + errors.join('；'));
  }
  const pkg = Object.assign({}, assistant, {
    workspaceType: 'html',
    workspaceEntry: result.entry,
    formatVersion: manifest.formatVersion,
    minAppVersion: manifest.minAppVersion
  });
  return {
    kind: 'html',
    pkg,
    warnings: result.warnings,
    manifest,
    sourceDir: dir,
    entry: result.entry
  };
}

function inspectDirectory(dir) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return inspectHtmlDir(dir);
  throw new Error('这不是 HTML 助手安装包：文件夹里没有 manifest.json');
}

function inspectImport(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const stat = fs.existsSync(resolved) ? fs.lstatSync(resolved) : null;
  if (!stat) throw new Error('找不到要导入的助手：' + filePath);
  if (stat.isSymbolicLink()) throw new Error('不能导入符号链接：' + filePath);
  if (stat.isDirectory()) return inspectDirectory(resolved);
  if (!stat.isFile()) throw new Error('不能导入该路径：' + filePath);
  const base = path.basename(resolved).toLowerCase();
  if (base === 'manifest.json' || base === 'assistant.json') return inspectHtmlDir(path.dirname(resolved));
  if (base.endsWith('.html') || base.endsWith('.htm')) {
    throw new Error('不能把 HTML 页面当作助手导入。请选择包含 manifest.json 的助手文件夹。');
  }
  throw new Error('不能导入这种文件。请选择包含 manifest.json 的 HTML 助手文件夹。');
}

function copyPackageTree(src, dest) {
  const stats = { files: 0, bytes: 0 };
  function walk(from, to, root) {
    const rel = path.relative(root, from);
    if (rel && (rel.startsWith('..') || path.isAbsolute(rel))) throw new Error('安装包路径越界：' + rel);
    const st = fs.lstatSync(from);
    if (st.isSymbolicLink()) throw new Error('安装包不允许包含符号链接：' + (rel || path.basename(from)));
    if (st.isDirectory()) {
      const name = path.basename(from);
      if (rel && (name === '.git' || name === 'node_modules')) {
        throw new Error('安装包不能包含 ' + name + ' 目录，请去掉后再导入');
      }
      fs.mkdirSync(to, { recursive: true });
      fs.readdirSync(from).forEach(function (entry) {
        if (entry === '.' || entry === '..') return;
        walk(path.join(from, entry), path.join(to, entry), root);
      });
      return;
    }
    if (!st.isFile()) throw new Error('安装包包含不支持的文件类型：' + (rel || path.basename(from)));
    if (st.size > MAX_PACKAGE_FILE_BYTES) throw new Error('文件超过 32MB，已拒绝导入：' + (rel || path.basename(from)));
    stats.files += 1;
    stats.bytes += st.size;
    if (stats.files > MAX_PACKAGE_FILES) throw new Error('安装包文件数量超过 ' + MAX_PACKAGE_FILES + '，已拒绝导入');
    if (stats.bytes > MAX_PACKAGE_TOTAL_BYTES) throw new Error('安装包总体积超过 200MB，已拒绝导入');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  walk(src, dest, src);
  return stats;
}

function loadHtmlFromDir(dir) {
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error('HTML 助手安装包已丢失或已损坏，请重新导入');
  }
  return inspectHtmlDir(dir);
}

/** 实例优先读自己的包快照：模板升级不会静默改动用户已建好的助手。 */
function loadForInstance(instanceId, packageId, fallbackPkg) {
  const { instanceFile } = require('./paths');
  const snapshot = instanceFile(instanceId, 'package.json');
  if (fs.existsSync(snapshot)) {
    const text = fs.readFileSync(snapshot, 'utf8');
    let raw;
    try { raw = JSON.parse(text); }
    catch (e) { throw new Error('实例包快照不是合法 JSON：' + e.message); }
    if (raw.workspaceType !== 'html') {
      throw new Error('该助手使用的是已经去掉的 JSON 工作台，请重新导入 HTML 助手');
    }
    const result = schema.validateAssistantConfig(raw);
    if (!result.ok) throw new Error('实例包快照校验未通过：\n' + result.errors.join('\n'));
    return { pkg: raw, warnings: result.warnings, kind: 'html' };
  }
  if (fallbackPkg && fallbackPkg.workspaceType === 'html') return { pkg: fallbackPkg, warnings: [], kind: 'html' };
  throw new Error('助手实例没有 HTML 工作台');
}

module.exports = {
  inspectImport,
  importFromFile: inspectImport,
  loadHtmlFromDir,
  loadForInstance,
  copyPackageTree,
  schema,
  APP_VERSION
};
