/* Version 4.1 */
const API_BASE = 'https://script.google.com/macros/s/AKfycbxH3FRKSReHNrjUb_fIbnKsk6htgBhMwO6Mq3Al3cI_z710cMPc7XNGcw7Qb3IGKc0e/exec';
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
  document.getElementById('populateBlockStatus').addEventListener('click', () => {
    console.log('[Button] Populate Block Status clicked');
    autoCalcBlockStatus();
  });
  document.querySelectorAll('.add-row-btn').forEach(btn => {
    btn.addEventListener('click', () => addDynamicRow(btn.dataset.target));
  });
  document.getElementById('dailyForm').addEventListener('submit', handleSubmit);
  document.getElementById('reportDate').valueAsDate = new Date();
  document.getElementById('reportDate').addEventListener('change', () => { clearTimeout(_autoCalcTimer); _autoCalcTimer = setTimeout(() => autoCalcBlockStatus(), 300); });
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

    blockOptionsHTML = currentBlocks.map(b =>
      '<option value="' + b.blockId + '">' + b.blockId + ' - ' + b.blockName + '</option>'
    ).join('');

    const tRes = await fetch(API_BASE + '?endpoint=tasks&site=' + encodeURIComponent(site));
    currentTasks = await tRes.json();
    renderWorkProgress();     // Section 2: RE fills this first
    autoCalcBlockStatus();    // Section 3: Auto-calculated from Section 2 + schedule

    const lRes = await fetch(API_BASE + '?endpoint=laborTypes&site=' + encodeURIComponent(site));
    currentLaborTypes = await lRes.json();
    renderWorkforce();

    // Check for draft
    checkForDraft(site);
  } catch (e) { console.error(e); }
}

// ========== BLOCK STATUS (AUTO-CALCULATED — Section 3) ==========

let _autoCalcTimer = null;

