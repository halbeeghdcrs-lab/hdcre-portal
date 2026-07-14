/* Version 4.1 */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz11Ck85u2lDwj8F-gAGaf4bW6q5o-1ZDmZWm8qE4_9v-tGF8StT6nV7gAuAafzcing/exec';
let currentBlocks = [];
let currentTasks = {};
let currentLaborTypes = [];
let blockOptionsHTML = '';
let editingReportId = null;
let draftTimer = null;
let allReports = [];

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
  const u = sessionStorage.getItem('hdcre_user');
  if (u) showMainApp(u); else {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
  }
  document.getElementById('loginBtn').addEventListener('click', attemptLogin);
  document.getElementById('logoutLink').addEventListener('click', logout);
  document.getElementById('siteSelect').addEventListener('change', onSiteChange);
  document.getElementById('addTaskRow').addEventListener('click', addGenericRow);
  document.querySelectorAll('.add-row-btn').forEach(btn => {
    btn.addEventListener('click', () => addDynamicRow(btn.dataset.target));
  });
  document.getElementById('dailyForm').addEventListener('submit', handleSubmit);
  document.getElementById('reportDate').valueAsDate = new Date();
  document.getElementById('photos').addEventListener('change', onPhotosSelected);

  ['issuesTable', 'testsTable', 'correspondencesTable', 'safetyTable',
    'stakeholderTable', 'siteOrdersTable', 'equipmentTable',
    'matDeliveredTable', 'matOnSiteTable'].forEach(id => addDynamicRow(id));

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Draft auto-save every 30 seconds
  draftTimer = setInterval(saveDraft, 30000);

  // Save draft on any form input
  document.getElementById('dailyForm').addEventListener('input', saveDraft);

  // Modal close button
  document.getElementById('closeViewBtn').addEventListener('click', closeReportView);

  // Cancel edit button
  document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
});

// ========== LOGIN ==========

function attemptLogin() {
  const name = document.getElementById('loginName').value.trim();
  const pw = document.getElementById('loginPassword').value.trim();
  const err = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  err.textContent = '';
  err.style.color = '#e74c3c';
  if (!name || !pw) { err.textContent = 'Please enter both Name and Password.'; return; }

  btn.disabled = true;
  btn.textContent = 'Checking...';

  const url = API_BASE + '?action=login&name=' + encodeURIComponent(name) + '&password=' + encodeURIComponent(pw);

  fetch(url)
    .then(r => {
      if (!r.ok) throw new Error('Server returned ' + r.status);
      return r.json();
    })
    .then(d => {
      if (d.success && d.role === 'RE') {
        sessionStorage.setItem('hdcre_user', name);
        sessionStorage.setItem('hdcre_role', d.role);
        showMainApp(name);
      } else if (d.success && d.role) {
        err.textContent = 'Access denied. Your role is: ' + d.role + '. This portal is for Resident Engineers only.';
      } else if (d.success) {
        err.textContent = 'Login OK but no role assigned. Ask admin to set your Role.';
      } else {
        err.textContent = 'Invalid name or password.';
      }
    })
    .catch(e => {
      if (e.message.includes('Failed to fetch')) {
        err.textContent = 'Network error. Check API_BASE URL.';
      } else {
        err.textContent = 'Error: ' + e.message;
      }
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Login';
    });
}

function showMainApp(name) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  document.getElementById('loggedUser').textContent = name;
  document.getElementById('reName').value = name;
  loadSites();
}

function logout() { sessionStorage.removeItem('hdcre_user'); sessionStorage.removeItem('hdcre_role'); location.reload(); }

// ========== TAB SWITCHING ==========

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
  document.getElementById('tabNewReport').classList.toggle('hidden', tabName !== 'new');
  document.getElementById('tabMyReports').classList.toggle('hidden', tabName !== 'myreports');
  if (tabName === 'myreports') loadMyReports();
}

// ========== DATA LOADING ==========

async function loadSites() {
  try {
    const res = await fetch(API_BASE + '?endpoint=sites');
    const sites = await res.json();
    const sel = document.getElementById('siteSelect');
    sel.innerHTML = '<option value="">-- Select --</option>';
    sites.forEach(s => {
      const o = document.createElement('option');
      o.value = s.name;
      o.textContent = s.name;
      sel.appendChild(o);
    });
  } catch (e) { console.error(e); }
}

async function onSiteChange() {
  const site = document.getElementById('siteSelect').value;
  if (!site) return;
  try {
    const bRes = await fetch(API_BASE + '?endpoint=blocks&site=' + encodeURIComponent(site));
    currentBlocks = await bRes.json();
    renderBlockStatus();

    blockOptionsHTML = currentBlocks.map(b =>
      '<option value="' + b.blockId + '">' + b.blockId + ' - ' + b.blockName + '</option>'
    ).join('');

    const tRes = await fetch(API_BASE + '?endpoint=tasks&site=' + encodeURIComponent(site));
    currentTasks = await tRes.json();
    renderWorkProgress();

    const lRes = await fetch(API_BASE + '?endpoint=laborTypes&site=' + encodeURIComponent(site));
    currentLaborTypes = await lRes.json();
    renderWorkforce();

    // Check for draft
    checkForDraft(site);
  } catch (e) { console.error(e); }
}

