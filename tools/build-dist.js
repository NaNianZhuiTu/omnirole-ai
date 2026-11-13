/* 打包包装：清掉宿主注入的 NODE_OPTIONS / ELECTRON_RUN_AS_NODE。
 * 某些 IDE 终端会给子进程注入 shim，会拦截 electron-builder 清理临时目录、
 * 或把 electron.exe 变成纯 Node 模式。清掉后打包在任意终端都一致。
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const env = Object.assign({}, process.env);
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;
// 默认走国内镜像，避免 GitHub / 官方源 502 导致打包失败；外部已设置则不覆盖。
env.ELECTRON_MIRROR = env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
env.ELECTRON_BUILDER_BINARIES_MIRROR = env.ELECTRON_BUILDER_BINARIES_MIRROR ||
  'https://npmmirror.com/mirrors/electron-builder-binaries/';

const isWin = process.platform === 'win32';
const bin = path.join(__dirname, '..', 'node_modules', '.bin', isWin ? 'electron-builder.cmd' : 'electron-builder');
const args = process.argv.slice(2);
if (!args.length) args.push('--win');

const child = spawn(bin, args, { env, stdio: 'inherit', shell: isWin });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
child.on('error', (e) => { console.error('打包失败：' + e.message); process.exit(1); });
