/* 仅用于自动化验收（PA_VERIFY=1）：真实窗口里逐页点击，检查 DOM 与控制台错误。
 * 生产启动不会加载本文件。
 */
'use strict';
const fs = require('fs');

function writeReport(text) {
  const out = process.env.PA_VERIFY_OUT;
  if (!out) return;
  try { fs.appendFileSync(out, text + '\n', 'utf8'); } catch (e) { /* 诊断写入失败不阻断 */ }
}

function emit(line) { console.log(line); writeReport(line); }

function attach(win, app) {
  const errors = [];
  const guard = setTimeout(() => {
    writeReport('VERIFY_TIMEOUT=1');
    writeReport('VERIFY_CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 12)));
    app.exit(2);
  }, 30000);
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    writeReport('VERIFY_LOAD_FAIL=' + code + ' ' + desc);
  });
  win.webContents.on('console-message', (event, level, message) => {
    const msg = typeof event === 'object' && event !== null ? (event.message || '') : message;
    const lv = typeof event === 'object' && event !== null ? (event.level != null ? event.level : level) : level;
    if (lv >= 2) errors.push(msg);
  });

  win.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 1200));
    // 验收固定从第一个（消防岗）开始，避免上次会话停在其他助手导致假失败
    await win.webContents.executeJavaScript(
      "(async function(){var l=PA.app.state.library;if(l&&l.instances.length&&l.activeId!==l.instances[0].id){await PA.app.switchTo(l.instances[0].id);}PA.app.go('workbench');return true;})()", true);
    await new Promise(r => setTimeout(r, 800));
    const script = `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const q = (s) => document.querySelectorAll(s).length;
      const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : ''; };
      // 工作区只剩三个入口，其余页面由菜单 / 程序内 go() 进入
      const go = async (page) => { PA.app.go(page); await sleep(220); };
      const out = {};
      try {

      out.workbench = {
        assistants: (PA.app.state.library.instances || []).length, cards: q('#page-workbench .card'), panels: q('#page-workbench .panel'),
        svg: q('#page-workbench svg'), srcLinks: q('#page-workbench [data-srcref]'),
        tableRows: q('#page-workbench .tbl tbody tr'),
        dashboard: Array.from(document.querySelectorAll('#page-workbench .card-num')).map(e => e.textContent.trim()),
        quickPrompts: q('#quickPrompts .quick-btn'), hasError: !!document.querySelector('#page-workbench .empty')
      };

      // 用户 2026-11-13 要求：工作区只留 岗位工作台 / 本地资料 / AI 助手 三项
      out.workspace = {
        navCount: q('#navList .nav-item'),
        labels: Array.from(document.querySelectorAll('#navList .nav-item')).map(e => e.textContent.trim()),
        aiPage: q('#page-ai'),
        chatInMain: !!document.querySelector('#mainArea #chatPanel.chatpanel.in-page'),
        noSideChat: q('.body > .chatpanel') === 0,
        noSidebar: q('.sidebar') === 0
      };

      // 应用没有菜单栏；设置 / 助手选择入口在顶部工作条右侧
      out.controls = {
        noTitlebar: q('.titlebar') === 0,
        noInAppControls: !document.querySelector('#assistSwitch') &&
          !document.querySelector('#toggleChatBtn') && !document.querySelector('#modelState'),
        noMenu: q('.sysmenu') === 0 && q('#sysMenu') === 0 && q('#sysMenuPop') === 0,
        settingsLink: !!document.querySelector('#settingsBtn'),
        noOutputs: q('#outputsBtn') === 0 && q('#page-outputs') === 0,
        picker: !!document.querySelector('#assistantPickerBtn')
      };
      PA.app.menuAction({ type: 'go', page: 'files' });
      await sleep(200);
      out.controls.goWorks = !!document.querySelector('#page-files.active');
      PA.app.menuAction({ type: 'toggle-chat' });
      await sleep(160);
      out.controls.aiShown = !!document.querySelector('#page-ai.active');
      PA.app.menuAction({ type: 'toggle-chat' });
      await sleep(160);
      out.controls.aiHidden = !document.querySelector('#page-ai.active');
      PA.app.menuAction({ type: 'go', page: 'workbench' });
      await sleep(200);
      out.controls.backToWorkbench = !!document.querySelector('#page-workbench.active');
      document.getElementById('settingsBtn').click();
      await sleep(200);
      out.controls.settingsByButton = !!document.querySelector('#page-settings.active');
      await go('workbench');

      // 来源抽屉
      const firstSrc = document.querySelector('#page-workbench [data-srcref]');
      if (firstSrc) { firstSrc.click(); await sleep(150); }
      out.drawer = { open: !!document.querySelector('#sourceDrawer.show'), rows: q('#drawerBody .kv-row') };
      document.querySelector('#drawerClose').click();

      await go('files');
      await sleep(500);
      out.files = {
        paths: q('#page-files .path-box'),
        cols: q('#page-files .miller-col'),
        folders: q('#page-files .miller-folder'),
        files: q('#page-files .miller-file'),
        add: !!document.querySelector('#addFolderBtn'),
        titles: Array.from(document.querySelectorAll('#page-files .miller-col h3')).map(e => e.textContent.trim())
      };
      const sample = Array.from(document.querySelectorAll('#page-files .path-name')).find(e => /fire-safety|示例资料/.test(e.textContent));
      if (sample) { sample.click(); await sleep(400); }
      out.files.afterRoot = {
        cols: q('#page-files .miller-col'),
        folders: q('#page-files .miller-folder'),
        files: q('#page-files .miller-file'),
        titles: Array.from(document.querySelectorAll('#page-files .miller-col h3')).map(e => e.textContent.trim())
      };
      const plan = Array.from(document.querySelectorAll('#page-files .miller-folder')).find(e => /历年方案/.test(e.textContent));
      out.files.planFound = !!plan;
      if (plan) { plan.click(); await sleep(400); }
      const second = document.querySelectorAll('#page-files .miller-col')[1];
      out.files.opened = second ? second.querySelectorAll('.miller-file').length : 0;
      out.files.openedName = second && second.querySelector('.miller-file') ? second.querySelector('.miller-file').textContent.trim() : '';
      out.files.secondTitle = second && second.querySelector('h3') ? second.querySelector('h3').textContent.trim() : '';

      await go('library');
      out.library = { cards: q('#page-library .lib-card'), installed: q('#page-library .list-row'), addButtons: q('#page-library [data-add]') };

      await go('settings');
      out.settings = { hasBaseUrl: !!document.querySelector('#setBaseUrl'), presets: q('#page-settings .preset-btn'), hasSave: !!document.querySelector('#saveSettingsBtn') };

      // 助手选择页：卡片式，点击卡片切换并回到工作台
      await go('assistants');
      out.assistantsPage = {
        cards: q('#page-assistants .assist-card'),
        add: !!document.querySelector('#assistAddBtn'),
        picker: !!document.querySelector('#assistantPickerBtn')
      };
      const cards = document.querySelectorAll('#page-assistants .assist-card');
      if (cards.length > 1) {
        cards[1].click();
        await sleep(700);
        out.switched = { name: t('#page-workbench h1') };
        await go('assistants');
        document.querySelectorAll('#page-assistants .assist-card')[0].click();
        await sleep(600);
      } else {
        out.switched = { name: '', onlyFire: true };
        await go('workbench');
      }
      out.back = { name: t('#page-workbench h1'), svg: q('#page-workbench svg'), srcLinks: q('#page-workbench [data-srcref]') };
      } catch (e) { out._error = String((e && e.stack) || e); }
      return out;
    })()`;

    try {
      const r = await win.webContents.executeJavaScript(script, true);
      // 快捷键由 before-input-event 兜底；Ctrl+B 必须只切换一次（不能与原生菜单重复触发）
      const pressB = async () => {
        await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['control'] });
        await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'B', modifiers: ['control'] });
        await new Promise(done => setTimeout(done, 240));
      };
      await pressB();
      const aiAfter = await win.webContents.executeJavaScript(
        "!!document.querySelector('#page-ai.active')", true);
      await pressB();
      const backAfter = await win.webContents.executeJavaScript(
        "!document.querySelector('#page-ai.active')", true);
      r.shortcut = { toggledOnce: aiAfter === true, restored: backAfter === true };
      emit('VERIFY_REPORT=' + JSON.stringify(r));
      emit('VERIFY_CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 12)));
      const w = r.workbench;
      const ok =
        w.assistants === 0 && w.cards === 0 && w.panels === 0 && w.svg === 0 &&
        w.quickPrompts === 0 && !w.hasError &&
        r.workspace.navCount === 3 &&
        ['岗位工作台', '本地资料', 'AI 助手'].every(x => r.workspace.labels.indexOf(x) !== -1) &&
        r.workspace.aiPage === 1 && r.workspace.chatInMain && r.workspace.noSideChat &&
        r.workspace.noSidebar && r.assistantsPage.cards >= 1 && r.assistantsPage.add && r.assistantsPage.picker &&
        r.controls.noTitlebar && r.controls.noInAppControls && r.controls.noMenu &&
        r.controls.settingsLink && r.controls.noOutputs && r.controls.picker &&
        r.controls.goWorks && r.controls.aiShown && r.controls.aiHidden && r.controls.backToWorkbench &&
        r.controls.settingsByButton &&
        r.shortcut.toggledOnce && r.shortcut.restored &&
        !r.drawer.open &&
        r.files.add && r.files.cols === 0 &&
        r.library.cards === 0 && r.library.installed === 0 &&
        r.settings.hasBaseUrl && r.settings.presets === 1 &&
        r.back.name === '' && r.back.svg === 0;
      emit('VERIFY_RESULT=' + (ok ? 'PASS' : 'FAIL'));
      clearTimeout(guard);
      app.exit(ok ? 0 : 1);
    } catch (e) {
      emit('VERIFY_ERROR=' + e.message);
      emit('VERIFY_CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 12)));
      clearTimeout(guard);
      app.exit(1);
    }
  });
}

module.exports = { attach };
