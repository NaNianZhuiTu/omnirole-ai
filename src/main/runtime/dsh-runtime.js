/* DeepSeek Harness 底座适配（占位，默认不启用）
 *
 * 2026-11-12 实测与调研结论，作为「为什么不直接拉下来改造」的依据留存：
 *
 *  1) @deepseek-ai/dsh 最新 0.2.2-rc.1，engines.node >= 24.9.0。
 *     本机系统 Node 22.22.2 不满足；本程序 Electron 45 内置 Node 24.22.2 虽满足，
 *     但 npm 直装 dsh 的探测在 4 分钟内无产物（依赖 100+ 个包），
 *     把 rc 版塞进安装包也等于冻结一个仍在变化的 API。
 *  2) README 明确 "The tree composes over an empty root" —— 底座本身就是
 *     插件组合器，不存在「剥掉插件层只留底座」的形态；fork 第一刀就得砍骨架。
 *  3) `dsh --profile sdk-minimal` 是 standalone *coding agent*：只给模型
 *     bash/pwsh + str_replace_editor 两个工具，系统提示为软件工程师助手，
 *     且是 danger-full-access（进程可及路径全可写）。与「面向不懂技术的岗位
 *     人员、按助手隔离资料目录」的安全边界直接冲突。
 *  4) 该 profile 仍是 complete Cordis tree，单一 DeepSeek adapter，
 *     与 BYOK / 模型无关的目标冲突；rc 版接口仍在变。
 *
 * 结论：本版不引入 dsh 的任何运行时与插件机制，只借鉴其设计思路
 *      （本地文件 provider、会话、只增不改的轨迹、profile 式可替换底座）。
 *
 * 未来若上游满足以下条件，可实现本文件并切换 impl，上层无需改动：
 *  - 提供可独立引用的稳定核心包（非 rc）、宿主 Node 版本匹配；
 *  - 提供「只读 + 目录白名单」的沙箱 profile，而非 danger-full-access；
 *  - 提供模型无关适配与 BYOK，且不需要引入插件市场/第三方插件。
 */
'use strict';

const NOT_AVAILABLE = 'dsh 底座未启用：当前版本不满足运行条件，详见本文件顶部调研结论。';

const DshRuntime = {
  name: 'dsh',
  label: 'DeepSeek Harness（未启用）',
  status() { return { available: false, reason: NOT_AVAILABLE }; },
  readFiles() { return Promise.reject(new Error(NOT_AVAILABLE)); },
  runTask() { return Promise.reject(new Error(NOT_AVAILABLE)); },
  chat() { return Promise.reject(new Error(NOT_AVAILABLE)); },
  trace() { return { ok: false, reason: NOT_AVAILABLE }; }
};

module.exports = DshRuntime;