// ========== BLOCK STATUS ==========

function renderBlockStatus() {
  const c = document.getElementById('blockStatusContainer');
  if (currentBlocks.length === 0) {
    c.innerHTML = '<p class="hint">No blocks configured for this site.</p>';
    return;
  }
  let html = '<div class="block-status-grid">';
  currentBlocks.forEach(b => {
    html += '<div class="block-status-item">' +
      '<div class="block-label">' + b.blockId + ' - ' + b.blockName + '</div>' +
      '<label>Status <select class="bs-status" data-block="' + b.blockId + '">' +
      '<option>Not Active</option><option>On Progress</option><option>Delayed</option><option>On Track</option><option>Completed</option>' +
      '</select></label></div>';
  });
  html += '</div>';
  c.innerHTML = html;
  renderPerformance();
}

// ========== WORK PROGRESS ==========

function renderWorkProgress() {
  const c = document.getElementById('workProgressContainer');
  if (currentBlocks.length === 0) {
    c.innerHTML = '<p class="hint">No blocks configured.</p>';
    return;
  }
  let html = '<table id="taskTable"><thead><tr><th>#</th><th>Block</th><th>Task</th><th>Unit</th><th>Planned</th><th>Executed</th><th>Remarks</th></tr></thead><tbody>';
  let counter = 0;
  currentBlocks.forEach((b) => {
    const blockTasks = currentTasks[b.blockId] || [];
    if (blockTasks.length > 0) {
      blockTasks.forEach(t => {
        counter++;
        html += '<tr data-block="' + b.blockId + '">' +
          '<td>' + counter + '</td>' +
          '<td><select class="task-block" disabled><option value="' + b.blockId + '" selected>' + b.blockId + '</option></select></td>' +
          '<td><select class="task-name"><option value="' + t.name + '" selected>' + t.name + '</option></select></td>' +
          '<td><input type="text" class="task-unit" value="' + (t.unit || '') + '" readonly style="width:60px"></td>' +
          '<td><input type="number" class="task-planned" step="any" value="' + (t.dailyPlannedQty || '') + '" style="width:70px"></td>' +
          '<td><input type="number" class="task-executed" step="any" style="width:70px"></td>' +
          '<td><input type="text" class="task-remark" style="width:100px"></td></tr>';
      });
    } else {
      counter++;
      html += '<tr data-block="' + b.blockId + '">' +
        '<td>' + counter + '</td>' +
        '<td><select class="task-block">' + blockOptionsHTML + '</select></td>' +
        '<td><input type="text" class="task-name-text" placeholder="Task description"></td>' +
        '<td><input type="text" class="task-unit" placeholder="m3" style="width:60px"></td>' +
        '<td><input type="number" class="task-planned" step="any" style="width:70px"></td>' +
        '<td><input type="number" class="task-executed" step="any" style="width:70px"></td>' +
        '<td><input type="text" class="task-remark" style="width:100px"></td></tr>';
    }
  });
  html += '</tbody></table>';
  c.innerHTML = html;
}

function addGenericRow() {
  const tbody = document.querySelector('#taskTable tbody');
  if (!tbody) return;
  const count = tbody.rows.length + 1;
  const row = tbody.insertRow();
  row.innerHTML = '<td>' + count + '</td>' +
    '<td><select class="task-block">' + blockOptionsHTML + '</select></td>' +
    '<td><input type="text" class="task-name-text" placeholder="Task description"></td>' +
    '<td><input type="text" class="task-unit" placeholder="m3" style="width:60px"></td>' +
    '<td><input type="number" class="task-planned" step="any" style="width:70px"></td>' +
    '<td><input type="number" class="task-executed" step="any" style="width:70px"></td>' +
    '<td><input type="text" class="task-remark" style="width:100px"></td>';
}

// ========== WORKFORCE ==========

function renderWorkforce() {
  const tbody = document.querySelector('#workforceTable tbody');
  tbody.innerHTML = '';
  currentLaborTypes.forEach(lt => {
    tbody.innerHTML += '<tr>' +
      '<td>' + lt + '</td>' +
      '<td><input type="number" class="wf-planned" value="0" min="0"></td>' +
      '<td><input type="number" class="wf-available" value="0" min="0"></td>' +
      '<td><input type="text" class="wf-comments" placeholder="e.g. Block A & B"></td></tr>';
  });
  document.querySelectorAll('.wf-planned, .wf-available').forEach(inp => {
    inp.addEventListener('input', updateWorkforceTotals);
  });
}

function updateWorkforceTotals() {
  let p = 0, a = 0;
  document.querySelectorAll('.wf-planned').forEach(i => { p += parseInt(i.value) || 0; });
  document.querySelectorAll('.wf-available').forEach(i => { a += parseInt(i.value) || 0; });
  document.getElementById('wfPlannedTotal').textContent = p;
  document.getElementById('wfAvailTotal').textContent = a;
}