// Robust date parser — handles 'yyyy-MM-dd', 'Mon 06/01/26', '6/1/2026', Date objects
function parseScheduleDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  // Try ISO format first (what Code.gs sends)
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  // Try 'Mon 06/01/26' or '06/01/26' or '6/1/2026'
  const parts = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (parts) {
    let yr = parseInt(parts[3]);
    if (yr < 100) yr += 2000;  // '26' → 2026
    return new Date(yr, parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  // Fallback: native parser
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function autoCalcBlockStatus() {
  const c = document.getElementById('blockStatusContainer');
  const reportDateStr = document.getElementById('reportDate').value;
  if (!reportDateStr || !currentBlocks.length) {
    c.innerHTML = '<p class="hint">Select a site and enter report date to calculate.</p>';
    return;
  }
  const reportDate = parseScheduleDate(reportDateStr);
  if (!reportDate) {
    c.innerHTML = '<p class="hint" style="color:var(--danger)">Invalid report date.</p>';
    return;
  }

  // Read all work progress rows from Section 2
  const taskRows = document.querySelectorAll('#taskTable tbody tr');
  const blockData = {};  // blockId -> { plannedDays, totalDays, actualWeightedPct, taskCount }

  // Initialize block data from MasterSchedule (currentTasks)
  currentBlocks.forEach(b => {
    const tasks = currentTasks[b.blockId] || [];
    let totalDays = 0, elapsedDays = 0;
    tasks.forEach(t => {
      const dur = parseInt(t.duration) || 0;
      totalDays += dur;
      const start = parseScheduleDate(t.start);
      const finish = parseScheduleDate(t.finish);
      if (start && !isNaN(start.getTime())) {
        if (reportDate >= start) {
          if (finish && !isNaN(finish.getTime()) && reportDate > finish) {
            elapsedDays += dur;  // task should be complete
          } else {
            const daysPassed = Math.floor((reportDate - start) / 86400000) + 1;
            elapsedDays += Math.min(daysPassed, dur);
          }
        }
      }
    });
    blockData[b.blockId] = { totalDays, elapsedDays, actualSum: 0, weightSum: 0, taskCount: tasks.length };
  });

  // Accumulate actual progress from work progress rows
  console.log('[autoCalc] Reading', taskRows.length, 'task rows, reportDate:', reportDateStr);
  console.log('[autoCalc] currentBlocks:', currentBlocks.map(b => b.blockId).join(', '));
  console.log('[autoCalc] currentTasks keys:', Object.keys(currentTasks).join(', '));

  taskRows.forEach(row => {
    const blockId = row.querySelector('.task-block')?.value || row.dataset.block || '';
    const taskName = row.querySelector('.task-name')?.value || row.querySelector('.task-name-text')?.value || '';
    const cumulativeInput = row.querySelector('.task-cumulative');
    const executedInput = row.querySelector('.task-executed');
    const cumulative = parseFloat(cumulativeInput?.value) || 0;
    const executed = parseFloat(executedInput?.value) || 0;
    // Use cumulative first; if empty, fall back to daily executed
    const actualQty = cumulative > 0 ? cumulative : executed;

    if (!blockId || actualQty <= 0) {
      if (blockId && (cumulative > 0 || executed > 0)) {
        console.log('[autoCalc] SKIP (no blockId or qty=0) blockId=' + blockId + ' cumul=' + cumulative + ' exec=' + executed);
      }
      return;
    }

    // Find matching task in schedule to get overallPlannedQty and duration
    const tasks = currentTasks[blockId] || [];
    const match = tasks.find(t => t.name === taskName);
    console.log('[autoCalc]', blockId, taskName, 'actualQty=' + actualQty + ' (cumul=' + cumulative + ', exec=' + executed + ')', 'match=' + !!match);

    if (!match) {
      console.warn('[autoCalc] NO MATCH for', blockId, taskName, '- available tasks:', tasks.map(t => t.name).join(', '));
      return;
    }

    // Fallback: if overallPlannedQty is 0, compute from dailyPlannedQty * duration
    let overallPlanned = match.overallPlannedQty || 0;
    if (overallPlanned <= 0 && (match.dailyPlannedQty > 0) && (match.duration > 0)) {
      overallPlanned = match.dailyPlannedQty * match.duration;
      console.log('[autoCalc] Fallback: ' + taskName + ' overall=' + overallPlanned + ' (daily=' + match.dailyPlannedQty + ' x dur=' + match.duration + ')');
    }

    if (overallPlanned > 0 && blockData[blockId]) {
      const dur = parseInt(match.duration) || 1;
      const taskPct = Math.min((actualQty / overallPlanned) * 100, 100);
      blockData[blockId].actualSum += taskPct * dur;
      blockData[blockId].weightSum += dur;
      console.log('[autoCalc] OK', blockId, taskName, 'actualQty=' + actualQty, 'overall=' + overallPlanned, 'pct=' + taskPct.toFixed(1) + '%, dur=' + dur);
    } else {
      console.warn('[autoCalc] SKIP (overallPlanned=0) blockId=' + blockId, ' + taskName, 'overallPlanned=' + overallPlanned);
    }
  });

  // Render block status table
  let html = '<table style="width:100%;font-size:0.88em;border-collapse:collapse">' +
    '<tr style="background:var(--primary);color:#fff"><th>Block</th><th>Planned %</th><th>Actual %</th><th>Target Achievement %</th><th>Status</th><th>Performance</th></tr>';

  currentBlocks.forEach(b => {
    const d = blockData[b.blockId] || { totalDays: 0, elapsedDays: 0, actualSum: 0, weightSum: 0 };
    const plannedPct = d.totalDays > 0 ? ((d.elapsedDays / d.totalDays) * 100) : 0;
    const actualPct = d.weightSum > 0 ? (d.actualSum / d.weightSum) : 0;
    const targetAch = plannedPct > 0 ? ((actualPct / plannedPct) * 100) : (actualPct > 0 ? 100 : 0);

    let status, perf;
    if (actualPct >= 100) { status = 'Completed'; perf = 'Complete'; }
    else if (targetAch >= 95) { status = 'On Track'; perf = 'On Schedule'; }
    else if (targetAch >= 70) { status = 'Delayed'; perf = 'Slightly Behind'; }
    else if (actualPct > 0) { status = 'Delayed'; perf = 'Behind Schedule'; }
    else if (plannedPct > 0) { status = 'Delayed'; perf = 'Not Started (Should Have)'; }
    else { status = 'Not Active'; perf = 'Not Yet Due'; }

    const achColor = targetAch >= 95 ? 'var(--success)' : targetAch >= 70 ? 'var(--warn)' : 'var(--danger)';
    const statusColor = status === 'Completed' ? 'var(--success)' : status === 'On Track' ? 'var(--success)' : status === 'Delayed' ? 'var(--danger)' : 'var(--text)';

    html += '<tr style="border-bottom:1px solid var(--border)">' +
      '<td><strong>' + b.blockId + '</strong> - ' + (b.blockName || '') + '</td>' +
      '<td>' + plannedPct.toFixed(1) + '%</td>' +
      '<td>' + actualPct.toFixed(1) + '%</td>' +
      '<td style="font-weight:700;color:' + achColor + '">' + targetAch.toFixed(1) + '%</td>' +
      '<td style="color:' + statusColor + ';font-weight:600">' + status + '</td>' +
      '<td>' + perf + '</td></tr>';
  });

  html += '</table>';
  c.innerHTML = html;
}

// ========== WORK PROGRESS (Section 2 — RE enters data here) ==========

function renderWorkProgress() {
  const c = document.getElementById('workProgressContainer');
  if (currentBlocks.length === 0) {
    c.innerHTML = '<p class="hint">No blocks configured.</p>';
    return;
  }
  let html = '<table id="taskTable"><thead><tr><th>#</th><th>Block</th><th>Task</th><th>Unit</th><th>Daily Planned</th><th>Daily Executed</th><th>Daily %</th><th>Cumulative</th><th>Overall %</th><th>Remarks</th></tr></thead><tbody>';
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
          '<td><input type="text" class="task-unit" value="' + (t.unit || '') + '" readonly style="width:50px"></td>' +
          '<td><input type="number" class="task-planned" step="any" value="' + (t.dailyPlannedQty || '') + '" style="width:70px"></td>' +
          '<td><input type="number" class="task-executed" step="any" style="width:70px" data-block="' + b.blockId + '" data-overall="' + (t.overallPlannedQty || 0) + '"></td>' +
          '<td class="task-daily-pct" style="width:55px;text-align:center">-</td>' +
          '<td><input type="number" class="task-cumulative" step="any" style="width:80px" placeholder="Cumul." data-block="' + b.blockId + '" data-overall="' + (t.overallPlannedQty || 0) + '"></td>' +
          '<td class="task-overall-pct" style="width:55px;text-align:center">-</td>' +
          '<td><input type="text" class="task-remark" style="width:90px"></td></tr>';
      });
    } else {
      counter++;
      html += '<tr data-block="' + b.blockId + '">' +
        '<td>' + counter + '</td>' +
        '<td><select class="task-block">' + blockOptionsHTML + '</select></td>' +
        '<td><input type="text" class="task-name-text" placeholder="Task description"></td>' +
        '<td><input type="text" class="task-unit" placeholder="m3" style="width:50px"></td>' +
        '<td><input type="number" class="task-planned" step="any" style="width:70px"></td>' +
        '<td><input type="number" class="task-executed" step="any" style="width:70px" data-block="' + b.blockId + '" data-overall="0"></td>' +
        '<td class="task-daily-pct" style="width:55px;text-align:center">-</td>' +
        '<td><input type="number" class="task-cumulative" step="any" style="width:80px" placeholder="Cumul." data-block="' + b.blockId + '" data-overall="0"></td>' +
        '<td class="task-overall-pct" style="width:55px;text-align:center">-</td>' +
        '<td><input type="text" class="task-remark" style="width:90px"></td></tr>';
    }
  });
  html += '</tbody></table>';
  c.innerHTML = html;

  // Add live calculation listeners
  document.querySelectorAll('.task-executed, .task-cumulative').forEach(inp => {
    inp.addEventListener('input', onTaskInputChanged);
  });
}

