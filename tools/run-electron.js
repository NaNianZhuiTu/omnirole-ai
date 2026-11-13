/* 启动 Electron 的小包装：清掉宿主可能注入的 ELECTRON_RUN_AS_NODE，
 * 否则 electron.exe 会被当成纯 Node 运行，require('electron') 拿不到 app。
 *   npm start          正常启动
 *   npm run verify     启动并自动逐页验收后退出
 */
'use strict';
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const verify = argv.indexOf('--verify') !== -1;
const shots = argv.indexOf('--shots') !== -1;
const args = argv.filter(a => a !== '--verify' && a !== '--shots');
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
if (verify) env.PA_VERIFY = '1';
if (shots) {
  env.PA_SHOTS = '1';
  env.PA_SHOTS_OUT = env.PA_SHOTS_OUT || require('path').join(__dirname, '..', 'screenshots');
}

const child = spawn(require('electron'), args.length ? args : ['.'], {
  env, stdio: 'inherit', windowsHide: false
});
child.on('exit', (code) => process.exit(code == null ? 1 : code));
child.on('error', (e) => { console.error('启动失败：' + e.message); process.exit(1); });
