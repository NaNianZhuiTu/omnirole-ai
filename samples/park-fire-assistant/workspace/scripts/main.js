(function () {
  var taskId = '';
  var timer = null;
  var statusText = document.getElementById('statusText');
  var labels = {
    created: '已接收',
    planning: '正在理解任务',
    running: '正在执行',
    waiting_confirmation: '等待确认',
    completed: '已完成',
    failed: '未完成',
    cancelled: '已取消'
  };

  function text(id, value) { document.getElementById(id).textContent = value || ''; }

  function render(task) {
    if (!task) return;
    taskId = task.id;
    statusText.textContent = labels[task.status] || task.status;
    document.getElementById('cancelBtn').hidden = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
    var list = document.getElementById('activity');
    list.innerHTML = '';
    (task.activity || []).forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = item.text;
      list.appendChild(li);
    });
    var pending = task.pendingAction;
    var card = document.getElementById('confirmCard');
    card.hidden = task.status !== 'waiting_confirmation' || !pending;
    if (pending) {
      text('confirmTitle', pending.title);
      text('confirmTarget', pending.target);
      text('confirmBefore', pending.before);
      text('confirmAfter', pending.after);
    }
    text('report', task.report || (task.status === 'failed' ? task.error : '完成后会显示在这里。'));
    text('note', task.programNote || (task.status === 'failed' ? task.error : ''));
    var files = document.getElementById('files');
    files.innerHTML = '';
    (task.savedDocuments || []).forEach(function (file) {
      var p = document.createElement('div');
      p.className = 'file';
      p.textContent = '已保存：' + (file.rel || file.name || '');
      files.appendChild(p);
    });
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') stop();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function refresh() {
    if (!taskId || !window.desktop) return;
    render(await window.desktop.ai.getTaskStatus({ taskId: taskId }));
  }

  document.getElementById('runBtn').addEventListener('click', async function () {
    var task = document.getElementById('taskInput').value.trim();
    if (!task || !window.desktop) return;
    stop();
    var started = await window.desktop.ai.execute({ task: task });
    taskId = started.taskId;
    await refresh();
    timer = setInterval(function () { refresh().catch(function (error) { text('note', error.message); }); }, 600);
  });
  document.getElementById('cancelBtn').addEventListener('click', async function () {
    if (!taskId) return;
    render(await window.desktop.ai.cancelTask({ taskId: taskId }));
  });
  async function decide(approved) {
    var task = await window.desktop.ai.getTaskStatus({ taskId: taskId });
    if (!task.pendingAction) return;
    await window.desktop.ai.confirmAction({ taskId: taskId, actionId: task.pendingAction.id, approved: approved });
  }
  document.getElementById('approveBtn').addEventListener('click', function () { decide(true); });
  document.getElementById('rejectBtn').addEventListener('click', function () { decide(false); });
  if (window.desktop && window.desktop.ai.onProgress) window.desktop.ai.onProgress(render);
})();