// ========== PERFORMANCE ==========

function renderPerformance() {
  const c = document.getElementById('performanceContainer');
  if (currentBlocks.length === 0) return;
  let html = '<table id="perfTable"><thead><tr><th>Block</th><th>Daily Target Achievement</th><th>Status</th></tr></thead><tbody>';
  currentBlocks.forEach(b => {
    html += '<tr><td>' + b.blockId + ' - ' + b.blockName + '</td>' +
      '<td><input type="text" class="perf-achievement" data-block="' + b.blockId + '" placeholder="e.g. 80%"></td>' +
      '<td><select class="perf-status" data-block="' + b.blockId + '">' +
      '<option>On Track</option><option>Delayed</option><option>Needs Schedule Update</option><option>Completed</option>' +
      '</select></td></tr>';
  });
  html += '</tbody></table>';
  c.innerHTML = html;
}

// ========== DYNAMIC ROW ADDER ==========

function addDynamicRow(tableId) {
  const tbody = document.querySelector('#' + tableId + ' tbody');
  if (!tbody) return;
  const row = tbody.insertRow();
  switch (tableId) {
    case 'equipmentTable':
      row.innerHTML = '<td><input type="text" placeholder="e.g. Mixer"></td>' +
        '<td><input type="number" value="1" min="0"></td>' +
        '<td><select><option>Good</option><option>Fair</option><option>Broken</option><option>Under Repair</option></select></td>' +
        '<td><input type="text" placeholder="e.g. Block A"></td>';
      break;
    case 'matDeliveredTable': case 'matOnSiteTable':
      row.innerHTML = '<td><input type="text" placeholder="Description"></td>' +
        '<td><input type="text" placeholder="m3" style="width:50px"></td>' +
        '<td><input type="number" step="any"></td>' +
        '<td><select>' + blockOptionsHTML + '</select></td>';
      break;
    case 'issuesTable':
      row.innerHTML = '<td><select>' + blockOptionsHTML + '</select></td>' +
        '<td><textarea rows="1" placeholder="Describe the issue..."></textarea></td>';
      break;
    case 'testsTable':
      row.innerHTML = '<td><input type="text" placeholder="Test name"></td>' +
        '<td><select>' + blockOptionsHTML + '</select></td>' +
        '<td><input type="text" placeholder="Result"></td>';
      break;
    case 'correspondencesTable':
      row.innerHTML = '<td><input type="date"></td>' +
        '<td><input type="text" placeholder="From"></td>' +
        '<td><input type="text" placeholder="To"></td>' +
        '<td><input type="text" placeholder="Subject"></td>';
      break;
    case 'safetyTable':
      row.innerHTML = '<td><input type="text" placeholder="Safety issue"></td>' +
        '<td><select>' + blockOptionsHTML + '</select></td>' +
        '<td><input type="text" placeholder="Action taken"></td>';
      break;
    case 'stakeholderTable':
      row.innerHTML = '<td><input type="text" placeholder="Stakeholder"></td>' +
        '<td><input type="text" placeholder="Contribution"></td>';
      break;
    case 'siteOrdersTable':
      row.innerHTML = '<td><input type="text" placeholder="Order No."></td>' +
        '<td><input type="text" placeholder="Issued To"></td>' +
        '<td><textarea rows="1" placeholder="Instruction"></textarea></td>' +
        '<td><input type="date"></td>';
      break;
  }
}

// ========== PHOTOS ==========

function onPhotosSelected(e) {
  const files = e.target.files;
  const preview = document.getElementById('photoPreview');
  const metaContainer = document.getElementById('photoMetaContainer');
  preview.innerHTML = '';
  metaContainer.innerHTML = '';

  Array.from(files).forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = document.createElement('img');
      img.src = ev.target.result;
      img.alt = file.name;
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'photo-meta-item';
    metaDiv.innerHTML = '<img src="" alt="preview" data-photo-idx="' + idx + '">' +
      '<div class="meta-fields">' +
      '<label>Block <select class="photo-block">' + (blockOptionsHTML || '<option value="">No blocks loaded</option>') + '</select></label>' +
      '<label>Caption <input type="text" class="photo-caption" placeholder="Describe this photo..."></label>' +
      '</div>';
    metaContainer.appendChild(metaDiv);

    const thumbReader = new FileReader();
    thumbReader.onload = ev => {
      metaDiv.querySelector('img[data-photo-idx="' + idx + '"]').src = ev.target.result;
    };
    thumbReader.readAsDataURL(file);
  });
}

// ========== COLLECT DATA ==========

function collectBlockStatuses() {
  return Array.from(document.querySelectorAll('.bs-status')).map(sel => ({
    blockId: sel.dataset.block,
    status: sel.value
  }));
}