function onTaskInputChanged() {
  // Update Daily % and Overall % for the changed row
  const row = this.closest('tr');
  if (!row) return;
  const planned = parseFloat(row.querySelector('.task-planned')?.value) || 0;
  const executed = parseFloat(row.querySelector('.task-executed')?.value) || 0;
  const cumulative = parseFloat(row.querySelector('.task-cumulative')?.value) || 0;
  const overall = parseFloat(this.dataset.overall) || 0;

  const dailyCell = row.querySelector('.task-daily-pct');
  const overallCell = row.querySelector('.task-overall-pct');
  if (planned > 0) dailyCell.textContent = ((executed / planned) * 100).toFixed(1) + '%';
  else dailyCell.textContent = '-';
  if (overall > 0) overallCell.textContent = ((cumulative / overall) * 100).toFixed(1) + '%';
  else overallCell.textContent = '-';

  // Debounced re-calculation of Block Status (Section 3)
  clearTimeout(_autoCalcTimer);
  _autoCalcTimer = setTimeout(() => autoCalcBlockStatus(), 300);
}

function addGenericRow() {
  const tbody = document.querySelector('#taskTable tbody');
  if (!tbody) return;
  const count = tbody.rows.length + 1;
  const row = tbody.insertRow();
  row.dataset.block = '';
  row.innerHTML = '<td>' + count + '</td>' +
    '<td><select class="task-block">' + blockOptionsHTML + '</select></td>' +
    '<td><input type="text" class="task-name-text" placeholder="Task description"></td>' +
    '<td><input type="text" class="task-unit" placeholder="m3" style="width:50px"></td>' +
    '<td><input type="number" class="task-planned" step="any" style="width:70px"></td>' +
    '<td><input type="number" class="task-executed" step="any" style="width:70px" data-block="" data-overall="0"></td>' +
    '<td class="task-daily-pct" style="width:55px;text-align:center">-</td>' +
    '<td><input type="number" class="task-cumulative" step="any" style="width:80px" placeholder="Cumul." data-block="" data-overall="0"></td>' +
    '<td class="task-overall-pct" style="width:55px;text-align:center">-</td>' +
    '<td><input type="text" class="task-remark" style="width:90px"></td>';
  // Attach listeners to new inputs
  row.querySelectorAll('.task-executed, .task-cumulative').forEach(inp => {
    inp.addEventListener('input', onTaskInputChanged);
  });
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
  // Read from auto-calculated Section 3 table
  const rows = document.querySelectorAll('#blockStatusContainer table tr');
  const statuses = [];
  rows.forEach((row, i) => {
    if (i === 0) return; // skip header
    const cells = row.querySelectorAll('td');
    if (cells.length >= 6) {
      const blockLabel = cells[0].textContent.trim();
      const blockId = blockLabel.split(' - ')[0].trim();
      const targetAch = cells[3].textContent.trim();
      const perfStatus = cells[5].textContent.trim();
      if (blockId) {
        statuses.push({
          blockId,
          status: cells[4].textContent.trim(),
          targetAchievement: targetAch,
          perfStatus
        });
      }
    }
  });
  return statuses;
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
    const cumul = row.querySelector('.task-cumulative');
    const execVal = exec ? (parseFloat(exec.value) || 0) : 0;
    const cumulVal = cumul ? (parseFloat(cumul.value) || 0) : 0;
    // Collect task if it has a name AND (executed OR cumulative) value
    if (name && (execVal > 0 || cumulVal > 0)) {
      tasks.push({
        blockId: blockSel ? blockSel.value : '',
        name,
        unit: row.querySelector('.task-unit') ? row.querySelector('.task-unit').value : '',
        plannedQty: parseFloat(row.querySelector('.task-planned')?.value) || 0,
        executedQty: execVal,
        cumulativeQty: cumulVal,
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
