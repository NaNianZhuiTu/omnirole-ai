/* 资料索引器：把授权目录里的散乱文件，抽成一份带「来源/版本/条款位置」的本地索引。
 * 重要：这一步是确定性代码，不调用模型，断网也能跑；模型只用于理解资料和生成内容。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const R = require('./file-reader');
const { instanceFile, instanceDir, writeJson, readJson } = require('./paths');
const trace = require('./trace');

function normalize(s) {
  return String(s || '').replace(/[\s（）()]/g, '').toLowerCase();
}

function coerce(v, type) {
  if (v == null) return '';
  const s = String(v).trim();
  if (type === 'number') {
    const n = Number(s.replace(/[,，]/g, ''));
    return Number.isFinite(n) ? n : s;
  }
  return s;
}

function yearFrom(rel, pattern) {
  try { const m = new RegExp(pattern || '20[0-9]{2}').exec(rel); if (m) return m[0]; }
  catch (e) { /* 正则非法时退回文件名匹配 */ }
  const m = /20[0-9]{2}/.exec(rel);
  return m ? m[0] : '';
}

function clausesFrom(text) {
  const found = (String(text).match(/第\s?[0-9一二三四五六七八九十.]+\s?条/g) || []);
  return Array.from(new Set(found)).slice(0, 12);
}

function metaFor(file, rel) {
  let meta = {};
  try { meta = R.fileMeta(file); } catch (e) { meta = {}; }
  return { file: path.basename(file), rel, path: file, ...meta };
}

function mapRows(rows, fields, headerRow, src) {
  const hIdx = Math.max(0, (headerRow || 1) - 1);
  const headers = rows[hIdx] || [];
  const positions = {};
  (fields || []).forEach((f, i) => {
    let idx = headers.findIndex(h => normalize(h) === normalize(f.label) || normalize(h) === normalize(f.key));
    if (idx < 0) idx = i;
    positions[f.key] = idx;
  });
  return rows.slice(hIdx + 1).map((r, i) => {
    const obj = {};
    (fields || []).forEach(f => { obj[f.key] = coerce(r[positions[f.key]], f.type); });
    obj.__source = { ...src, locator: '第 ' + (hIdx + 2 + i) + ' 行', excerpt: R.excerpt(r.join(' | '), 180) };
    return obj;
  });
}

function buildDocuments(files, extract, sourceLabel) {
  return files.map(f => {
    let text = '';
    try { text = R.readText(f.abs); }
    catch (e) { text = ''; }
    const meta = metaFor(f.abs, f.rel);
    return {
      title: path.basename(f.rel, path.extname(f.rel)),
      year: yearFrom(f.rel, extract && extract.yearPattern),
      updatedAt: meta.mtime || '',
      clause: clausesFrom(text).join('、'),
      excerpt: R.excerpt(text, 180),
      text: String(text).slice(0, 12000),
      sourceLabel,
      __source: { ...meta, locator: clausesFrom(text)[0] || '全文', excerpt: R.excerpt(text, 180) }
    };
  });
}

function findSourceFiles(pkg, source, authorizedPaths) {
  const seen = new Set(); const out = [];
  (authorizedPaths || []).forEach(root => {
    R.listFiles(root, source.match, 200).forEach(f => {
      if (!seen.has(f.abs)) { seen.add(f.abs); out.push(f); }
    });
  });
  return out;
}

/**
 * 扫描并落盘索引。
 * @param {object} instance { id, packageId, name, authorizedPaths }
 * @param {object} pkg 岗位包（纯数据）
 */
function reindex(instance, pkg) {
  const issues = [];
  const zones = {};
  const allFiles = [];
  const sourceFiles = {};
  const authorized = instance.authorizedPaths || [];

  if (!authorized.length) {
    issues.push({ level: 'warn', text: '尚未授权任何本机资料目录，工作台暂无数据。可在「本地资料」页添加。' });
  }

  (pkg.sources || []).forEach(source => {
    let files = [];
    try { files = findSourceFiles(pkg, source, authorized); }
    catch (e) { issues.push({ level: 'error', text: '扫描「' + source.label + '」失败：' + e.message }); }
    sourceFiles[source.id] = files;
    files.forEach(f => allFiles.push({ ...f, sourceId: source.id, sourceLabel: source.label }));
    if (!files.length && source.required) {
      issues.push({ level: 'warn', text: '未找到必需资料：' + source.label + '（匹配 ' + source.match + '）' });
    }
  });

  (pkg.zones || []).forEach(zone => {
    const files = sourceFiles[zone.sourceId] || [];
    const extract = zone.extract || { type: 'table', headerRow: 1 };
    let rows = [];
    try {
      if (extract.type === 'points') {
        if (files[0]) {
          const points = R.readPoints(files[0].abs, extract.jsonPath);
          const src = metaFor(files[0].abs, files[0].rel);
          rows = points.map(p => ({ ...p, __source: { ...src, locator: '点位 ' + (p.name || ''), excerpt: R.excerpt(JSON.stringify(p), 180) } }));
        }
      } else if (extract.type === 'documents' || zone.view === 'documentList' || zone.view === 'timeline') {
        rows = buildDocuments(files, extract, (pkg.sources.find(s => s.id === zone.sourceId) || {}).label || '');
        if (extract.groupBy === 'year') rows.sort((a, b) => String(b.year).localeCompare(String(a.year)) || String(b.title).localeCompare(String(a.title)));
      } else if (extract.type === 'records' || extract.type === 'table') {
        if (files[0]) {
          const table = R.readTable(files[0].abs);
          const src = metaFor(files[0].abs, files[0].rel);
          rows = mapRows(table.rows, zone.fields, extract.headerRow || 1, src);
        }
      }
    } catch (e) {
      issues.push({ level: 'error', text: '解析「' + zone.title + '」失败：' + e.message });
    }
    if (!rows.length) {
      issues.push({ level: 'info', text: '「' + zone.title + '」暂无数据（未找到匹配文件或文件为空），页面按「未找到」显示。' });
    }
    zones[zone.id] = {
      id: zone.id,
      title: zone.title,
      view: zone.view,
      fields: zone.fields || [],
      rows,
      sourceFiles: files.map(f => ({ rel: f.rel, abs: f.abs })),
      rowCount: rows.length
    };
  });

  const index = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    instanceId: instance.id,
    packageId: pkg.id,
    packageVersion: pkg.version,
    // 来源清单是可追溯性的锚点：每条数据都能落回某个具体文件
    files: allFiles.map(f => ({ ...f, ...metaFor(f.abs, f.rel) })),
    zones,
    issues,
    summary: {
      fileCount: allFiles.length,
      zoneCount: Object.keys(zones).length,
      rowCount: Object.values(zones).reduce((n, z) => n + z.rowCount, 0),
      lastIndexed: new Date().toISOString(),
      authorizedPathCount: authorized.length
    }
  };

  const dir = instanceDir(instance.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJson(instanceFile(instance.id, 'index.json'), index);
  writeJson(path.join(instanceDir(instance.id), 'index', 'index.json'), index);
  trace.append(instance.id, 'reindex', {
    packageId: pkg.id, fileCount: allFiles.length,
    rowCount: index.summary.rowCount, issueCount: issues.length
  });
  return index;
}

function loadIndex(instanceId) {
  return readJson(instanceFile(instanceId, 'index.json'), null);
}

module.exports = { reindex, loadIndex };