function collectTasks() {
  const rows = document.querySelectorAll('#taskTable tbody tr');
  const tasks = [];
  rows.forEach(row => {
    const blockSel = row.querySelector('.task-block');
    const taskSel = row.querySelector('.task-name');
    const taskInput = row.querySelector('.task-name-text');
    const name = taskSel ? taskSel.value : (taskInput ? taskInput.value : '');
    const exec = row.querySelector('.task-executed');
    if (name && exec && exec.value) {
      tasks.push({
        blockId: blockSel ? blockSel.value : '',
        name,
        unit: row.querySelector('.task-unit') ? row.querySelector('.task-unit').value : '',
        plannedQty: parseFloat(row.querySelector('.task-planned')?.value) || 0,
        executedQty: parseFloat(exec.value) || 0,
        remark: row.querySelector('.task-remark') ? row.querySelector('.task-remark').value : ''
      });
    }
  });
  return tasks;
}

function collectTableData(tableId, fields) {
  const rows = document.querySelectorAll('#' + tableId + ' tbody tr');
  const data = [];
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    const obj = {};
    fields.forEach((f, i) => {
      const inp = cells[i]?.querySelector('input, select, textarea');
      obj[f] = inp ? inp.value : '';
    });
    if (Object.values(obj).some(v => v !== '' && v !== '0')) data.push(obj);
  });
  return data;
}

function collectPerformance() {
  const rows = document.querySelectorAll('#perfTable tbody tr');
  return Array.from(rows).map(row => ({
    block: row.querySelector('.perf-achievement')?.dataset.block || '',
    targetAchievement: row.querySelector('.perf-achievement')?.value || '',
    status: row.querySelector('.perf-status')?.value || ''
  }));
}

function collectPhotosWithMeta() {
  const files = document.getElementById('photos').files;
  const metaItems = document.querySelectorAll('.photo-meta-item');
  return Promise.all(Array.from(files).map((file, idx) => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const metaItem = metaItems[idx];
      resolve({
        name: file.name,
        data: e.target.result,
        block: metaItem ? metaItem.querySelector('.photo-block')?.value || '' : '',
        caption: metaItem ? metaItem.querySelector('.photo-caption')?.value || '' : ''
      });
    };
    reader.readAsDataURL(file);
  })));
}

// ========== DRAFT SAVE / LOAD ==========

function saveDraft() {
  const site = document.getElementById('siteSelect').value;
  if (!site) return;
  // Don't save if in edit mode
  if (editingReportId) return;

  const draftData = {
    site: site,
    reportDate: document.getElementById('reportDate').value,
    weatherAM: document.getElementById('weatherAM').value,
    weatherPM: document.getElementById('weatherPM').value,
    activitySummary: document.getElementById('activitySummary').value,
    blockStatuses: collectBlockStatuses(),
    tasks: collectTasks(),
    workforce: collectTableData('workforceTable', ['laborType', 'planned', 'available', 'comments']),
    equipment: collectTableData('equipmentTable', ['type', 'qty', 'condition', 'comments']),
    materialsDelivered: collectTableData('matDeliveredTable', ['desc', 'unit', 'qty', 'allocatedBlock']),
    materialsOnSite: collectTableData('matOnSiteTable', ['desc', 'unit', 'qty', 'allocatedBlock']),
    issues: collectTableData('issuesTable', ['block', 'details']),
    tests: collectTableData('testsTable', ['testName', 'block', 'result']),
    correspondences: collectTableData('correspondencesTable', ['date', 'from', 'to', 'subject']),
    safetyIssues: collectTableData('safetyTable', ['issue', 'block', 'actionTaken']),
    stakeholderContribution: collectTableData('stakeholderTable', ['stakeholder', 'contribution']),
    resourceEfficiency: document.getElementById('resourceEfficiency').value,
    recommendations: document.getElementById('recommendations').value,
    performance: collectPerformance(),
    siteOrders: collectTableData('siteOrdersTable', ['orderNo', 'issuedTo', 'instruction', 'deadline']),
    holdPointRequests: document.getElementById('holdPointRequests').value,
    timestamp: new Date().toISOString()
  };

  try {
    localStorage.setItem('hdcre_draft_' + site, JSON.stringify(draftData));
  } catch (e) { console.warn('Draft save failed:', e); }
}

function checkForDraft(site) {
  if (editingReportId) return;
  try {
    const raw = localStorage.getItem('hdcre_draft_' + site);
    if (!raw) return;
    const draft = JSON.parse(raw);
    const banner = document.getElementById('draftBanner');
    const timeStr = draft.timestamp ? new Date(draft.timestamp).toLocaleString() : '';
    banner.innerHTML = '<strong>Draft found</strong> (saved ' + timeStr + ') - ' +
      '<a href="#" id="restoreDraftBtn" style="color:#00695C;font-weight:700">Restore Draft</a> | ' +
      '<a href="#" id="dismissDraftBtn" style="color:#C44536">Dismiss</a>';
    banner.classList.remove('hidden');

    document.getElementById('restoreDraftBtn').addEventListener('click', (e) => {
      e.preventDefault();
      restoreDraft(site);
    });
    document.getElementById('dismissDraftBtn').addEventListener('click', (e) => {
      e.preventDefault();
      clearDraft(site);
      banner.classList.add('hidden');
    });
  } catch (e) {}
}

