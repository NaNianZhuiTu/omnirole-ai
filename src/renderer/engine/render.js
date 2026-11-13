/* 视图引擎：读纯数据岗位包 + 本机资料索引，拼出岗位业务工作台。
 * 换一份岗位包，界面随之改变，引擎代码一行不改。
 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  var B = PA.blocks, S = PA.schema;

  function esc(v) { return B.esc(v); }

  function aggregate(d, zones) {
    var rows = ((zones[d.from] || {}).rows || []).slice();
    if (d.filter && d.filter.field) {
      rows = rows.filter(function (r) {
        var v = String(r[d.filter.field] == null ? '' : r[d.filter.field]);
        if (d.filter.equals != null) return v === String(d.filter.equals);
        if (d.filter.notEquals != null) return v !== String(d.filter.notEquals);
        return true;
      });
    }
    var nums = rows.map(function (r) { return Number(r[d.field]); }).filter(function (n) { return Number.isFinite(n); });
    var value = 0;
    switch (d.agg) {
      case 'count': value = rows.length; break;
      case 'sum': value = nums.reduce(function (a, b) { return a + b; }, 0); break;
      case 'avg': value = nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : 0; break;
      case 'max': value = nums.length ? Math.max.apply(null, nums) : 0; break;
      case 'min': value = nums.length ? Math.min.apply(null, nums) : 0; break;
      case 'latest': value = rows.length; break;
      default: value = rows.length;
    }
    if (d.agg === 'avg') value = Math.round(value * 10) / 10;
    return { value: value, rows: rows, source: rows.length ? rows[0].__source : null };
  }

  function blockLabel(view) {
    var b = S.BLOCKS.filter(function (x) { return x.id === view; })[0];
    return b ? b.label : view;
  }

  function dashboardHtml(pkg, index) {
    var zones = (index && index.zones) || {};
    var list = pkg.dashboard || [];
    if (!list.length) return '';
    var html = '<div class="cards">';
    list.forEach(function (d) {
      var a = aggregate(d, zones);
      html += '<div class="card"><div class="card-top"><span class="card-ico">' + esc(d.icon || '#') + '</span>' + esc(d.label) + '</div>' +
        '<div class="card-num">' + esc(a.value) + (d.unit ? '<em>' + esc(d.unit) + '</em>' : '') + '</div>' +
        B.srcBtn(a.source, a.source ? '来源 · ' + (a.source.file || '查看') : '未找到来源') + '</div>';
    });
    return html + '</div>';
  }

  function panelHtml(zoneDef, zoneData) {
    var zone = {
      title: zoneDef.title,
      fields: zoneDef.fields || [],
      options: zoneDef.options || {},
      rows: (zoneData && zoneData.rows) || []
    };
    var body = B.render(zoneDef.view, zone);
    return '<div class="panel"><div class="panel-head"><div><b>' + esc(zoneDef.title) + '</b></div>' +
      '<div style="display:flex;gap:7px;align-items:center"><span class="tag">' + (zone.rows.length) + ' 条</span></div></div>' + body + '</div>';
  }

  function layoutHtml(pkg, index) {
    var zones = (index && index.zones) || {};
    var defs = {};
    (pkg.zones || []).forEach(function (z) { defs[z.id] = z; });
    var rows = (pkg.layout && pkg.layout.length)
      ? pkg.layout
      : [{ cols: (pkg.zones || []).map(function (z) { return { zone: z.id, span: 1 }; }) }];
    var html = '<div class="rows">';
    rows.forEach(function (row) {
      html += '<div class="row">';
      (row.cols || []).forEach(function (col) {
        var def = defs[col.zone];
        if (!def) return;
        html += '<div class="span' + Math.min(3, Math.max(1, col.span || 1)) + '">' + panelHtml(def, zones[col.zone]) + '</div>';
      });
      html += '</div>';
    });
    return html + '</div>';
  }

  function renderWorkbench(container, state) {
    var cur = state.current || {};
    var pkg = cur.pkg, index = cur.index;
    if (!pkg) {
      container.innerHTML = '';
      return;
    }
    B.resetSources();
    var idxTime = index && index.generatedAt ? new Date(index.generatedAt).toLocaleString('zh-CN') : '尚未建立';

    var html = '<div class="page-head"><div><h1>' + esc(pkg.name) + ' · 工作台</h1>' +
      '<p>' + esc(pkg.industry) + ' / ' + esc(pkg.role) + '</p></div>' +
      '<div class="head-right"><span class="tag blue">岗位包 v' + esc(pkg.version) + '</span>' +
      '<span class="tag">' + (pkg.zones || []).length + ' 个数据区</span>' +
      '<span class="tag gray">索引 ' + esc(idxTime) + '</span>' +
      '<button class="secondary-btn" id="reindexBtn">重新扫描本机资料</button></div></div>';

    html += dashboardHtml(pkg, index);
    html += layoutHtml(pkg, index);

    container.innerHTML = html;
    var btn = document.getElementById('reindexBtn');
    if (btn) btn.addEventListener('click', function () { PA.app.reindex(); });
  }

  PA.render = { renderWorkbench: renderWorkbench, aggregate: aggregate, blockLabel: blockLabel };
})(window);
