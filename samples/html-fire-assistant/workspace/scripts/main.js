(function () {
  document.body.setAttribute('data-js', 'ok');
  var status = document.getElementById('status');
  if (status) status.textContent = '脚本已运行';
})();
