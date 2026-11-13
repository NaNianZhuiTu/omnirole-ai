/* 生产端岗位包校验器（命令行）
 * 用法：npm run validate
 * 对应规范 08 章「自检」：给的是可复核的证据锚点，不是 AI 照镜子打勾。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const schema = require('../src/shared/schema');

const root = path.join(__dirname, '..');
const packagesDir = path.join(root, 'packages');
let failed = 0;

function check(label, result) {
  console.log('\n== ' + label + ' ==');
  console.log('  结果：' + (result.ok ? '通过' : '不通过'));
  result.errors.forEach(e => console.log('  [错误] ' + e));
  result.warnings.forEach(w => console.log('  [提示] ' + w));
  if (!result.ok) failed++;
}

const dirs = fs.existsSync(packagesDir)
  ? fs.readdirSync(packagesDir).filter(d => fs.existsSync(path.join(packagesDir, d, 'package.json')))
  : [];

dirs.forEach(dir => {
  const file = path.join(packagesDir, dir, 'package.json');
  try {
    check(dir, schema.validatePackage(JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch (e) {
    check(dir, { ok: false, errors: ['JSON 解析失败：' + e.message], warnings: [] });
  }
});

// 目录清单的引用完整性：每一条可用记录都必须能指到真实包文件。
const catalogFile = path.join(root, 'catalog', 'catalog.json');
if (fs.existsSync(catalogFile)) {
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const errors = [];
  catalog.packages.forEach(p => {
    if (p.status === 'planned') return;
    if (!p.entry) { errors.push(p.id + '：可用记录缺少 entry'); return; }
    const abs = path.join(root, p.entry);
    if (!fs.existsSync(abs)) errors.push(p.id + '：entry 指向的文件不存在 ' + p.entry);
  });
  check('catalog.json 引用完整性', { ok: errors.length === 0, errors, warnings: [] });
}

console.log('\n共校验 ' + (dirs.length + 1) + ' 项，失败 ' + failed + ' 项。');
console.log('视图积木清单：' + schema.BLOCK_IDS.join(' / '));
process.exit(failed ? 1 : 0);
