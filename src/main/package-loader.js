/* 岗位包加载：所有来源（内置 / 导入 / 目录）都必须过同一份校验器。
 * 岗位包是纯数据，加载即读 JSON，不执行任何代码。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const schema = require('../shared/schema');
const { PATHS } = require('./paths');

function parseAndValidate(text, label) {
  let pkg;
  try { pkg = JSON.parse(text); }
  catch (e) { throw new Error(label + ' 不是合法 JSON：' + e.message); }
  const result = schema.validatePackage(pkg);
  if (!result.ok) throw new Error(label + ' 校验未通过：\n' + result.errors.join('\n'));
  return { pkg, warnings: result.warnings };
}

function loadBuiltin(packageId) {
  const file = path.join(PATHS.packages, packageId, 'package.json');
  if (!fs.existsSync(file)) throw new Error('内置岗位包不存在：' + packageId);
  return parseAndValidate(fs.readFileSync(file, 'utf8'), packageId);
}

/** 导入本机包文件：可以是一个 .json，也可以是含 package.json 的目录 */
function importFromFile(filePath) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat) throw new Error('文件不存在：' + filePath);
  const file = stat.isDirectory() ? path.join(filePath, 'package.json') : filePath;
  if (!fs.existsSync(file)) throw new Error('目录中未找到 package.json');
  return parseAndValidate(fs.readFileSync(file, 'utf8'), path.basename(file));
}

/** 实例优先读自己的包快照：模板升级不会静默改动用户已建好的助手。 */
function loadForInstance(instanceId, packageId, fallbackPkg) {
  const { instanceFile } = require('./paths');
  const snapshot = instanceFile(instanceId, 'package.json');
  if (fs.existsSync(snapshot)) return parseAndValidate(fs.readFileSync(snapshot, 'utf8'), '实例包快照');
  if (fallbackPkg) return { pkg: fallbackPkg, warnings: [] };
  return loadBuiltin(packageId);
}

module.exports = { parseAndValidate, loadBuiltin, importFromFile, loadForInstance, schema };
