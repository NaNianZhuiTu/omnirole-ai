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

  console.log('\n== 不再导入旧 JSON 岗位包 ==');
  const tempPkg = path.join(root, '.smoke-userdata', 'imported-package.json');
  fs.writeFileSync(tempPkg, JSON.stringify({
    schemaVersion: '1.0', id: 'smoke-imported', name: '冒烟测试岗', version: '1.2.3',
    industry: '测试', role: '测试员', sources: [],
    zones: [{ id: 'notes', title: '说明', view: 'notes' }]
  }), 'utf8');
  let rejected = '';
  try { library.importPackage(tempPkg); }
  catch (e) { rejected = e.message; }
  assert(rejected.indexOf('manifest.json') >= 0, '单个 JSON 文件不能再当作助手导入');

  console.log('\n== HTML 助手 ==');
  const htmlDir = path.join(root, 'samples', 'html-fire-assistant');
  const htmlImp = library.importPackage(htmlDir);
  assert(htmlImp.workspaceType === 'html', '导入 HTML 助手安装包');
  const first = library.addInstance(htmlImp.id, '消防甲');
  const second = library.addInstance(htmlImp.id, '消防乙');
  const { instanceDir } = require('../src/main/paths');
  const firstHtml = path.join(instanceDir(first.id), 'workspace', 'index.html');
  const secondHtml = path.join(instanceDir(second.id), 'workspace', 'index.html');
  const templateHtml = path.join(instanceDir(first.id), 'package', 'workspace', 'index.html');
  fs.appendFileSync(firstHtml, '\n<!-- INSTANCE_A -->\n', 'utf8');
  assert(fs.readFileSync(secondHtml, 'utf8').indexOf('INSTANCE_A') < 0, '修改一个实例的页面不会影响另一个实例');
  assert(fs.readFileSync(templateHtml, 'utf8').indexOf('INSTANCE_A') < 0, '修改实例页面不会改到只读模板');
  assert(library.current().workspace.type === 'html', '当前打开的是 HTML 工作台');
  library.switchAssistant(first.id);
  assert(library.current().instance.id === first.id, '切换后回到被修改的那个实例');
  assert(fs.readFileSync(firstHtml, 'utf8').indexOf('INSTANCE_A') >= 0, '切换回来仍然是该实例自己的页面');
  assert(library.getAuthorizedPaths(first.id).length === 0, '新实例默认没有授权目录');

  console.log('\n冒烟测试结束。');
}

try { run(); }
catch (e) { console.error('\n[ERROR] ' + e.stack); process.exitCode = 1; }
finally {
  try { fs.rmSync(tmpUser, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响结论 */ }
}
