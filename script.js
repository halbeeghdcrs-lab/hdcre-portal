const API_BASE = 'https://script.google.com/macros/s/AKfycbx14uKC7ZyT991b3jltKDa_a33_cIKFADBzZYeCXsAszlPbsS8-gA2-5hAXTlzJodUl/exec';
let currentBlocks = [];
let currentTasks = {};
let currentLaborTypes = [];
let blockOptionsHTML = '';

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

  // Photo file input listener for preview + meta fields
  document.getElementById('photos').addEventListener('change', onPhotosSelected);

  // Add initial empty rows for dynamic tables
  ['issuesTable', 'testsTable', 'correspondencesTable', 'safetyTable',
    'stakeholderTable', 'siteOrdersTable', 'equipmentTable',
    'matDeliveredTable', 'matOnSiteTable'].forEach(id => addDynamicRow(id));
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

  // Loading state
  btn.disabled = true;
  btn.textContent = 'Checking...';

  const url = `${API_BASE}?action=login&name=${encodeURIComponent(name)}&password=${encodeURIComponent(pw)}`;
  console.log('[HDCRS] Login attempt for:', name);
  console.log('[HDCRS] Fetching:', url);

  fetch(url)
    .then(r => {
      console.log('[HDCRS] Response status:', r.status, r.ok);
      if (!r.ok) throw new Error('Server returned ' + r.status);
      return r.json();
    })
    .then(d => {
      console.log('[HDCRS] Server response:', JSON.stringify(d));
      if (d.success && d.role === 'RE') {
        sessionStorage.setItem('hdcre_user', name);
        sessionStorage.setItem('hdcre_role', d.role);
        showMainApp(name);
      } else if (d.success && d.role) {
        err.textContent = 'Access denied — this portal is for Resident Engineers only. Your role is: ' + d.role;
      } else if (d.success) {
        err.textContent = 'Login OK but no role assigned. Ask admin to set your Role in Staff_Accounts.';
      } else {
        err.textContent = 'Invalid name or password. Check Staff_Accounts sheet in Google Sheets.';
      }
    })
    .catch(e => {
      console.error('[HDCRS] Login error:', e);
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        err.textContent = 'Network error — cannot reach server. Check: (1) API_BASE URL in script.js, (2) Apps Script deployed as "Web App" with "Anyone" access.';
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

function logout() { sessionStorage.removeItem('hdcre_user'); location.reload(); }

// ========== DATA LOADING ==========

async function loadSites() {
  try {
    const res = await fetch(`${API_BASE}?endpoint=sites`);
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
    // Load blocks
    const bRes = await fetch(`${API_BASE}?endpoint=blocks&site=${encodeURIComponent(site)}`);
    currentBlocks = await bRes.json();
    renderBlockStatus();

    // Build block option HTML for dropdowns
    blockOptionsHTML = currentBlocks.map(b =>
      `<option value="${b.blockId}">${b.blockId} – ${b.blockName}</option>`
    ).join('');

    // Load tasks (grouped by block)
    const tRes = await fetch(`${API_BASE}?endpoint=tasks&site=${encodeURIComponent(site)}`);
    currentTasks = await tRes.json();
    renderWorkProgress();

    // Load labor types
    const lRes = await fetch(`${API_BASE}?endpoint=laborTypes&site=${encodeURIComponent(site)}`);
    currentLaborTypes = await lRes.json();
    renderWorkforce();
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
    html += `<div class="block-status-item">
      <div class="block-label">${b.blockId} – ${b.blockName}</div>
      <label>Status <select class="bs-status" data-block="${b.blockId}">
        <option>Not Active</option><option>On Progress</option><option>Delayed</option><option>On Track</option><option>Completed</option>
      </select></label>
    </div>`;
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
      // Type A: has master schedule
      blockTasks.forEach(t => {
        counter++;
        html += `<tr data-block="${b.blockId}">
          <td>${counter}</td>
          <td><select class="task-block" disabled><option value="${b.blockId}" selected>${b.blockId}</option></select></td>
          <td><select class="task-name"><option value="${t.name}" selected>${t.name}</option></select></td>
          <td><input type="text" class="task-unit" value="${t.unit || ''}" readonly style="width:60px"></td>
          <td><input type="number" class="task-planned" step="any" value="${t.dailyPlannedQty || ''}" style="width:70px"></td>
          <td><input type="number" class="task-executed" step="any" style="width:70px"></td>
          <td><input type="text" class="task-remark" style="width:100px"></td>
        </tr>`;
      });
    } else {
      // Type B: free text entry
      counter++;
      html += `<tr data-block="${b.blockId}">
        <td>${counter}</td>
        <td><select class="task-block">${blockOptionsHTML}</select></td>
        <td><input type="text" class="task-name-text" placeholder="Task description"></td>
        <td><input type="text" class="task-unit" placeholder="m3" style="width:60px"></td>
        <td><input type="number" class="task-planned" step="any" style="width:70px"></td>
        <td><input type="number" class="task-executed" step="any" style="width:70px"></td>
        <td><input type="text" class="task-remark" style="width:100px"></td>
      </tr>`;
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
  row.innerHTML = `<td>${count}</td>
    <td><select class="task-block">${blockOptionsHTML}</select></td>
    <td><input type="text" class="task-name-text" placeholder="Task description"></td>
    <td><input type="text" class="task-unit" placeholder="m3" style="width:60px"></td>
    <td><input type="number" class="task-planned" step="any" style="width:70px"></td>
    <td><input type="number" class="task-executed" step="any" style="width:70px"></td>
    <td><input type="text" class="task-remark" style="width:100px"></td>`;
}

// ========== WORKFORCE ==========

function renderWorkforce() {
  const tbody = document.querySelector('#workforceTable tbody');
  tbody.innerHTML = '';
  currentLaborTypes.forEach(lt => {
    tbody.innerHTML += `<tr>
      <td>${lt}</td>
      <td><input type="number" class="wf-planned" value="0" min="0"></td>
      <td><input type="number" class="wf-available" value="0" min="0"></td>
      <td><input type="text" class="wf-comments" placeholder="e.g. Block A & B"></td>
    </tr>`;
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
    html += `<tr>
      <td>${b.blockId} – ${b.blockName}</td>
      <td><input type="text" class="perf-achievement" data-block="${b.blockId}" placeholder="e.g. 80%"></td>
      <td><select class="perf-status" data-block="${b.blockId}">
        <option>On Track</option><option>Delayed</option><option>Needs Schedule Update</option><option>Completed</option>
      </select></td>
    </tr>`;
  });
  html += '</tbody></table>';
  c.innerHTML = html;
}

// ========== DYNAMIC ROW ADDER ==========

function addDynamicRow(tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  const row = tbody.insertRow();
  switch (tableId) {
    case 'equipmentTable':
      row.innerHTML = `<td><input type="text" placeholder="e.g. Mixer"></td>
        <td><input type="number" value="1" min="0"></td>
        <td><select><option>Good</option><option>Fair</option><option>Broken</option><option>Under Repair</option></select></td>
        <td><input type="text" placeholder="e.g. Block A"></td>`;
      break;
    case 'matDeliveredTable': case 'matOnSiteTable':
      row.innerHTML = `<td><input type="text" placeholder="Description"></td>
        <td><input type="text" placeholder="m3" style="width:50px"></td>
        <td><input type="number" step="any"></td>
        <td><select>${blockOptionsHTML}</select></td>`;
      break;
    case 'issuesTable':
      row.innerHTML = `<td><select>${blockOptionsHTML}</select></td>
        <td><textarea rows="1" placeholder="Describe the issue..."></textarea></td>`;
      break;
    case 'testsTable':
      row.innerHTML = `<td><input type="text" placeholder="Test name"></td>
        <td><select>${blockOptionsHTML}</select></td>
        <td><input type="text" placeholder="Result"></td>`;
      break;
    case 'correspondencesTable':
      row.innerHTML = `<td><input type="date"></td>
        <td><input type="text" placeholder="From"></td>
        <td><input type="text" placeholder="To"></td>
        <td><input type="text" placeholder="Subject"></td>`;
      break;
    case 'safetyTable':
      row.innerHTML = `<td><input type="text" placeholder="Safety issue"></td>
        <td><select>${blockOptionsHTML}</select></td>
        <td><input type="text" placeholder="Action taken"></td>`;
      break;
    case 'stakeholderTable':
      row.innerHTML = `<td><input type="text" placeholder="Stakeholder"></td>
        <td><input type="text" placeholder="Contribution"></td>`;
      break;
    case 'siteOrdersTable':
      row.innerHTML = `<td><input type="text" placeholder="Order No."></td>
        <td><input type="text" placeholder="Issued To"></td>
        <td><textarea rows="1" placeholder="Instruction"></textarea></td>
        <td><input type="date"></td>`;
      break;
  }
}

// ========== PHOTOS with CAPTION/BLOCK META ==========

function onPhotosSelected(e) {
  const files = e.target.files;
  const preview = document.getElementById('photoPreview');
  const metaContainer = document.getElementById('photoMetaContainer');
  preview.innerHTML = '';
  metaContainer.innerHTML = '';

  Array.from(files).forEach((file, idx) => {
    // Thumbnail preview
    const reader = new FileReader();
    reader.onload = ev => {
      const img = document.createElement('img');
      img.src = ev.target.result;
      img.alt = file.name;
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);

    // Meta row (block + caption)
    const metaDiv = document.createElement('div');
    metaDiv.className = 'photo-meta-item';
    metaDiv.innerHTML = `
      <img src="" alt="preview" data-photo-idx="${idx}">
      <div class="meta-fields">
        <label>Block <select class="photo-block">${blockOptionsHTML || '<option value="">No blocks loaded</option>'}</select></label>
        <label>Caption <input type="text" class="photo-caption" placeholder="Describe this photo..."></label>
      </div>
    `;
    metaContainer.appendChild(metaDiv);

    // Load thumbnail into meta item
    const thumbReader = new FileReader();
    thumbReader.onload = ev => {
      metaDiv.querySelector(`img[data-photo-idx="${idx}"]`).src = ev.target.result;
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
  const rows = document.querySelectorAll(`#${tableId} tbody tr`);
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

// ========== SUBMIT ==========

async function handleSubmit(e) {
  e.preventDefault();
  const photos = document.getElementById('photos').files;
  if (photos.length < 3) { alert('Please upload at least 3 photos.'); return; }
  const status = document.getElementById('status');
  status.className = '';
  status.textContent = 'Submitting...';

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
    holdPointRequests: document.getElementById('holdPointRequests').value,
    photos: await collectPhotosWithMeta()
  };

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      body: JSON.stringify({ action: 'submitReport', report })
    });
    const result = await res.json();
    if (result.success) {
      status.className = 'success';
      status.textContent = 'Report submitted successfully! Pending Director review. ID: ' + result.reportId;
      document.getElementById('dailyForm').reset();
      document.getElementById('reportDate').valueAsDate = new Date();
      document.getElementById('reName').value = sessionStorage.getItem('hdcre_user') || '';
      document.getElementById('photoPreview').innerHTML = '';
      document.getElementById('photoMetaContainer').innerHTML = '';
      document.getElementById('blockStatusContainer').innerHTML = '<p class="hint">Select a site first to load blocks.</p>';
      document.getElementById('workProgressContainer').innerHTML = '<p class="hint">Select a site first to load blocks.</p>';
      document.getElementById('performanceContainer').innerHTML = '<p class="hint">Performance rows load with block statuses.</p>';
    } else {
      status.className = 'error';
      status.textContent = 'Error: ' + (result.message || 'Unknown');
    }
  } catch (err) {
    status.className = 'error';
    status.textContent = 'Submission failed. Check connection.';
  }
}
