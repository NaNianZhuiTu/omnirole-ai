/* 界面转义。旧的指标卡、表格、时间线渲染已经去掉。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  PA.blocks = { esc: esc };
})(window);