function restoreDraft(site) {
  try {
    const raw = localStorage.getItem('hdcre_draft_' + site);
    if (!raw) return;
    const d = JSON.parse(raw);

    document.getElementById('siteSelect').value = d.site || '';
    document.getElementById('reportDate').value = d.reportDate || '';
    document.getElementById('weatherAM').value = d.weatherAM || '';
    document.getElementById('weatherPM').value = d.weatherPM || '';
    document.getElementById('activitySummary').value = d.activitySummary || '';
    document.getElementById('resourceEfficiency').value = d.resourceEfficiency || '';
    document.getElementById('recommendations').value = d.recommendations || '';
    document.getElementById('holdPointRequests').value = d.holdPointRequests || '';

    // Restore block statuses
    if (d.blockStatuses && currentBlocks.length > 0) {
      document.querySelectorAll('.bs-status').forEach(sel => {
        const match = d.blockStatuses.find(b => b.blockId === sel.dataset.block);
        if (match) sel.value = match.status;
      });
    }

    // Restore tasks - clear and re-add
    if (d.tasks && d.tasks.length > 0) {
      const tbody = document.querySelector('#taskTable tbody');
      if (tbody) {
        tbody.innerHTML = '';
        d.tasks.forEach((t, idx) => {
          const row = tbody.insertRow();
          row.innerHTML = '<td>' + (idx + 1) + '</td>' +
            '<td><select class="task-block">' + blockOptionsHTML + '</select></td>' +
            '<td><input type="text" class="task-name-text" value="' + (t.name || '') + '"></td>' +
            '<td><input type="text" class="task-unit" value="' + (t.unit || '') + '" style="width:60px"></td>' +
            '<td><input type="number" class="task-planned" step="any" value="' + (t.plannedQty || 0) + '" style="width:70px"></td>' +
            '<td><input type="number" class="task-executed" step="any" value="' + (t.executedQty || 0) + '" style="width:70px"></td>' +
            '<td><input type="text" class="task-remark" value="' + (t.remark || '') + '" style="width:100px"></td>';
          if (t.blockId) {
            const sel = row.querySelector('.task-block');
            if (sel) sel.value = t.blockId;
          }
        });
      }
    }

    // Restore simple tables
    restoreTableData('workforceTable', d.workforce, ['laborType', 'planned', 'available', 'comments']);
    restoreTableData('equipmentTable', d.equipment, ['type', 'qty', 'condition', 'comments']);
    restoreTableData('matDeliveredTable', d.materialsDelivered, ['desc', 'unit', 'qty', 'allocatedBlock']);
    restoreTableData('matOnSiteTable', d.materialsOnSite, ['desc', 'unit', 'qty', 'allocatedBlock']);
    restoreTableData('issuesTable', d.issues, ['block', 'details']);
    restoreTableData('testsTable', d.tests, ['testName', 'block', 'result']);
    restoreTableData('correspondencesTable', d.correspondences, ['date', 'from', 'to', 'subject']);
    restoreTableData('safetyTable', d.safetyIssues, ['issue', 'block', 'actionTaken']);
    restoreTableData('stakeholderTable', d.stakeholderContribution, ['stakeholder', 'contribution']);
    restoreTableData('siteOrdersTable', d.siteOrders, ['orderNo', 'issuedTo', 'instruction', 'deadline']);

    // Restore performance
    if (d.performance) {
      document.querySelectorAll('.perf-achievement').forEach(inp => {
        const match = d.performance.find(p => p.block === inp.dataset.block);
        if (match) inp.value = match.targetAchievement || '';
      });
      document.querySelectorAll('.perf-status').forEach(sel => {
        const match = d.performance.find(p => p.block === sel.dataset.block);
        if (match) sel.value = match.status || 'On Track';
      });
    }

    updateWorkforceTotals();
    document.getElementById('draftBanner').classList.add('hidden');
    document.getElementById('status').className = '';
    document.getElementById('status').textContent = 'Draft restored.';
  } catch (e) {
    console.error('Draft restore failed:', e);
  }
}

function restoreTableData(tableId, data, fields) {
  if (!data || data.length === 0) return;
  const tbody = document.querySelector('#' + tableId + ' tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  data.forEach(row => {
    const tr = tbody.insertRow();
    fields.forEach((f, i) => {
      const td = tr.insertCell();
      if (f === 'block' || f === 'allocatedBlock') {
        td.innerHTML = '<select>' + blockOptionsHTML + '</select>';
        if (row[f]) td.querySelector('select').value = row[f];
      } else if (f === 'condition') {
        td.innerHTML = '<select><option>Good</option><option>Fair</option><option>Broken</option><option>Under Repair</option></select>';
        if (row[f]) td.querySelector('select').value = row[f];
      } else {
        const inp = document.createElement('input');
        inp.type = (f === 'date' || f === 'deadline') ? 'date' : (f === 'qty' || f === 'planned' || f === 'available') ? 'number' : 'text';
        if (inp.type === 'number') inp.step = 'any';
        inp.value = row[f] || '';
        inp.placeholder = '...';
        td.appendChild(inp);
      }
    });
  });
}

