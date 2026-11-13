/* HTML 工作台测试：导入校验、实例隔离、接口边界。不启动窗口。
 * 用法：node tools/html-workspace-test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const Module = require('module');

const root = path.join(__dirname, '..');
const tmpUser = path.join(root, '.html-test-userdata');
const restarting = process.argv[2] === '--restart-check';

if (!restarting) {
  fs.rmSync(tmpUser, { recursive: true, force: true });
  fs.mkdirSync(tmpUser, { recursive: true });
}

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

function runRestart() {
  const expect = JSON.parse(fs.readFileSync(path.join(tmpUser, 'restart-expect.json'), 'utf8'));
  const library = require('../src/main/library');
  library.init();
  const cur = library.current();
  assert(cur.instance && cur.instance.id === expect.activeId, '重启后当前助手不变');
  assert(cur.workspace && cur.workspace.type === 'html' && cur.workspace.ready, '重启后 HTML 工作台入口仍在');
  assert(fs.readFileSync(expect.markedFile, 'utf8').indexOf(expect.marker) >= 0, '重启后实例页面修改还在');
  assert(fs.readFileSync(expect.cleanFile, 'utf8').indexOf(expect.marker) < 0, '重启后另一个实例仍不受影响');
  assert(fs.readFileSync(expect.templateFile, 'utf8').indexOf(expect.marker) < 0, '重启后模板仍未被修改');
}

if (restarting) {
  try { runRestart(); }
  catch (e) { console.error('\n[ERROR] ' + (e.stack || e)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}

function writeHtml(dir, mutate) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  const manifest = {
    id: 'bad-html', name: '坏样本', version: '1.0.0', industry: '测试', role: '测试',
    formatVersion: '1.0', minAppVersion: '0.1.0', entry: 'workspace/index.html'
  };
  const assistant = {
    schemaVersion: '1.0', id: 'bad-html', name: '坏样本', version: '1.0.0',
    industry: '测试', role: '测试'
  };
  fs.writeFileSync(path.join(dir, 'workspace', 'index.html'), '<!DOCTYPE html><title>x</title>', 'utf8');
  if (mutate) mutate(manifest, assistant, dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.writeFileSync(path.join(dir, 'assistant.json'), JSON.stringify(assistant), 'utf8');
}

function run() {
  return runAsync();
}

async function runAsync() {
  const library = require('../src/main/library');
  const workspaceApi = require('../src/main/workspace-api');
  const protocol = require('../src/main/workspace-protocol');
  const { PATHS, instanceDir } = require('../src/main/paths');
  const runtime = require('../src/main/runtime/local-runtime');

  console.log('\n== 不再接受旧 JSON 岗位包 ==');
  library.init();
  const legacyFile = path.join(tmpUser, 'legacy.json');
  fs.writeFileSync(legacyFile, JSON.stringify({
    schemaVersion: '1.0', id: 'legacy-json', name: '旧版岗位', version: '1.0.0',
    industry: '测试', role: '测试员',
    zones: [{ id: 'notes', title: '说明', view: 'notes' }]
  }), 'utf8');
  let jsonMessage = '';
  try { library.importPackage(legacyFile); }
  catch (e) { jsonMessage = e.message; }
  assert(jsonMessage.indexOf('manifest.json') >= 0, '单个 JSON 文件不能再导入');
  const legacyDir = path.join(tmpUser, 'legacy-dir');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'package.json'), JSON.stringify({ id: 'legacy-dir-pkg' }), 'utf8');
  let dirMessage = '';
  try { library.importPackage(legacyDir); }
  catch (e) { dirMessage = e.message; }
  assert(dirMessage.indexOf('manifest.json') >= 0, '只有 package.json 的目录不能再导入');

  console.log('\n== 拒绝不合规的 HTML 安装包 ==');
  const cases = path.join(tmpUser, 'bad');
  function expectFail(name, mutate, needle) {
    const dir = path.join(cases, name);
    writeHtml(dir, mutate);
    let message = '';
    try { library.importPackage(dir); }
    catch (e) { message = e.message; }
    const ok = message.indexOf(needle) >= 0;
    assert(ok, ok ? (name + ' 被拒绝') : (name + ' 应提示「' + needle + '」，实际：' + (message || '导入成功')));
  }
  expectFail('missing-html', function (_m, _a, dir) {
    fs.rmSync(path.join(dir, 'workspace', 'index.html'));
  }, '找不到工作台入口文件');
  expectFail('traversal', function (manifest) { manifest.entry = '../secret.html'; }, '上级目录');
  expectFail('absolute', function (manifest) { manifest.entry = 'C:/Windows/a.html'; }, '绝对路径');
  expectFail('format', function (manifest) { manifest.formatVersion = '2.0'; }, '不支持的安装包格式版本');
  expectFail('min-app', function (manifest) { manifest.minAppVersion = '99.0.0'; }, '低于助手要求的最低版本');
  expectFail('id-mismatch', function (_m, assistant) { assistant.id = 'other-id'; }, 'id 不一致');
  expectFail('script', function (_m, assistant) { assistant.summary = '<script>alert(1)</script>'; }, '可执行代码');
  fs.mkdirSync(path.join(tmpUser, 'empty-dir'), { recursive: true });
  let emptyMessage = '';
  try { library.importPackage(path.join(tmpUser, 'empty-dir')); }
  catch (e) { emptyMessage = e.message; }
  assert(emptyMessage.indexOf('manifest.json') >= 0, '空目录会说明缺少哪种安装包');
  const page = path.join(tmpUser, 'page.html');
  fs.writeFileSync(page, '<html></html>', 'utf8');
  let pageMessage = '';
  try { library.importPackage(page); }
  catch (e) { pageMessage = e.message; }
  assert(pageMessage.indexOf('不能把 HTML 页面当作助手导入') >= 0, '不能直接把 HTML 文件当安装包');

  console.log('\n== 导入示例 HTML 助手并隔离实例 ==');
  const sample = path.join(root, 'samples', 'html-fire-assistant');
  const imported = library.importPackage(path.join(sample, 'manifest.json'));
  assert(imported.id === 'html-fire-demo' && imported.workspaceType === 'html', '选择 manifest.json 也能导入整个 HTML 助手');
  const first = library.addInstance(imported.id, '消防甲');
  const second = library.addInstance(imported.id, '消防乙');
  assert(first.id !== second.id, '两个实例 ID 不同');
  const marker = 'INSTANCE_A_ONLY';
  const firstHtml = path.join(instanceDir(first.id), 'workspace', 'index.html');
  const secondHtml = path.join(instanceDir(second.id), 'workspace', 'index.html');
  const packageHtml = path.join(instanceDir(first.id), 'package', 'workspace', 'index.html');
  const importedHtml = path.join(PATHS.imported, 'html-fire-demo', '1.0.0', 'workspace', 'index.html');
  fs.appendFileSync(firstHtml, '\n<p>' + marker + '</p>\n', 'utf8');
  assert(fs.readFileSync(secondHtml, 'utf8').indexOf(marker) < 0, '实例乙的页面没有被改到');
  assert(fs.readFileSync(packageHtml, 'utf8').indexOf(marker) < 0, '实例内的只读模板没有被改到');
  assert(fs.readFileSync(importedHtml, 'utf8').indexOf(marker) < 0, '导入后的原始安装包没有被改到');
  assert(fs.existsSync(path.join(instanceDir(first.id), 'data')), '实例拥有自己的 data 目录');
  assert(fs.existsSync(path.join(instanceDir(first.id), 'documents')), '实例拥有自己的 documents 目录');
  assert(fs.existsSync(path.join(instanceDir(first.id), 'index', 'index.json')), '索引导入 index 目录');
  assert(fs.existsSync(path.join(instanceDir(first.id), 'knowledge', '消防须知.txt')), '知识资料按实例复制');
  library.switchAssistant(first.id);
  assert(library.current().instance.id === first.id, '切换后当前实例是甲');
  assert(library.current().workspace.url === 'pawork://desk/index.html', '工作台地址指向该实例页面');
  fs.writeFileSync(path.join(tmpUser, 'restart-expect.json'), JSON.stringify({
    activeId: first.id,
    marker: marker,
    markedFile: firstHtml,
    cleanFile: secondHtml,
    templateFile: importedHtml
  }), 'utf8');
  const child = spawnSync(process.execPath, [__filename, '--restart-check'], { cwd: root, encoding: 'utf8' });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert(child.status === 0, '新进程重新读盘后工作台仍在');

  console.log('\n== 页面接口边界 ==');
  const docs = path.join(tmpUser, 'user-docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, '台账.txt'), '灭火器年检', 'utf8');
  library.setAuthorizedPaths(first.id, [docs]);
  const listed = workspaceApi.listFiles(first.id, {});
  assert(listed.entries.some(function (item) { return item.path === path.resolve(docs); }), 'files.list 只列出已授权目录');
  const found = workspaceApi.searchFiles(first.id, { query: '年检' });
  assert(found.hits.length === 1, 'files.search 能在授权目录里找到资料');
  const text = workspaceApi.readFile(first.id, { path: path.join(docs, '台账.txt') });
  assert(text.text.indexOf('灭火器年检') >= 0, 'files.read 能读取授权文件');
  let outside = '';
  try { workspaceApi.readFile(first.id, { path: secondHtml }); }
  catch (e) { outside = e.message; }
  assert(outside.indexOf('授权目录') >= 0, '不能读取另一个实例的页面文件');
  let climbed = '';
  try { workspaceApi.readFile(first.id, { path: path.join(docs, '..', 'library', 'registry.json') }); }
  catch (e) { climbed = e.message; }
  assert(climbed.indexOf('授权目录') >= 0 || climbed.indexOf('路径不存在') >= 0, '不能用上级目录跳出授权范围');
  let winini = '';
  try { workspaceApi.readFile(first.id, { path: 'C:\\Windows\\win.ini' }); }
  catch (e) { winini = e.message; }
  assert(winini && winini.indexOf('允许') < 0 && winini !== '', '不能读取未授权的系统文件');
  const written = workspaceApi.writeData(first.id, { name: 'note.json', value: { n: 1 }, instanceId: second.id });
  assert(written.name === 'note.json', 'data.write 忽略页面自报的实例 ID');
  assert(fs.existsSync(path.join(instanceDir(first.id), 'data', 'note.json')), '数据写在当前实例');
  assert(!fs.existsSync(path.join(instanceDir(second.id), 'data', 'note.json')), '数据没有写进另一个实例');
  let crossed = '';
  try { workspaceApi.writeData(second.id, { name: 'note.json', value: { n: 2 } }); }
  catch (e) { crossed = e.message; }
  assert(crossed.indexOf('当前助手已切换') >= 0, '不能以另一个实例的身份写入');
  let escapeWrite = '';
  try { workspaceApi.writeData(first.id, { name: '../package/assistant.json', value: { pwn: true } }); }
  catch (e) { escapeWrite = e.message; }
  assert(escapeWrite.indexOf('上级目录') >= 0, '不能把数据写到模板目录');
  assert(fs.readFileSync(path.join(instanceDir(first.id), 'package', 'assistant.json'), 'utf8').indexOf('pwn') < 0, '模板文件内容不变');
  const doc = workspaceApi.createDocument(first.id, { name: '巡检.md', content: '第一条', format: 'md' });
  assert(doc.rel === '巡检.md', 'documents.create 写入当前实例');
  assert(fs.readFileSync(path.join(instanceDir(first.id), 'documents', '巡检.md'), 'utf8') === '第一条', '文档内容正确');
  let docEscape = '';
  try { workspaceApi.createDocument(first.id, { name: '../note.md', content: 'x', format: 'md' }); }
  catch (e) { docEscape = e.message; }
  assert(docEscape.indexOf('上级目录') >= 0, '文档不能写到 documents 外面');
  const info = workspaceApi.getInfo(first.id);
  assert(info.id === first.id && info.workspaceType === 'html' && info.duties.length === 2, 'assistant.getInfo 返回当前助手');
  let aiMessage = '';
  const beforeChat = library.readChat(first.id).messages.length;
  try {
    await workspaceApi.chat(first.id, { messages: [{ role: 'user', content: '你好' }] }, runtime);
  } catch (e) { aiMessage = e.message; }
  assert(aiMessage.indexOf('尚未配置模型') >= 0, '未配置模型时对话给出明确失败原因');
  assert(library.readChat(first.id).messages.length === beforeChat, '失败的对话不会写入记录');

  console.log('\n== 地址与 webview 策略 ==');
  assert(protocol.parseWorkspaceUrl('pawork://desk/index.html').rel === 'index.html', '能解析工作台入口');
  assert(protocol.isWorkspaceDocumentUrl('pawork://desk/styles/main.css') === false, '样式文件不能当作页面导航');
  assert(protocol.parseWorkspaceUrl('file:///C:/Windows/win.ini') === null, '拒绝 file 协议');
  assert(protocol.parseWorkspaceUrl('pawork://evil/index.html') === null, '拒绝其他主机名');
  assert(protocol.parseWorkspaceUrl('pawork://desk/C:/Windows/win.ini') === null, '拒绝盘符路径');
  const wsRoot = path.join(tmpUser, 'ws-root');
  fs.mkdirSync(wsRoot, { recursive: true });
  fs.writeFileSync(path.join(wsRoot, 'index.html'), 'ok', 'utf8');
  const resolved = protocol.resolveWorkspaceFile(wsRoot, 'index.html');
  assert(resolved === path.join(wsRoot, 'index.html'), '资源落在 workspace 内');
  let escaped = '';
  try { protocol.resolveWorkspaceFile(wsRoot, '../secret.html'); }
  catch (e) { escaped = e.message; }
  assert(escaped.indexOf('不合法') >= 0, '相对路径不能跳出 workspace');
  const reviewOk = protocol.reviewWebviewAttach({
    partition: 'persist:pa-' + first.id,
    src: 'pawork://desk/index.html'
  }, first.id);
  assert(reviewOk.ok, '当前实例的 webview 允许挂载');
  const reviewBad = protocol.reviewWebviewAttach({
    partition: 'persist:pa-' + second.id,
    src: 'file:///C:/secret.html'
  }, first.id);
  assert(!reviewBad.ok, '错误分区和 file 地址会被拒绝');
  const hardened = protocol.hardenWebPreferences({ nodeIntegration: true, preload: 'evil.js', webSecurity: false }, 'C:/app/workspace-preload.js');
  assert(hardened.nodeIntegration === false && hardened.sandbox === true && hardened.contextIsolation === true, 'webview 被强制关闭 Node');
  assert(hardened.preload === 'C:/app/workspace-preload.js' && hardened.webSecurity === true, 'preload 只能使用程序自己的脚本');
  assert(protocol.CSP.indexOf("default-src 'none'") >= 0 && protocol.CSP.indexOf('http:') < 0, '页面内容安全策略不放开远程地址');

  console.log('\n== preload 没有通用 IPC ==');
  const preload = fs.readFileSync(path.join(root, 'src', 'main', 'workspace-preload.js'), 'utf8');
  const calls = preload.match(/call\('([^']+)'/g) || [];
  assert(calls.length >= 10, '基础接口都有明确通道');
  calls.forEach(function (item) {
    assert(item.indexOf("call('ws:") === 0, '通道必须是 ws: 前缀：' + item);
  });
  assert(preload.indexOf("require('fs'") < 0 && preload.indexOf("require('child_process'") < 0, 'preload 不引用 Node 文件模块');
  assert(preload.indexOf('exposeInMainWorld(\'ipcRenderer\'') < 0 && preload.indexOf('desktop.invoke') < 0, '没有把通用调用暴露给页面');

  console.log('\n== 删除一个实例不影响另一个 ==');
  library.removeInstance(second.id);
  const left = library.listInstances();
  assert(!left.instances.some(function (item) { return item.id === second.id; }), '被移除的实例离开列表');
  assert(left.instances.some(function (item) { return item.id === first.id; }), '另一个实例还在');
  assert(fs.readFileSync(firstHtml, 'utf8').indexOf(marker) >= 0, '移除操作没有改动剩余实例的页面');
  assert(library.current().instance.id === first.id, '当前助手仍是未被移除的那个');

  console.log('\nHTML 工作台测试结束。');
}

run().then(function () {
  cleanup(process.exitCode || 0);
}, function (e) {
  console.error('\n[ERROR] ' + (e.stack || e));
  cleanup(1);
});

function cleanup(code) {
  try { fs.rmSync(tmpUser, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响结论 */ }
  process.exit(code);
}
