/* 核心链路冒烟测试：不启动窗口，直接验证「本机文件 → 索引 → 工作台数据 → 换包」。
 * 用法：node tools/smoke-test.js
 * 用 mock 的 electron.app 跑主进程模块，不触碰真实用户数据目录。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

const root = path.join(__dirname, '..');
const tmpUser = path.join(root, '.smoke-userdata');
fs.mkdirSync(tmpUser, { recursive: true });

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        getAppPath: () => root,
        getPath: () => tmpUser
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const assert = (cond, msg) => {
  if (!cond) { console.error('  [FAIL] ' + msg); process.exitCode = 1; }
  else console.log('  [OK]   ' + msg);
};

function run() {
  const library = require('../src/main/library');

  console.log('\n== 初始化助手库 ==');
  library.init();
  const list = library.listInstances();
  assert(list.instances.length === 0, '启动时没有任何助手');
  assert(!list.activeId, '没有当前助手');
  assert(!library.current().instance, '当前上下文为空');

  console.log('\n== 助手库目录与分发 ==');
  const avail = library.available();
  assert(avail.length === 0, '目录里没有任何岗位包');

  console.log('\n== 导入岗位包（新增助手不重新打包）==');
  const tempPkg = path.join(root, '.smoke-userdata', 'imported-package.json');
  const imported = {
    schemaVersion: '1.0', id: 'smoke-imported', name: '冒烟测试岗', version: '1.2.3',
    industry: '测试', role: '测试员', sources: [],
    zones: [{ id: 'notes', title: '说明', view: 'notes' }],
    layout: [{ cols: [{ zone: 'notes', span: 1 }] }]
  };
  fs.writeFileSync(tempPkg, JSON.stringify(imported, null, 2), 'utf8');
  const r = library.importPackage(tempPkg);
  assert(r.id === 'smoke-imported', '本机导入岗位包成功并通过校验');
  const added = library.addInstance('smoke-imported', '导入的助手');
  assert(library.current().pkg.id === 'smoke-imported', '导入后可立即添加并切换，程序未重新打包');

  console.log('\n== 资料隔离 ==');
  const smokePaths = library.getAuthorizedPaths(added.id);
  assert(smokePaths.length === 0, '新实例默认不继承任何其它助手的授权目录');

  console.log('\n== 岗位包纯数据守卫 ==');
  const schema = require('../src/shared/schema');
  const bad = JSON.parse(JSON.stringify(imported));
  bad.zones[0].title = '<script>alert(1)</script>';
  assert(!schema.validatePackage(bad).ok, '校验器拒绝夹带可执行代码的岗位包');

  console.log('\n冒烟测试结束。');
}

try { run(); }
catch (e) { console.error('\n[ERROR] ' + e.stack); process.exitCode = 1; }
finally {
  try { fs.rmSync(tmpUser, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响结论 */ }
}