function clearDraft(site) {
  if (!site) site = document.getElementById('siteSelect').value;
  if (site) localStorage.removeItem('hdcre_draft_' + site);
}

// ========== MY REPORTS ==========

async function loadMyReports() {
  const container = document.getElementById('myReportsContent');
  container.innerHTML = 'Loading...';
  try {
    const res = await fetch(API_BASE + '?endpoint=reports');
    allReports = await res.json();
    const userName = sessionStorage.getItem('hdcre_user') || '';
    const myReports = allReports.filter(r =>
      (r.reName || '').toLowerCase() === userName.toLowerCase()
    );

    if (myReports.length === 0) {
      container.innerHTML = '<p class="hint">No reports found for your account.</p>';
      return;
    }

    let html = '<table class="reports-list-table"><thead><tr>' +
      '<th>Report ID</th><th>Site</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    myReports.forEach(r => {
      const statusClass = r.status || 'Pending';
      html += '<tr><td style="font-size:0.8rem">' + r.id + '</td>' +
        '<td>' + r.site + '</td><td>' + r.date + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + statusClass + '</span></td>' +
        '<td><button class="btn-sm view-report-btn" data-id="' + r.id + '">View</button>';
      if (r.status === 'Pending') {
        html += ' <button class="btn-sm edit-report-btn" data-id="' + r.id + '">Edit</button>';
      }
      html += '</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('.view-report-btn').forEach(btn => {
      btn.addEventListener('click', () => viewMyReport(btn.dataset.id));
    });
    container.querySelectorAll('.edit-report-btn').forEach(btn => {
      btn.addEventListener('click', () => editMyReport(btn.dataset.id));
    });
  } catch (e) {
    container.innerHTML = '<p class="hint" style="color:#C44536">Failed to load reports.</p>';
  }
}

async function viewMyReport(reportId) {
  try {
    const res = await fetch(API_BASE + '?endpoint=reportDetail&reportId=' + reportId);
    const data = await res.json();
    if (!data.success) { alert('Could not load report.'); return; }

    const rp = data.report;
    let h = '<h3 style="color:var(--primary);margin-top:0">' + rp.site + ' - ' + rp.date + '</h3>';
    h += '<div class="meta-grid"><span class="label">RE:</span><span>' + rp.reName + '</span>';
    h += '<span class="label">Weather:</span><span>' + (rp.weatherAM || '') + ' / ' + (rp.weatherPM || '') + '</span>';
    h += '<span class="label">Efficiency:</span><span>' + (rp.efficiency || 'N/A') + '</span>';
    h += '<span class="label">Status:</span><span class="badge ' + (rp.status || '') + '">' + (rp.status || '') + '</span></div>';
    h += '<p><strong>Activity Summary:</strong> ' + (rp.activitySummary || '-') + '</p>';

    function renderSection(title, items, cols) {
      if (!items || items.length === 0) return '';
      let s = '<div class="detail-section"><h4>' + title + '</h4><table><tr>';
      cols.forEach(c => { s += '<th>' + c + '</th>'; });
      s += '</tr>';
      items.forEach(item => {
        s += '<tr>';
        cols.forEach(c => { s += '<td>' + (item[c] || '') + '</td>'; });
        s += '</tr>';
      });
      return s + '</table></div>';
    }

    h += renderSection('Block Status', rp.blockStatuses, ['Block Name', 'Block Status', 'Target Achievement', 'Performance Status']);
    h += renderSection('Work Progress', rp.tasks, ['Block', 'Task Name', 'Unit', 'Planned QTY', 'Executed QTY', 'Daily Completion %', 'Cumulative Executed QTY', 'Overall Completion %']);
    h += renderSection('Workforce', rp.workforce, ['Labor Type', 'Planned', 'Available', 'Comments']);
    h += renderSection('Equipment', rp.equipment, ['Equipment Type', 'Quantity', 'Working Condition', 'Comments']);
    h += renderSection('Materials Delivered', rp.materialsDelivered, ['Description', 'Unit', 'Quantity', 'Allocated Block']);
    h += renderSection('Materials On Site', rp.materialsOnSite, ['Description', 'Unit', 'Quantity', 'Allocated Block']);
    h += renderSection('Issues', rp.issues, ['Block', 'Issue Details']);
    h += renderSection('Tests', rp.tests, ['Test', 'Block', 'Result']);
    h += renderSection('Correspondences', rp.correspondences, ['Date', 'From', 'To', 'Subject']);
    h += renderSection('Safety Issues', rp.safetyIssues, ['Issue', 'Block', 'Action Taken']);
    h += renderSection('Stakeholder Contribution', rp.stakeholderContribution, ['Stakeholder', 'Contribution']);
    h += renderSection('Performance', rp.performance, ['Block', 'Daily Target Achievement', 'Status']);
    h += renderSection('Site Orders', rp.siteOrders, ['Order No', 'Issued To', 'Instruction', 'Deadline']);

    if (rp.holdPointRequests) {
      h += '<div class="detail-section"><h4>Hold-Point Requests</h4><p>' + rp.holdPointRequests + '</p></div>';
    }

    if (rp.photos && rp.photos.length > 0) {
      h += '<div class="detail-section"><h4>Photos</h4><div class="photo-grid">';
      rp.photos.forEach(p => {
        if (p.url) h += '<img src="' + p.url + '" alt="' + (p.caption || '') + '" title="' + (p.caption || '') + '">';
      });
      h += '</div></div>';
    }

    document.getElementById('reportViewContent').innerHTML = h;
    document.getElementById('reportViewModal').classList.remove('hidden');
  } catch (e) {
    alert('Error loading report.');
  }
}

