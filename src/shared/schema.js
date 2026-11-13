/* 岗位包 schema / 视图积木清单 / 校验器
 * UMD：主进程 CommonJS require，渲染进程通过 <script> 挂到 window.PA.schema。
 *
 * 核心约束：岗位包 JSON 是【纯数据】。校验器会拒绝任何可执行内容字段。
 * HTML 工作台的页面文件不进这份 JSON；页面在独立 webview 里运行，不由此处执行。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PA = root.PA || {}; root.PA.schema = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = '1.0';
  var FORMAT_VERSION = '1.0';

  // 视图积木清单：引擎实现一次，所有岗位包复用。新增积木只改引擎，不改岗位包格式。
  var BLOCKS = [
    { id: 'stat',        label: '指标卡',     desc: '单个数值 + 聚合规则 + 来源',        dataShape: 'rows' },
    { id: 'table',       label: '表格',       desc: '多列字段表格，逐行带来源',          dataShape: 'rows' },
    { id: 'cards',       label: '卡片列表',   desc: '以卡片呈现对象，主字段 + 副字段',    dataShape: 'rows' },
    { id: 'timeline',    label: '时间线',     desc: '按时间字段排序的文档/事件序列',      dataShape: 'rows' },
    { id: 'checklist',   label: '检查清单',   desc: '带状态列的待办/隐患条目',            dataShape: 'rows' },
    { id: 'map25d',      label: '2.5D 点位图', desc: '等距投影底图 + 坐标点位，数据驱动', dataShape: 'points' },
    { id: 'documentList',label: '文档列表',   desc: '资料文件清单 + 版本/年份 + 出处',    dataShape: 'documents' },
    { id: 'notes',       label: '说明文本',   desc: '静态说明，内容须标注来源或声明为示例', dataShape: 'none' }
  ];
  var BLOCK_IDS = BLOCKS.map(function (b) { return b.id; });

  var FORBIDDEN_KEYS = ['script', 'code', 'handler', 'onClick', 'onclick', 'eval', 'function', 'templateUrl', 'import'];
  var FORBIDDEN_TEXT = /<script|javascript:|onerror\s*=|onload\s*=|eval\s*\(|new\s+Function\b|=>|\bfunction\s*\(/i;

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // 递归扫描：岗位包里出现任何看起来像代码的东西，直接拒绝。
  function scanForCode(node, path, errors) {
    if (typeof node === 'string') {
      if (FORBIDDEN_TEXT.test(node)) {
        errors.push('检测到疑似可执行代码：' + path + ' = ' + JSON.stringify(node).slice(0, 90));
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(function (v, i) { scanForCode(v, path + '[' + i + ']', errors); });
      return;
    }
    if (!isPlainObject(node)) return;
    Object.keys(node).forEach(function (k) {
      if (FORBIDDEN_KEYS.indexOf(k.toLowerCase()) !== -1) {
        errors.push('不允许的字段（疑似代码入口）：' + path + '.' + k);
      }
      scanForCode(node[k], path + '.' + k, errors);
    });
  }

  function validatePackage(pkg) {
    return validateConfig(pkg, true);
  }

  function validateAssistantConfig(pkg) {
    return validateConfig(pkg, false);
  }

  function validateConfig(pkg, requireZones) {
    var errors = [], warnings = [];
    if (!isPlainObject(pkg)) return { ok: false, errors: ['岗位包根节点必须是对象'], warnings: warnings };

    scanForCode(pkg, '$', errors);

    ['schemaVersion', 'id', 'name', 'version', 'industry', 'role'].forEach(function (k) {
      if (typeof pkg[k] !== 'string' || !pkg[k].trim()) errors.push('缺少必填字符串字段：' + k);
    });
    if (!requireZones && pkg.id && !/^[A-Za-z0-9_-]+$/.test(pkg.id)) {
      errors.push('id 只能包含字母、数字、下划线和连字符');
    }
    if (pkg.schemaVersion && pkg.schemaVersion !== SCHEMA_VERSION) {
      errors.push('schemaVersion 不匹配：期望 ' + SCHEMA_VERSION + '，实际 ' + pkg.schemaVersion);
    }
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version || '')) errors.push('version 必须是 x.y.z 语义化版本');

    var sourceIds = {}, zoneIds = {};
    (pkg.sources || []).forEach(function (s, i) {
      if (!s.id || !s.label || !s.match) errors.push('sources[' + i + '] 缺少 id/label/match');
      if (sourceIds[s.id]) errors.push('source id 重复：' + s.id);
      sourceIds[s.id] = true;
      if (/^[A-Za-z]:[\\/]|^\//.test(s.match || '')) {
        errors.push('sources[' + i + '].match 不得写绝对路径，只能写相对匹配模式（授权目录由实例配置）');
      }
    });
    if (requireZones && (!Array.isArray(pkg.sources) || !pkg.sources.length)) warnings.push('未声明任何资料来源');

    (pkg.zones || []).forEach(function (z, i) {
      if (!z.id || !z.title || !z.view) errors.push('zones[' + i + '] 缺少 id/title/view');
      if (BLOCK_IDS.indexOf(z.view) === -1) errors.push('zones[' + i + '].view 未知积木：' + z.view + '（可用：' + BLOCK_IDS.join(', ') + '）');
      if (zoneIds[z.id]) errors.push('zone id 重复：' + z.id);
      zoneIds[z.id] = true;
      if (z.sourceId && !sourceIds[z.sourceId]) errors.push('zones[' + i + '].sourceId 指向不存在的来源：' + z.sourceId);
      if (z.view === 'table' || z.view === 'cards' || z.view === 'map25d') {
        if (!Array.isArray(z.fields) || !z.fields.length) errors.push('zones[' + i + '] 使用 ' + z.view + ' 必须声明 fields');
      }
    });
    if (requireZones && (!Array.isArray(pkg.zones) || !pkg.zones.length)) errors.push('至少需要一个数据区（zones）');

    (pkg.dashboard || []).forEach(function (d, i) {
      if (!d.id || !d.label || !d.from || !d.agg) errors.push('dashboard[' + i + '] 缺少 id/label/from/agg');
      if (d.from && !zoneIds[d.from]) errors.push('dashboard[' + i + '].from 指向不存在的数据区：' + d.from);
      if (d.agg && ['count', 'sum', 'avg', 'max', 'min', 'latest'].indexOf(d.agg) === -1) {
        errors.push('dashboard[' + i + '].agg 未知聚合：' + d.agg);
      }
      if (d.agg === 'sum' || d.agg === 'avg') {
        if (!d.field) errors.push('dashboard[' + i + '] 使用 sum/avg 必须声明 field');
      }
    });

    var layoutZoneRefs = [];
    (pkg.layout || []).forEach(function (row, i) {
      if (!Array.isArray(row.cols)) { errors.push('layout[' + i + '] 缺少 cols'); return; }
      row.cols.forEach(function (c) {
        if (!c.zone) errors.push('layout[' + i + '] 存在未指定 zone 的列');
        layoutZoneRefs.push(c.zone);
      });
    });
    layoutZoneRefs.forEach(function (z) {
      if (!zoneIds[z]) errors.push('layout 引用了不存在的数据区：' + z);
    });
    if (requireZones && (!Array.isArray(pkg.layout) || !pkg.layout.length)) warnings.push('未声明 layout，引擎将按 zones 顺序自动排布');

    (pkg.chatContext || []).forEach(function (z) {
      if (!zoneIds[z]) errors.push('chatContext 引用了不存在的数据区：' + z);
    });

    // 规范 08 章：不得编造。岗位包若自带展示数据，必须显式声明为示例。
    if (pkg.samples && pkg.sampleDataIsReal === true) {
      errors.push('岗位包不得夹带真实业务数据；示例数据必须标注 sampleDataIsReal=false');
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  function parseSemver(value) {
    var m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''));
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function semverLess(left, right) {
    for (var i = 0; i < 3; i++) {
      if (left[i] < right[i]) return true;
      if (left[i] > right[i]) return false;
    }
    return false;
  }

  function normalizeEntry(entry) {
    if (typeof entry !== 'string' || !entry.trim()) return { error: 'manifest 缺少工作台入口 entry' };
    if (entry.indexOf('\0') !== -1) return { error: '工作台入口含有非法字符' };
    var norm = entry.replace(/\\/g, '/').trim();
    if (norm.charAt(0) === '/' || /^[A-Za-z]:/.test(norm)) return { error: '工作台入口必须是安装包内的相对路径，不能写绝对路径' };
    var parts = norm.split('/');
    if (parts.some(function (p) { return !p || p === '.' || p === '..'; })) {
      return { error: '工作台入口不允许包含上级目录或空路径' };
    }
    if (parts[0] !== 'workspace') return { error: '工作台入口必须位于 workspace/ 目录内' };
    if (!/\.html?$/i.test(parts[parts.length - 1])) return { error: '工作台入口必须是 HTML 文件' };
    if (norm.length > 180) return { error: '工作台入口路径过长' };
    return { entry: parts.join('/') };
  }

  function validateManifest(manifest, appVersion) {
    var errors = [];
    if (!isPlainObject(manifest)) return { ok: false, errors: ['manifest.json 根节点必须是对象'], entry: '' };
    scanForCode(manifest, 'manifest', errors);
    ['id', 'name', 'version', 'industry', 'role', 'formatVersion', 'minAppVersion', 'entry'].forEach(function (k) {
      if (typeof manifest[k] !== 'string' || !String(manifest[k]).trim()) errors.push('manifest 缺少必填字段：' + k);
    });
    if (manifest.id && !/^[A-Za-z0-9_-]+$/.test(manifest.id)) errors.push('manifest.id 只能包含字母、数字、下划线和连字符');
    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push('manifest.version 必须是 x.y.z 语义化版本');
    if (manifest.formatVersion && manifest.formatVersion !== FORMAT_VERSION) {
      errors.push('不支持的安装包格式版本 ' + manifest.formatVersion + '，当前程序只支持 ' + FORMAT_VERSION);
    }
    var min = parseSemver(manifest.minAppVersion);
    var app = parseSemver(appVersion);
    if (manifest.minAppVersion && !min) errors.push('manifest.minAppVersion 必须是 x.y.z 语义化版本');
    if (min && !app) errors.push('无法识别当前程序版本：' + appVersion);
    if (min && app && semverLess(app, min)) {
      errors.push('当前程序版本 ' + appVersion + ' 低于助手要求的最低版本 ' + manifest.minAppVersion);
    }
    var entry = normalizeEntry(manifest.entry);
    if (entry.error) errors.push(entry.error);
    return { ok: errors.length === 0, errors: errors, entry: entry.entry || '' };
  }

  function validateHtmlBundle(input) {
    var errors = [];
    var warnings = [];
    var source = input || {};
    var manifestResult = validateManifest(source.manifest, source.appVersion);
    var assistantResult = validateAssistantConfig(source.assistant);
    errors = errors.concat(manifestResult.errors).concat(assistantResult.errors);
    warnings = warnings.concat(assistantResult.warnings || []);
    if (manifestResult.ok && assistantResult.ok) {
      if (source.manifest.id !== source.assistant.id) errors.push('manifest.id 与 assistant.json 的 id 不一致');
      if (source.manifest.version !== source.assistant.version) errors.push('manifest.version 与 assistant.json 的 version 不一致');
      if (source.manifest.name !== source.assistant.name) warnings.push('manifest.name 与 assistant.json 的 name 不一致，界面以 assistant.json 为准');
    }
    if (source.assistant && source.assistant.workspaceType && source.assistant.workspaceType !== 'html') {
      errors.push('HTML 助手的 assistant.json 若声明 workspaceType，只能是 html');
    }
    if (manifestResult.entry && typeof source.fileExists === 'function' && !source.fileExists(manifestResult.entry)) {
      errors.push('找不到工作台入口文件：' + manifestResult.entry);
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings, entry: manifestResult.entry };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    FORMAT_VERSION: FORMAT_VERSION,
    BLOCKS: BLOCKS,
    BLOCK_IDS: BLOCK_IDS,
    validatePackage: validatePackage,
    validateAssistantConfig: validateAssistantConfig,
    validateManifest: validateManifest,
    validateHtmlBundle: validateHtmlBundle,
    normalizeEntry: normalizeEntry
  };
});
