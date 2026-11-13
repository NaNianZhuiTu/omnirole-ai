/* 底座适配层：上层只认这四个接口。
 *
 *   readFiles({ roots, patterns })  读本机授权目录内的文件
 *   runTask({ type, payload })      跑一个本机任务（索引、定时批任务…）
 *   chat({ ... })                   调模型对话（BYOK）
 *   trace(event)                    写只增不改的轨迹
 *
 * 换底座只换 impl，程序主体不动。默认挂 local-runtime（自写薄底座）。
 */
'use strict';

class RuntimeAdapter {
  constructor(impl) {
    if (!impl) throw new Error('缺少底座实现');
    this.impl = impl;
    this.name = impl.name || 'unknown';
  }
  readFiles(args) { return this.impl.readFiles(args); }
  runTask(args) { return this.impl.runTask(args); }
  chat(args) { return this.impl.chat(args); }
  trace(args) { return this.impl.trace(args); }
  status() {
    return { name: this.name, label: this.impl.label || this.name, ...(this.impl.status ? this.impl.status() : {}) };
  }
}

module.exports = { RuntimeAdapter };
