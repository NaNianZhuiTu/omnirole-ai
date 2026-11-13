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

  var assistantId = '';

  function render(task) {
    if (!task) return;
    if (assistantId && task.instanceId && task.instanceId !== assistantId) return;
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
    var pending = task.status === 'waiting_confirmation' ? task.pendingAction : null;
    var card = document.getElementById('confirmCard');
    card.hidden = !pending;
    if (pending) {
      text('confirmTitle', pending.title);
      text('confirmTarget', pending.target);
      text('confirmBefore', pending.before);
      text('confirmAfter', pending.after);
    }
    text('report', task.report || (task.error ? '' : '完成后会显示在这里。'));
    var reason = task.programNote || '';
    if ((task.status === 'failed' || task.status === 'cancelled') && task.error && reason.indexOf(task.error) < 0) {
      reason = reason ? reason + task.error : task.error;
    }
    text('note', reason);
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
    var task = await window.desktop.ai.getTaskStatus({ taskId: taskId });
    render(task);
    if (!window.desktop.documents || (task.status !== 'completed' && task.status !== 'failed')) return;
    var listed = await window.desktop.documents.list();
    var box = document.getElementById('diskFiles');
    box.innerHTML = '';
    (listed.documents || []).forEach(function (file) {
      var p = document.createElement('div');
      p.className = 'file';
      p.textContent = '工作文档：' + file.rel;
      box.appendChild(p);
    });
  }

  async function boot() {
    if (!window.desktop) return;
    try {
      var info = await window.desktop.assistant.getInfo();
      assistantId = info && info.id || '';
      var history = await window.desktop.ai.getTaskHistory();
      if (history && history.length) render(history[0]);
    } catch (e) { /* 还没有任务时保持空状态 */ }
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
    try {
      render(await window.desktop.ai.cancelTask({ taskId: taskId }));
      await refresh();
    } catch (e) { text('note', e.message); }
  });
  async function decide(approved) {
    var task = await window.desktop.ai.getTaskStatus({ taskId: taskId });
    if (task.status !== 'waiting_confirmation' || !task.pendingAction) return;
    await window.desktop.ai.confirmAction({ taskId: taskId, actionId: task.pendingAction.id, approved: approved });
    await refresh();
  }
  document.getElementById('approveBtn').addEventListener('click', function () { decide(true); });
  document.getElementById('rejectBtn').addEventListener('click', function () { decide(false); });
  if (window.desktop && window.desktop.ai.onProgress) window.desktop.ai.onProgress(render);
  boot();
})();
