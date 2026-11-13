/* 视图积木：引擎实现一次，所有岗位包复用。
 * 岗位包只声明「用哪种积木、哪些字段」，这里负责把它们画出来，并给每条数据挂上出处。
 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  var sources = [];

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function shortDate(v) {
    var s = String(v == null ? '' : v);
    return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
  }
  function resetSources() { sources = []; }
  function getSource(i) { return sources[i] || null; }

  function srcBtn(src, text, cls) {
    if (!src || !src.path) return '<span class="src-link muted">未找到来源</span>';
    var i = sources.push(src) - 1;
    return '<button type="button" class="' + (cls || 'src-link') + '" data-srcref="' + i + '">' + esc(text || src.locator || src.file || '查看出处') + '</button>';
  }
  function miniSrc(src) {
    if (!src || !src.path) return '<span style="color:#b6bfd0">—</span>';
    var i = sources.push(src) - 1;
    return '<button class="mini-src" data-srcref="' + i + '">出处</button>';
  }
  function statusBadge(v) {
    var s = String(v == null ? '' : v);
    if (!s) return '<span class="badge plain">未填写</span>';
    var cls = 'plain';
    if (/正常|已整改|已归档|有效|完好|合格|已闭环/.test(s)) cls = 'ok';
    else if (/整改中|待整改|待办|压力不足|临期|通道待整改|待补|未完成/.test(s)) cls = 'warn';
    else if (/逾期|故障|停用|失效|超期|较重/.test(s)) cls = 'bad';
    return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
  }
  function emptyBlock(title) {
    return '<div class="empty">' + esc(title || '该数据区') + ' 暂无记录</div>';
  }
  function fieldsOf(zone) { return zone.fields || []; }
  function display(row, f, key) {
    var v = row[key == null ? f.key : key];
    if (f.type === 'date') return shortDate(v);
    if (f.type === 'status') return statusBadge(v);
    if (f.type === 'number' && v !== '' && v != null) return esc(v) + (f.unit ? '<span style="color:#94a0b5;font-size:11px"> ' + esc(f.unit) + '</span>' : '');
    return esc(v);
  }
  function firstKey(zone) { return (zone.fields[0] || {}).key; }
  function restKeys(zone) { return (zone.fields || []).slice(1); }

  // ---------- 指标卡 ----------
  function stat(zone) {
    var rows = zone.rows || [];
    return '<div class="panel-body"><div class="card-num" style="margin:6px 0">' + rows.length +
      '</div>' + srcBtn(rows[0] && rows[0].__source, '查看来源') + '</div>';
  }

  // ---------- 表格 ----------
  function table(zone) {
    var rows = zone.rows || [], fs = fieldsOf(zone);
    if (!rows.length) return emptyBlock(zone.title);
    var html = '<div class="panel-body"><table class="tbl"><thead><tr>';
    fs.forEach(f => { html += '<th' + (f.type === 'number' ? ' class="num"' : '') + '>' + esc(f.label) + '</th>'; });
    html += '<th class="src-cell"></th></tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr>';
      fs.forEach(f => { html += '<td' + (f.type === 'number' ? ' class="num"' : '') + '>' + display(r, f) + '</td>'; });
      html += '<td class="src-cell">' + miniSrc(r.__source) + '</td></tr>';
    });
    return html + '</tbody></table></div>';
  }

  // ---------- 卡片列表 ----------
  function cards(zone) {
    var rows = zone.rows || [], fs = fieldsOf(zone);
    if (!rows.length) return emptyBlock(zone.title);
    var main = firstKey(zone), rest = restKeys(zone);
    var html = '<div class="panel-body"><div class="card-grid">';
    rows.forEach(r => {
      html += '<div class="mini-card"><b>' + esc(r[main]) + '</b>';
      rest.forEach(f => { html += '<div class="kv"><span>' + esc(f.label) + '</span><span>' + display(r, f) + '</span></div>'; });
      html += '<div class="foot">' + srcBtn(r.__source, '出处') + '</div></div>';
    });
    return html + '</div></div>';
  }

  // ---------- 时间线 ----------
  function timeline(zone) {
    var rows = zone.rows || [];
    if (!rows.length) return emptyBlock(zone.title);
    var html = '<div class="panel-body"><div class="tl">';
    rows.forEach(r => {
      html += '<div class="tl-item"><div class="tl-year">' + esc(r.year || '—') + '</div><div class="tl-body">' +
        '<b>' + esc(r.title) + '</b><small>' + esc(shortDate(r.updatedAt)) + (r.clause ? ' · ' + esc(r.clause) : '') + '</small>' +
        '<div class="tl-foot">' + srcBtn(r.__source, '出处 · ' + (r.__source && r.__source.file ? r.__source.file : '查看')) + '</div>' +
        '</div></div>';
    });
    return html + '</div></div>';
  }

  // ---------- 检查清单 ----------
  function checklist(zone) {
    var rows = zone.rows || [];
    if (!rows.length) return emptyBlock(zone.title);
    var main = firstKey(zone), rest = restKeys(zone);
    var html = '<div class="panel-body">';
    rows.forEach(r => {
      var done = /已整改|已归档|已完成|正常/.test(String(r.status || ''));
      html += '<div class="check-item"><div class="check-box' + (done ? ' done' : '') + '"></div><div class="check-main">' +
        '<b>' + esc(r[main]) + '</b><small>';
      rest.forEach((f, i) => {
        html += (i ? ' · ' : '') + esc(f.label) + '：' + (f.type === 'status' ? String(r[f.key] || '未填写') : esc(shortDate(r[f.key])));
      });
      html += '</small><div style="margin-top:4px">' + srcBtn(r.__source, '出处') + '</div></div></div>';
    });
    return html + '</div>';
  }

  // ---------- 文档列表 ----------
  function documentList(zone) {
    var rows = zone.rows || [];
    if (!rows.length) return emptyBlock(zone.title);
    var html = '<div class="panel-body">';
    rows.forEach(r => {
      html += '<div class="doc-item"><div class="doc-ico">DOC</div><div class="doc-body">' +
        '<b>' + esc(r.title) + '</b><small>' + esc(r.__source && r.__source.rel || '未知路径') + '</small>' +
        (r.clause ? '<small>涉及条款：' + esc(r.clause) + '</small>' : '') +
        '<div style="margin-top:4px">' + srcBtn(r.__source, '出处 · ' + (r.__source && r.__source.locator || '全文')) + '</div>' +
        '</div></div>';
    });
    return html + '</div>';
  }

  // ---------- 2.5D 点位图 ----------
  function map25d(zone) {
    var rows = (zone.rows || []).filter(r => Number.isFinite(Number(r.x)) && Number.isFinite(Number(r.y)));
    if (!rows.length) return emptyBlock(zone.title);
    var colors = (zone.options && zone.options.kindColors) || {};
    var W = 600, H = 268, cx = 300, cy = 30, k = 2.55, ky = 0.62;
    function proj(x, y) { return { x: (x - y) * k + cx, y: (x + y) * ky + cy }; }
    var s = '<div class="map-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="2.5D 点位图">';
    s += '<defs><linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7faff"/><stop offset="1" stop-color="#e8effc"/></linearGradient>' +
      '<linearGradient id="topFace" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7d99ff"/><stop offset="1" stop-color="#4a6df0"/></linearGradient></defs>';
    // 等距地面
    var a = proj(0, 0), b = proj(100, 0), c = proj(100, 100), d = proj(0, 100);
    s += '<polygon points="' + [a, b, c, d].map(p => p.x + ',' + p.y).join(' ') + '" fill="url(#ground)" stroke="#cfdcff" stroke-width="1.5"/>';
    for (var i = 0; i <= 100; i += 20) {
      var p1 = proj(i, 0), p2 = proj(i, 100), p3 = proj(0, i), p4 = proj(100, i);
      s += '<line x1="' + p1.x + '" y1="' + p1.y + '" x2="' + p2.x + '" y2="' + p2.y + '" stroke="#dbe5f8" stroke-width="1"/>' +
        '<line x1="' + p3.x + '" y1="' + p3.y + '" x2="' + p4.x + '" y2="' + p4.y + '" stroke="#dbe5f8" stroke-width="1"/>';
    }
    // 建筑体块（kind=building）
    var buildings = rows.filter(r => String(r.kind) === 'building');
    buildings.sort((p, q) => (Number(p.x) + Number(p.y)) - (Number(q.x) + Number(q.y)));
    buildings.forEach(r => {
      var P = proj(Number(r.x), Number(r.y));
      var w = 21, h = 11, ht = 26;
      var top = [{ x: P.x, y: P.y - ht }, { x: P.x + w, y: P.y - ht + h }, { x: P.x, y: P.y - ht + 2 * h }, { x: P.x - w, y: P.y - ht + h }];
      var ref = r.__source && r.__source.path ? ' data-srcref="' + (sources.push(r.__source) - 1) + '" style="cursor:pointer"' : '';
      s += '<g' + ref + '><title>' + esc(r.name) + ' · ' + esc(r.status) + '</title>' +
        '<polygon points="' + [top[3], top[2], { x: P.x, y: P.y + 2 * h }, { x: P.x - w, y: P.y + h }].map(p => p.x + ',' + p.y).join(' ') + '" fill="#3b57c9"/>' +
        '<polygon points="' + [top[2], top[1], { x: P.x + w, y: P.y + h }, { x: P.x, y: P.y + 2 * h }].map(p => p.x + ',' + p.y).join(' ') + '" fill="#5375e6"/>' +
        '<polygon points="' + top.map(p => p.x + ',' + p.y).join(' ') + '" fill="url(#topFace)" stroke="#ffffff" stroke-width="1"/>' +
        '<text x="' + P.x + '" y="' + (P.y + 2 * h + 13) + '" text-anchor="middle" font-size="10" fill="#5a6786">' + esc(r.name) + '</text></g>';
    });
    // 设施点位
    rows.filter(r => String(r.kind) !== 'building').forEach(r => {
      var P = proj(Number(r.x), Number(r.y));
      var color = colors[String(r.kind)] || '#d9713c';
      var abnormal = !/正常|完好|有效/.test(String(r.status || ''));
      var ref = r.__source && r.__source.path ? ' data-srcref="' + (sources.push(r.__source) - 1) + '" style="cursor:pointer"' : '';
      s += '<g' + ref + '><title>' + esc(r.name) + ' · ' + esc(r.status) + '</title>' +
        '<circle cx="' + P.x + '" cy="' + P.y + '" r="9" fill="' + color + '" opacity=".14"/>' +
        '<circle cx="' + P.x + '" cy="' + P.y + '" r="4.6" fill="' + (abnormal ? '#d0453b' : color) + '" stroke="#fff" stroke-width="1.6"/>' +
        (abnormal ? '<circle cx="' + (P.x + 6) + '" cy="' + (P.y - 6) + '" r="3" fill="#d0453b"/>' : '') + '</g>';
    });
    s += '</svg></div>';
    var legend = '<div class="map-legend">' +
      Object.keys(colors).map(k => '<span><i style="background:' + colors[k] + '"></i>' + esc(k === 'building' ? '建筑' : k === 'hydrant' ? '消火栓' : k === 'extinguisher' ? '灭火器' : k === 'exit' ? '安全出口' : k) + '</span>').join('') +
      '<span><i style="background:#d0453b"></i>状态异常</span></div>';
    return s + legend;
  }

  function notes(zone) {
    return '<div class="notes-body">' + esc((zone.options && zone.options.text) || '') + '</div>';
  }

  var registry = {
    stat: stat, table: table, cards: cards, timeline: timeline, checklist: checklist,
    map25d: map25d, documentList: documentList, notes: notes
  };

  PA.blocks = {
    esc, shortDate, srcBtn, miniSrc, statusBadge, display,
    resetSources, getSource,
    render: function (view, zone) { return (registry[view] || table)(zone); },
    has: function (view) { return !!registry[view]; }
  };
})(window);
