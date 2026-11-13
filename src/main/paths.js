'use strict';
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// 打包后 packages/catalog/samples 在 resources 下；开发时在工程根。
function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

const RES = resourcesRoot();
const USER = app.getPath('userData');
const LIBRARY = path.join(USER, 'library');
const INSTANCES = path.join(LIBRARY, 'instances');
const IMPORTED = path.join(LIBRARY, 'packages');

const PATHS = {
  resources: RES,
  packages: path.join(RES, 'packages'),
  catalog: path.join(RES, 'catalog', 'catalog.json'),
  samples: path.join(RES, 'samples'),
  userData: USER,
  library: LIBRARY,
  instances: INSTANCES,
  imported: IMPORTED,
  registry: path.join(LIBRARY, 'registry.json'),
  settings: path.join(USER, 'settings.json')
};

function ensure() {
  [LIBRARY, INSTANCES, IMPORTED].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function instanceDir(id) { return path.join(INSTANCES, id); }
function instanceFile(id, name) { return path.join(INSTANCES, id, name); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { PATHS, ensure, instanceDir, instanceFile, readJson, writeJson, resourcesRoot };
