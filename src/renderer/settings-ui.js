/* 设置页：模型接入、资料外发开关、当前生效参数、本机数据位置。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  function esc(v) { return PA.blocks.esc(v); }

  var PROVIDER_LABEL = {
    'openai-compatible': 'OpenAI 兼容',
    anthropic: 'Anthropic'
  };

  // 资料上下文上限：四档（字符数），与下拉项一一对应
  var CONTEXT_LEVELS = [
    { value: 24000, label: 'Default' },
    { value: 8000, label: 'Low' },
    { value: 48000, label: 'High' },
    { value: 100000, label: 'Max' }
  ];

  function hostOf(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  function render(container, state) {
    var s = state.settings || {};
    var info = state.appInfo || {};
    var presets = info.presets || [];
    var configured = !!state.modelConfigured;

    var activePreset = null;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].provider === s.provider && presets[i].baseUrl === s.baseUrl) { activePreset = presets[i]; break; }
    }

    var html = '<div class="page-head"><div><h1>设置</h1></div></div>';

    html += '<div class="settings-layout">';

    /* ---- 左：模型接入 ---- */
    html += '<div class="set-main">';

    html += '<section class="set-card">' +
      '<div class="set-head"><h3>模型接入</h3>' +
      '<span class="set-state ' + (configured ? 'on' : 'off') + '"><i></i>' + (configured ? '已配置' : '未配置') + '</span></div>' +
      '<div class="set-body">';

    html += '<div class="preset-grid">' + presets.map(function (p) {
      var cls = 'preset-btn' + (activePreset && activePreset.id === p.id ? ' active' : '');
      return '<button class="' + cls + '" data-preset="' + esc(p.id) + '">' +
        '<b>' + esc(p.label) + '</b>' +
        '<small>' + esc(hostOf(p.baseUrl) || PROVIDER_LABEL[p.provider] || '') + '</small></button>';
    }).join('') + '</div>';

    html += '<div class="field-row">' +
      '<div class="field"><label>接口协议</label><select id="setProvider">' +
      '<option value="openai-compatible"' + (s.provider === 'openai-compatible' ? ' selected' : '') + '>OpenAI 兼容 /chat/completions</option>' +
      '<option value="anthropic"' + (s.provider === 'anthropic' ? ' selected' : '') + '>Anthropic /v1/messages</option>' +
      '</select></div>' +
      '<div class="field"><label>模型名称</label><input id="setModel" value="' + esc(s.model || '') + '" placeholder="deepseek-chat"></div></div>';

    html += '<div class="field"><label>服务地址</label><input id="setBaseUrl" value="' + esc(s.baseUrl || '') + '" placeholder="https://api.deepseek.com"></div>';

    html += '<div class="field"><label>API Key' +
      '<span class="tag ' + (s.hasKey ? 'green' : 'gray') + '">' + (s.hasKey ? '已保存' : '未填写') + '</span></label>' +
      '<input id="setApiKey" type="password" value="" placeholder="' +
      (s.hasKey ? esc(s.apiKey || '已保存，留空则不修改') : '输入 API Key') + '"></div>';

    var curChars = Number(s.maxContextChars) || 24000;
    var hasLevel = CONTEXT_LEVELS.some(function (x) { return x.value === curChars; });
    html += '<div class="field-row">' +
      '<div class="field"><label>温度</label><input id="setTemp" type="number" min="0" max="1" step="0.1" value="' + esc(s.temperature) + '"></div>' +
      '<div class="field"><label>资料上下文上限</label><select id="setMaxChars">' +
      CONTEXT_LEVELS.map(function (x) {
        return '<option value="' + x.value + '"' + (x.value === curChars ? ' selected' : '') + '>' + x.label + '</option>';
      }).join('') +
      (hasLevel ? '' : '<option value="' + curChars + '" selected>当前 · ' + esc(curChars.toLocaleString('zh-CN')) + ' 字符</option>') +
      '</select></div></div>';

    html += '<label class="set-check"><input type="checkbox" id="setSendData"' + (s.sendLocalData !== false ? ' checked' : '') + '>' +
      '<span><b>允许把当前助手的资料片段随请求发送给模型</b></span></label>';

    html += '</div>' +
      '<div class="set-foot"><span class="set-dirty" id="settingsDirty"></span>' +
      '<button class="primary-btn" id="saveSettingsBtn">保存设置</button></div>' +
      '</section>';

    html += '</div>';

    /* ---- 右：当前生效 + 本机数据 ---- */
    html += '<aside class="set-side">';

    html += '<section class="set-card">' +
      '<div class="set-head"><h3>当前生效</h3></div>' +
      '<div class="set-body">' +
      '<div class="stat-line"><span>模型</span><b>' + esc(s.model || '未设置') + '</b></div>' +
      '<div class="stat-line"><span>协议</span><b>' + esc(PROVIDER_LABEL[s.provider] || s.provider || '未设置') + '</b></div>' +
      '<div class="stat-line"><span>温度</span><b>' + esc(s.temperature) + '</b></div>' +
      '<div class="stat-line"><span>上下文上限</span><b>' + esc(Number(s.maxContextChars || 0).toLocaleString('zh-CN')) + ' 字符</b></div>' +
      '<div class="stat-line"><span>资料外发</span><b>' + (s.sendLocalData !== false ? '允许' : '禁止') + '</b></div>' +
      '</div></section>';

    html += '<section class="set-card">' +
      '<div class="set-head"><h3>本机与数据</h3></div>' +
      '<div class="set-body">' +
      '<div class="stat-line"><span>底座</span><b>' + esc((info.runtime && info.runtime.label) || '本机薄底座') + '</b></div>' +
      '<div class="stat-line"><span>版本</span><b>v' + esc(info.version || '') + '</b></div>' +
      '<div class="path-chip">' + esc(info.dataDir || '') + '</div>' +
      '<button class="secondary-btn wide-btn" id="openDataDirBtn">打开数据目录</button>' +
      '</div></section>';

    html += '</aside>';

    html += '</div>';

    container.innerHTML = html;

    var dirty = document.getElementById('settingsDirty');
    function markDirty() { if (dirty) dirty.textContent = '有未保存的修改'; }
    container.querySelectorAll('.set-body input, .set-body select').forEach(function (el) {
      el.addEventListener('input', markDirty);
      el.addEventListener('change', markDirty);
    });

    container.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = presets.find(function (x) { return x.id === b.getAttribute('data-preset'); });
        if (!p) return;
        document.getElementById('setProvider').value = p.provider;
        document.getElementById('setBaseUrl').value = p.baseUrl;
        if (p.model) document.getElementById('setModel').value = p.model;
        container.querySelectorAll('[data-preset]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        markDirty();
        PA.app.toast('已填入预设');
      });
    });

    document.getElementById('saveSettingsBtn').addEventListener('click', async function () {
      var patch = {
        provider: document.getElementById('setProvider').value,
        baseUrl: document.getElementById('setBaseUrl').value.trim(),
        model: document.getElementById('setModel').value.trim(),
        temperature: Number(document.getElementById('setTemp').value) || 0.3,
        maxContextChars: Number(document.getElementById('setMaxChars').value) || 24000,
        sendLocalData: document.getElementById('setSendData').checked
      };
      var key = document.getElementById('setApiKey').value.trim();
      if (key) patch.apiKey = key;
      try {
        await PA.app.call('settings', 'set', patch);
        await PA.app.reloadSettings();
        PA.app.toast('设置已保存');
        PA.app.renderAll();
      } catch (e) { PA.app.toast('保存失败：' + e.message); }
    });

    document.getElementById('openDataDirBtn').addEventListener('click', function () {
      PA.app.call('system', 'openDataDir').catch(function (e) { PA.app.toast('打开失败：' + e.message); });
    });
  }

  PA.settingsUI = { render: render };
})(window);