function closeReportView() {
  document.getElementById('reportViewModal').classList.add('hidden');
}

async function editMyReport(reportId) {
  const status = document.getElementById('status');
  status.className = '';
  status.textContent = 'Loading report for editing...';

  try {
    const res = await fetch(API_BASE + '?endpoint=reportForEdit&reportId=' + reportId);
    const data = await res.json();

    if (!data.success) {
      status.className = 'error';
      status.textContent = 'Error: ' + (data.message || 'Cannot load report.');
      return;
    }

    const report = data.report;
    editingReportId = reportId;

    // Switch to New Report tab
    switchTab('new');

    // Populate basic fields
    document.getElementById('siteSelect').value = report.site || '';
    document.getElementById('reportDate').value = report.reportDate || '';
    document.getElementById('weatherAM').value = report.weatherAM || '';
    document.getElementById('weatherPM').value = report.weatherPM || '';
    document.getElementById('activitySummary').value = report.activitySummary || '';
    document.getElementById('resourceEfficiency').value = report.resourceEfficiency || '';
    document.getElementById('recommendations').value = report.recommendations || '';
    document.getElementById('holdPointRequests').value = report.holdPointRequests || '';

    // Trigger site change to load blocks/tasks
    await onSiteChange();

    // Populate block statuses
    if (report.blockStatuses) {
      document.querySelectorAll('.bs-status').forEach(sel => {
        const match = report.blockStatuses.find(b => b.blockId === sel.dataset.block);
        if (match) {
          sel.value = match.status || 'Not Active';
        }
      });
    }

    // Populate tasks
    if (report.tasks && report.tasks.length > 0) {
      const tbody = document.querySelector('#taskTable tbody');
      if (tbody) {
        tbody.innerHTML = '';
        report.tasks.forEach((t, idx) => {
          const row = tbody.insertRow();
          row.innerHTML = '<td>' + (idx + 1) + '</td>' +
            '<td><select class="task-block">' + blockOptionsHTML + '</select></td>' +
            '<td><input type="text" class="task-name-text" value="' + (t.name || '') + '"></td>' +
            '<td><input type="text" class="task-unit" value="' + (t.unit || '') + '" style="width:60px"></td>' +
            '<td><input type="number" class="task-planned" step="any" value="' + (t.plannedQty || 0) + '" style="width:70px"></td>' +
            '<td><input type="number" class="task-executed" step="any" value="' + (t.executedQty || 0) + '" style="width:70px"></td>' +
            '<td><input type="text" class="task-remark" value="' + (t.remark || '') + '" style="width:100px"></td>';
          if (t.blockId) {
            const bsel = row.querySelector('.task-block');
            if (bsel) bsel.value = t.blockId;
          }
        });
      }
    }

    // Populate simple tables
    restoreTableData('workforceTable', report.workforce, ['laborType', 'planned', 'available', 'comments']);
    restoreTableData('equipmentTable', report.equipment, ['type', 'qty', 'condition', 'comments']);
    restoreTableData('matDeliveredTable', report.materialsDelivered, ['desc', 'unit', 'qty', 'allocatedBlock']);
    restoreTableData('matOnSiteTable', report.materialsOnSite, ['desc', 'unit', 'qty', 'allocatedBlock']);
    restoreTableData('issuesTable', report.issues, ['block', 'details']);
    restoreTableData('testsTable', report.tests, ['testName', 'block', 'result']);
    restoreTableData('correspondencesTable', report.correspondences, ['date', 'from', 'to', 'subject']);
    restoreTableData('safetyTable', report.safetyIssues, ['issue', 'block', 'actionTaken']);
    restoreTableData('stakeholderTable', report.stakeholderContribution, ['stakeholder', 'contribution']);
    restoreTableData('siteOrdersTable', report.siteOrders, ['orderNo', 'issuedTo', 'instruction', 'deadline']);

    // Populate performance
    if (report.performance) {
      document.querySelectorAll('.perf-achievement').forEach(inp => {
        const match = report.performance.find(p => p.block === inp.dataset.block);
        if (match) inp.value = match.targetAchievement || '';
      });
      document.querySelectorAll('.perf-status').forEach(sel => {
        const match = report.performance.find(p => p.block === sel.dataset.block);
        if (match) sel.value = match.status || 'On Track';
      });
    }

    updateWorkforceTotals();

    // Show edit mode UI
    document.getElementById('submitBtn').textContent = 'Update Report';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
    document.getElementById('editModeBanner').classList.remove('hidden');
    document.getElementById('editModeBanner').textContent = 'Editing Report: ' + reportId;
    document.getElementById('photoSection').style.opacity = '0.5';
    document.getElementById('photoSection').style.pointerEvents = 'none';
    document.getElementById('photoSectionNote').classList.remove('hidden');

    status.className = 'success';
    status.textContent = 'Report loaded for editing.';
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (e) {
    status.className = 'error';
    status.textContent = 'Error loading report: ' + e.message;
  }
}

function cancelEdit() {
  editingReportId = null;
  document.getElementById('submitBtn').textContent = 'Submit Daily Report';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  document.getElementById('editModeBanner').classList.add('hidden');
  document.getElementById('photoSection').style.opacity = '1';
  document.getElementById('photoSection').style.pointerEvents = 'auto';
  document.getElementById('photoSectionNote').classList.add('hidden');
  document.getElementById('status').className = '';
  document.getElementById('status').textContent = 'Edit cancelled.';
  document.getElementById('dailyForm').reset();
  document.getElementById('reportDate').valueAsDate = new Date();
  document.getElementById('reName').value = sessionStorage.getItem('hdcre_user') || '';
}

// ========== SUBMIT ==========

async function handleSubmit(e) {
  e.preventDefault();

  // Photo check only for new reports
  if (!editingReportId) {
    const photos = document.getElementById('photos').files;
    if (photos.length < 3) { alert('Please upload at least 3 photos.'); return; }
  }

  const status = document.getElementById('status');
  status.className = '';
  status.textContent = editingReportId ? 'Updating...' : 'Submitting...';

  const report = {
    site: document.getElementById('siteSelect').value,
    reportDate: document.getElementById('reportDate').value,
    weatherAM: document.getElementById('weatherAM').value,
    weatherPM: document.getElementById('weatherPM').value,
    reName: document.getElementById('reName').value,
    activitySummary: document.getElementById('activitySummary').value,
    blockStatuses: collectBlockStatuses(),
    tasks: collectTasks(),
    workforce: collectTableData('workforceTable', ['laborType', 'planned', 'available', 'comments']),
    equipment: collectTableData('equipmentTable', ['type', 'qty', 'condition', 'comments']),
    materialsDelivered: collectTableData('matDeliveredTable', ['desc', 'unit', 'qty', 'allocatedBlock']),
    materialsOnSite: collectTableData('matOnSiteTable', ['desc', 'unit', 'qty', 'allocatedBlock']),
    issues: collectTableData('issuesTable', ['block', 'details']),
    tests: collectTableData('testsTable', ['testName', 'block', 'result']),
    correspondences: collectTableData('correspondencesTable', ['date', 'from', 'to', 'subject']),
    safetyIssues: collectTableData('safetyTable', ['issue', 'block', 'actionTaken']),
    stakeholderContribution: collectTableData('stakeholderTable', ['stakeholder', 'contribution']),
    resourceEfficiency: document.getElementById('resourceEfficiency').value,
    recommendations: document.getElementById('recommendations').value,
    performance: collectPerformance(),
    siteOrders: collectTableData('siteOrdersTable', ['orderNo', 'issuedTo', 'instruction', 'deadline']),
    holdPointRequests: document.getElementById('holdPointRequests').value
  };

  try {
    let action, body;
    if (editingReportId) {
      action = 'updateReport';
      report.reportId = editingReportId;
      body = { action: action, report: report };
    } else {
      action = 'submitReport';
      report.photos = await collectPhotosWithMeta();
      body = { action: action, report: report };
    }

    const res = await fetch(API_BASE, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const result = await res.json();

    if (result.success) {
      status.className = 'success';
      if (editingReportId) {
        status.textContent = 'Report updated successfully! ID: ' + editingReportId;
        cancelEdit();
      } else {
        status.textContent = 'Report submitted successfully! Pending Director review. ID: ' + result.reportId;
        clearDraft();
        document.getElementById('dailyForm').reset();
        document.getElementById('reportDate').valueAsDate = new Date();
        document.getElementById('reName').value = sessionStorage.getItem('hdcre_user') || '';
        document.getElementById('photoPreview').innerHTML = '';
        document.getElementById('photoMetaContainer').innerHTML = '';
        document.getElementById('blockStatusContainer').innerHTML = '<p class="hint">Select a site first to load blocks.</p>';
        document.getElementById('workProgressContainer').innerHTML = '<p class="hint">Select a site first to load blocks.</p>';
        document.getElementById('performanceContainer').innerHTML = '<p class="hint">Performance rows load with block statuses.</p>';
      }
    } else {
      status.className = 'error';
      status.textContent = 'Error: ' + (result.message || 'Unknown');
    }
  } catch (err) {
    status.className = 'error';
    status.textContent = 'Submission failed. Check connection.';
  }
}
