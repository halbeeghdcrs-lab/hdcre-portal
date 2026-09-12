/* Version 5.1 */
const API_BASE = 'https://script.google.com/macros/s/AKfycbxUWdMaOYIZ51kKQwJe8aPE5VW81lFA-Owzw6oQZWeSThld7t8eNC1ejEbfU-ik1Y2X/exec';
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

// ========== LOGIN (robust V5.1) ==========

function attemptLogin() {
  const name = document.getElementById('loginName').value.trim();
  const pw   = document.getElementById('loginPassword').value.trim();
  const err  = document.getElementById('loginError');
  const btn  = document.getElementById('loginBtn');
  err.textContent = '';
  err.style.color = '#e74c3c';
  if (!name || !pw) { err.textContent = 'Please enter both Name and Password.'; return; }

  btn.disabled = true;
  btn.textContent = 'Checking...';

  const url = API_BASE + '?action=login&name=' + encodeURIComponent(name) +
              '&password=' + encodeURIComponent(pw);

  fetch(url)
    .then(r => {
      if (!r.ok) throw new Error('Server returned ' + r.status);
      return r.text();
    })
    .then(text => {
      let d;
      try { d = JSON.parse(text); }
      catch (e) {
        throw new Error('Backend did not return JSON. Raw response: ' + text.slice(0, 200));
      }

      if (d.success && d.role === 'RE') {
        sessionStorage.setItem('hdcre_user', name);
        sessionStorage.setItem('hdcre_role', d.role);
        showMainApp(name);
        return;
      }

      if (d.success && d.role) {
        err.textContent = 'Access denied. Your role is "' + d.role +
          '" (raw: "' + (d.roleRaw || '?') + '"). This portal is for Resident Engineers only.';
        return;
      }

      if (d.success) {
        err.textContent = 'Login OK but no Role assigned. Ask the admin to set your Role to "RE".';
        return;
      }

      // Build a helpful diagnostic message
      let msg = 'Login failed. ';
      switch (d.reason) {
        case 'SHEET_NOT_FOUND':
          msg += 'No staff sheet found. Tried: ' + (d.triedSheets || []).join(', ') +
                 '. Create a sheet named "Staff_Accounts".';
          break;
        case 'HEADERS_MISSING':
          msg += 'Staff sheet headers are wrong. Found: ' + JSON.stringify(d.headers || []) +
                 '. Expected: Name | Password | Role.';
          break;
        case 'NO_MATCH':
          msg += 'Name/password did not match. Sheet "' + (d.sheetUsed || '?') + '" has ' +
                 (d.totalRows || 0) + ' data row(s). Names found: ' +
                 (d.namesSample || []).join(', ') + '.';
          break;
        default:
          msg += (d.message || 'Invalid name or password.') +
                 ' Make sure your account exists in Staff_Accounts with Role = RE.';
      }
      err.textContent = msg;
    })
    .catch(e => {
      if (e.message.includes('Failed to fetch')) {
        err.textContent = 'Network error — cannot reach backend. Check that Code.gs is deployed ' +
                          '(as a Web App, "Anyone" access) and API_BASE is the /exec URL.';
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
      console.warn('[autoCalc] SKIP (overallPlanned=0) blockId=' + blockId + ' ' + taskName + ' overallPlanned=' + overallPlanned);
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
        '<td><input type="text" placeholder="Result"></td>' +
        '<td><input type="file" accept="image/*" class="row-photo" data-section="tests" onchange="previewRowPhoto(this)"></td>';
      break;
    case 'correspondencesTable':
      row.innerHTML = '<td><input type="date"></td>' +
        '<td><input type="text" placeholder="From"></td>' +
        '<td><input type="text" placeholder="To"></td>' +
        '<td><input type="text" placeholder="Subject"></td>' +
        '<td><input type="file" accept="image/*" class="row-photo" data-section="correspondences" onchange="previewRowPhoto(this)"></td>';
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
        '<td><input type="date"></td>' +
        '<td><input type="file" accept="image/*" class="row-photo" data-section="siteOrders" onchange="previewRowPhoto(this)"></td>';
      break;
  }
}

// ========== ROW-LEVEL PHOTO PREVIEW (Sections 9, 10, 14) ==========

function previewRowPhoto(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  // Remove any existing preview in this cell
  let cell = inputEl.parentElement;
  let oldPreview = cell.querySelector('.row-photo-preview');
  if (oldPreview) oldPreview.remove();
  // Show thumbnail
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = document.createElement('img');
    img.src = ev.target.result;
    img.className = 'row-photo-preview';
    img.style.cssText = 'max-width:80px;max-height:60px;border-radius:4px;margin-top:4px;border:1px solid #ccc;';
    cell.appendChild(img);
  };
  reader.readAsDataURL(file);
}

// Collect all row-level photos from a table as base64 array
function collectRowPhotos(tableId) {
  const photos = [];
  const inputs = document.querySelectorAll('#' + tableId + ' .row-photo');
  inputs.forEach(function(input) {
    if (input.files && input.files[0]) {
      // We'll store the file reference; conversion happens at submit time
      photos.push({ file: input.files[0], section: input.dataset.section });
    }
  });
  return photos;
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
    if (name && (execVal
