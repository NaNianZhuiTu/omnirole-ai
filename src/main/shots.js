/* 仅用于演示/自检（PA_SHOTS=1）：启动真实窗口，逐页切换并截图落盘。
 * 生产启动不会加载本文件。截图用 Chromium 自带 capturePage，不依赖屏幕是否可见。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { desktopCapturer, screen } = require('electron');

// 可选：从真实屏幕裁窗口顶部区域（系统标题栏 / 原生菜单栏，capturePage 截不到）
async function snapScreenTop(win, outDir, log, name, width, height) {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.bounds.width * scale),
      height: Math.round(display.bounds.height * scale)
    }
  });
  const src = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
  if (!src) throw new Error('未取到屏幕画面');
  const img = src.thumbnail;
  const rect = {
    x: Math.max(0, Math.round((bounds.x - display.bounds.x) * scale)),
    y: Math.max(0, Math.round((bounds.y - display.bounds.y) * scale)),
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  };
  const crop = img.crop(rect);
  const file = path.join(outDir, name + '.png');
  fs.writeFileSync(file, crop.toPNG());
  log('SAVED=' + name + ' ' + fs.statSync(file).size + 'B');
}

function attach(win, app) {
  const outDir = process.env.PA_SHOTS_OUT || path.join(__dirname, '..', '..', 'screenshots');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { /* 忽略 */ }
  const saved = [];
  const log = (s) => console.log('SHOT_' + s);
  const guard = setTimeout(() => { log('TIMEOUT'); app.exit(2); }, 90000);

  async function snap(name) {
    await new Promise(r => setTimeout(r, 500));
    const img = await win.webContents.capturePage();
    const file = path.join(outDir, name + '.png');
    fs.writeFileSync(file, img.toPNG());
    saved.push({ name, file, bytes: fs.statSync(file).size });
    log('SAVED=' + name + ' ' + saved[saved.length - 1].bytes + 'B');
  }

  win.webContents.once('did-finish-load', async () => {
    const exec = (js) => win.webContents.executeJavaScript(js, true);
    try {
      await new Promise(r => setTimeout(r, 1600));
      // activeId 会持久化，程序可能停在任意助手；演示固定从第一个（消防岗）开始
      await exec("(async function(){var l=PA.app.state.library;if(l&&l.instances.length&&l.activeId!==l.instances[0].id){await PA.app.switchTo(l.instances[0].id);}PA.app.go('workbench');return true;})()");
      await new Promise(r => setTimeout(r, 800));

      // 顶部区域：核对产品名与六组菜单确实并在同一行（合并标题栏）
      const [contentWidth, contentHeight] = win.getContentSize();
      const bar = await win.webContents.capturePage({ x: 0, y: 0, width: contentWidth, height: 40 });
      const barFile = path.join(outDir, '00-顶部区域.png');
      fs.writeFileSync(barFile, bar.toPNG());
      log('SAVED=00-顶部区域 ' + fs.statSync(barFile).size + 'B');

      // 底部状态条：模型状态与对话开关已挪到这里
      const sb = await win.webContents.capturePage({ x: 0, y: Math.max(0, contentHeight - 30), width: contentWidth, height: 30 });
      const sbFile = path.join(outDir, '00-底部状态条.png');
      fs.writeFileSync(sbFile, sb.toPNG());
      log('SAVED=00-底部状态条 ' + fs.statSync(sbFile).size + 'B');

      await snap('01-工作台-消防岗');

      await exec("document.querySelector('#page-workbench [data-srcref]').click()");
      await snap('02-来源溯源抽屉');
      await exec("document.querySelector('#drawerClose').click()");

      await exec("PA.app.go('files')");
      await snap('03-本地资料');

      await exec("PA.app.go('ai')");
      await snap('03b-AI助手');

      await exec("PA.app.go('library')");
      await snap('04-助手库');

      await exec("PA.app.go('settings')");
      await snap('05-模型设置');

      await exec("PA.app.go('assistants')");
      await snap('06-选择助手');

      if (process.env.PA_SHOTS_SCREEN === '1') {
        try {
          await snapScreenTop(win, outDir, log, '07-标题栏图标', 430, 40);
        } catch (e) { log('SCREEN_SKIP=' + e.message); }
      }
      log('DONE=' + JSON.stringify(saved));
      clearTimeout(guard);
      app.exit(0);
    } catch (e) {
      log('ERROR=' + (e && e.stack ? e.stack : e));
      clearTimeout(guard);
      app.exit(1);
    }
  });
}

module.exports = { attach };
