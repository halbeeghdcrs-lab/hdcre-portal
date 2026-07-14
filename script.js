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

  // Check for draft on load
  checkForDraft();

  // Cancel edit
  document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);

  // Modal close
  document.getElementById('closeViewBtn').addEventListener('click', () => {
    document.getElementById('reportViewModal').classList.add('hidden');
  });
  document.getElementById('reportViewModal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
});

// ========== LOGIN ==========

function attemptLogin() {
  const name = document.getElementById('loginName').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!name || !password) {
    document.getElementById('loginError').textContent = 'Please enter name and password.';
    return;
  }
  document.getElementById('loginError').textContent = 'Logging in...';
  fetch(API_BASE + '?action=login&name=' + encodeURIComponent(name) + '&password=' + encodeURIComponent(password))
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        sessionStorage.setItem('hdcre_user', data.name);
        sessionStorage.setItem('hdcre_role', data.role || 'Staff');
        showMainApp(data.name);
      } else {
        document.getElementById('loginError').textContent = data.error || 'Login failed.';
      }
    })
    .catch(() => {
      document.getElementById('loginError').textContent = 'Network error. Please try again.';
    });
}

function showMainApp(name) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  document.getElementById('loggedUser').textContent = name;
  document.getElementById('reName').value = name;
  loadSites();
}

function logout() {
  sessionStorage.clear();
  location.reload();
}

// ========== TAB SWITCHING ==========

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="' + tab + '"]').classList.add('active');
  document.getElementById('tabNewReport').classList.toggle('hidden', tab !== 'new');
  document.getElementById('tabMyReports').classList.toggle('hidden', tab !== 'myreports');
  if (tab === 'myreports') loadMyReports();
}

// ========== LOAD MASTER DATA ==========

function loadSites() {
  fetch(API_BASE + '?endpoint=sites')
    .then(r => r.json())
    .then(data => {
      if (data.sites) {
        const sel = document.getElementById('siteSelect');
        sel.innerHTML = '<option value="">-- Select --</option>';
        data.sites.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s; opt.textContent = s;
          sel.appendChild(opt);
        });
      }
    });
}

function onSiteChange() {
  const site = document.getElementById('siteSelect').value;
  if (!site) return;
  loadBlocks(site);
  loadTasks(site);
  loadLaborTypes(site);
  loadWorkProgress(site);
  loadPerformanceRows(site);
}

function loadBlocks(site) {
  fetch(API_BASE + '?endpoint=blocks&site=' + encodeURIComponent(site))
    .then(r => r.json())
    .then(data => {
      currentBlocks = data.blocks || [];
      buildBlockStatusGrid();
    });
}

function loadTasks(site) {
  fetch(API_BASE + '?endpoint=tasks&site=' + encodeURIComponent(site))
    .then(r => r.json())
    .then(data => {
      currentTasks = data.tasks || {};
      loadWorkProgress(document.getElementById('siteSelect').value);
    });
}

function loadLaborTypes(site) {
  fetch(API_BASE + '?endpoint=laborTypes&site=' + encodeURIComponent(site))
    .then(r => r.json())
    .then(data => {
      currentLaborTypes = data.laborTypes || [];
      buildWorkforceTable();
    });
}

// ========== BLOCK STATUS GRID ==========

function buildBlockStatusGrid() {
  const container = document.getElementById('blockStatusContainer');
  container.innerHTML = '';
  blockOptionsHTML = '';
  const grid = document.createElement('div');
  grid.className = 'block-status-grid';
  currentBlocks.forEach(b => {
    blockOptionsHTML += '<option value="' + b.id + '">' + b.name + '</option>';
    const item = document.createElement('div');
    item.className = 'block-status-item';
    item.innerHTML =
      '<div class="block-label">' + b.name + ' (' + b.id + ')</div>' +
      '<label>Status <select class="bs-status" data-block="' + b.id + '">' +
        '<option>On Track</option><option>Delayed</option><option>Critical</option><option>Completed</option><option>Not Started</option>' +
      '</select></label>' +
      '<label>Target Achievement % <input type="number" class="bs-target" data-block="' + b.id + '" min="0" max="100" value="0"></label>';
    grid.appendChild(item);
  });
  container.appendChild(grid);
}

// ========== WORK PROGRESS ==========

function loadWorkProgress(site) {
  if (!site || !currentTasks || Object.keys(currentTasks).length === 0) return;
  const container = document.getElementById('workProgressContainer');
  container.innerHTML = '';
  const table = document.createElement('table');
  table.id = 'wpTable';
  table.innerHTML = '<thead><tr><th>Block</th><th>Task Name</th><th>Unit</th><th>Planned QTY</th><th>Executed QTY</th><th>Daily %</th><th>Cumulative</th><th>Overall %</th><th>Remarks</th><th></th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  const allBlocks = Object.keys(currentTasks);
  allBlocks.forEach(block => {
    (currentTasks[block] || []).forEach(task => {
      const row = document.createElement('tr');
      row.innerHTML =
        '<td><select class="wp-block">' + blockOptionsHTML + '</select></td>' +
        '<td>' + task.taskName + '</td>' +
        '<td>' + task.unit + '</td>' +
        '<td><input type="number" class="wp-planned" value="' + (task.dailyPlanned || 0) + '" min="0"></td>' +
        '<td><input type="number" class="wp-executed" value="0" min="0"></td>' +
        '<td class="wp-daily-pct">0%</td>' +
        '<td><input type="number" class="wp-cumulative" value="0" min="0"></td>' +
        '<td class="wp-overall-pct">0%</td>' +
        '<td><input type="text" class="wp-remarks" placeholder="Remarks"></td>' +
        '<td><button type="button" class="btn-sm remove-row-btn" style="background:var(--danger)">X</button></td>';
      const sel = row.querySelector('.wp-block');
      if (sel) sel.value = block;
      tbody.appendChild(row);
    });
  });
  container.appendChild(table);

  // Auto-calculate
  table.addEventListener('input', function(e) {
    const row = e.target.closest('tr');
    if (!row) return;
    const planned = parseFloat(row.querySelector('.wp-planned')?.value) || 0;
    const executed = parseFloat(row.querySelector('.wp-executed')?.value) || 0;
    const dailyPct = planned > 0 ? Math.round((executed / planned) * 100) : 0;
    row.querySelector('.wp-daily-pct').textContent = dailyPct + '%';

    const cumulative = parseFloat(row.querySelector('.wp-cumulative')?.value) || 0;
    const overallPlanned = 0; // placeholder
    row.querySelector('.wp-overall-pct').textContent = '0%';
  });

  // Remove row
  table.addEventListener('click', function(e) {
    if (e.target.classList.contains('remove-row-btn')) {
      e.target.closest('tr').remove();
    }
  });
}

function addGenericRow() {
  const table = document.getElementById('wpTable');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const row = document.createElement('tr');
  row.innerHTML =
    '<td><select class="wp-block">' + (blockOptionsHTML || '<option>No blocks loaded</option>') + '</select></td>' +
    '<td><input type="text" class="wp-taskname" placeholder="Task Name"></td>' +
    '<td><input type="text" class="wp-unit" placeholder="Unit"></td>' +
    '<td><input type="number" class="wp-planned" value="0" min="0"></td>' +
    '<td><input type="number" class="wp-executed" value="0" min="0"></td>' +
    '<td class="wp-daily-pct">0%</td>' +
    '<td><input type="number" class="wp-cumulative" value="0" min="0"></td>' +
    '<td class="wp-overall-pct">0%</td>' +
    '<td><input type="text" class="wp-remarks" placeholder="Remarks"></td>' +
    '<td><button type="button" class="btn-sm remove-row-btn" style="background:var(--danger)">X</button></td>';
  tbody.appendChild(row);
}

// ========== DYNAMIC ROWS (reusable) ==========

function addDynamicRow(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const headerRow = table.querySelector('thead tr');
  if (!headerRow) return;
  const cells = headerRow.querySelectorAll('th');
  const row = document.createElement('tr');
  cells.forEach((th, idx) => {
    const td = document.createElement('td');
    if (idx === 0 && (th.textContent.includes('Block'))) {
      td.innerHTML = '<select>' + (blockOptionsHTML || '<option value="">--</option>') + '</select>';
    } else if (th.textContent.includes('Qty') || th.textContent.includes('Planned') || th.textContent.includes('Available') || th.textContent.includes('Quantity')) {
      td.innerHTML = '<input type="number" value="0" min="0" style="width:70px">';
    } else {
      td.innerHTML = '<input type="text" placeholder="' + th.textContent + '">';
    }
    row.appendChild(td);
  });
  // Add remove button
  const td = document.createElement('td');
  td.innerHTML = '<button type="button" class="btn-sm remove-row-btn" style="background:var(--danger)">X</button>';
  row.appendChild(td);
  tbody.appendChild(row);

  // Recalculate workforce totals
  if (tableId === 'workforceTable') {
    row.querySelector('input[type="number"]').addEventListener('input', updateWorkforceTotals);
  }
}

// Attach remove-row to all tables via delegation
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('remove-row-btn')) {
    const row = e.target.closest('tr');
    if (row) row.remove();
  }
});

// ========== WORKFORCE TABLE ==========

function buildWorkforceTable() {
  const tbody = document.querySelector('#workforceTable tbody');
  tbody.innerHTML = '';
  currentLaborTypes.forEach(lt => {
    const row = document.createElement('tr');
    row.innerHTML =
      '<td>' + lt + '</td>' +
      '<td><input type="number" class="wf-planned" value="0" min="0"></td>' +
      '<td><input type="number" class="wf-available" value="0" min="0"></td>' +
      '<td><input type="text" class="wf-comments" placeholder="Block allocation notes"></td>' +
      '<td><button type="button" class="btn-sm remove-row-btn" style="background:var(--danger)">X</button></td>';
    row.querySelector('.wf-planned').addEventListener('input', updateWorkforceTotals);
    row.querySelector('.wf-available').addEventListener('input', updateWorkforceTotals);
    tbody.appendChild(row);
  });
  updateWorkforceTotals();
}

function updateWorkforceTotals() {
  let pTotal = 0, aTotal = 0;
  document.querySelectorAll('#workforceTable .wf-planned').forEach(i => pTotal += parseFloat(i.value) || 0);
  document.querySelectorAll('#workforceTable .wf-available').forEach(i => aTotal += parseFloat(i.value) || 0);
  document.getElementById('wfPlannedTotal').textContent = pTotal;
  document.getElementById('wfAvailTotal').textContent = aTotal;
}

// ========== PERFORMANCE ROWS ==========

function loadPerformanceRows(site) {
  const container = document.getElementById('performanceContainer');
  container.innerHTML = '';
  if (!currentBlocks.length) {
    container.innerHTML = '<p class="hint">Select a site first to load performance rows.</p>';
    return;
  }
  const table = document.createElement('table');
  table.id = 'perfTable';
  table.innerHTML = '<thead><tr><th>Block</th><th>Daily Target Achievement %</th><th>Status</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  currentBlocks.forEach(b => {
    const row = document.createElement('tr');
    row.innerHTML =
      '<td>' + b.name + ' (' + b.id + ')</td>' +
      '<td><input type="number" class="perf-target" data-block="' + b.id + '" min="0" max="100" value="0"></td>' +
      '<td><select class="perf-status" data-block="' + b.id + '">' +
        '<option>On Track</option><option>Slightly Delayed</option><option>Significantly Delayed</option><option>Critical</option>' +
      '</select></td>';
    tbody.appendChild(row);
  });
  container.appendChild(table);
}

// ========== PHOTOS ==========

function onPhotosSelected(e) {
  const files = e.target.files;
  const preview = document.getElementById('photoPreview');
  const metaContainer = document.getElementById('photoMetaContainer');
  preview.innerHTML = '';
  metaContainer.innerHTML = '';

  Array.from(files).forEach((file, idx) => {
    // Preview
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    preview.appendChild(img);

    // Meta form
    const metaItem = document.createElement('div');
    metaItem.className = 'photo-meta-item';
    metaItem.innerHTML =
      '<img src="' + img.src + '">' +
      '<div class="meta-fields">' +
        '<label>Block <select class="photo-block">' + (blockOptionsHTML || '<option value="">--</option>') + '</select></label>' +
        '<label>Caption <input type="text" class="photo-caption" placeholder="Describe this photo"></label>' +
      '</div>';
    metaContainer.appendChild(metaItem);
  });
}

// ========== FORM SUBMISSION ==========

function handleSubmit(e) {
  e.preventDefault();
  const site = document.getElementById('siteSelect').value;
  if (!site) { showStatus('Please select a site.', 'error'); return; }

  const photosInput = document.getElementById('photos');
  const photoFiles = editingReportId ? [] : Array.from(photosInput.files || []);

  // Collect block statuses
  const blockStatuses = [];
  document.querySelectorAll('.block-status-item').forEach(item => {
    const sel = item.querySelector('.bs-status');
    const target = item.querySelector('.bs-target');
    if (sel) {
      blockStatuses.push({
        blockName: sel.dataset.block,
        blockStatus: sel.value,
        targetAchievement: target ? target.value + '%' : '0%',
        performanceStatus: getPerformanceStatus(sel.value, target ? parseInt(target.value) : 0)
      });
    }
  });

  // Collect work progress
  const workProgress = [];
  document.querySelectorAll('#wpTable tbody tr, #workProgressContainer table tbody tr').forEach(row => {
    const block = row.querySelector('.wp-block')?.value || '';
    const taskName = row.querySelector('.wp-taskname')?.value || (row.children[1]?.textContent?.trim() || '');
    const unit = row.querySelector('.wp-unit')?.value || (row.children[2]?.textContent?.trim() || '');
    const plannedQty = parseFloat(row.querySelector('.wp-planned')?.value) || 0;
    const executedQty = parseFloat(row.querySelector('.wp-executed')?.value) || 0;
    const dailyCompletion = plannedQty > 0 ? Math.round((executedQty / plannedQty) * 100) : 0;
    const cumulative = parseFloat(row.querySelector('.wp-cumulative')?.value) || 0;
    const remarks = row.querySelector('.wp-remarks')?.value || '';
    workProgress.push({ block, taskName, unit, plannedQty, executedQty, dailyCompletion, cumulativeExecuted: cumulative, overallCompletion: 0, remarks });
  });

  // Collect workforce
  const workforce = [];
  document.querySelectorAll('#workforceTable tbody tr').forEach(row => {
    const laborType = row.children[0]?.textContent?.trim() || '';
    const planned = parseFloat(row.querySelector('.wf-planned')?.value) || 0;
    const available = parseFloat(row.querySelector('.wf-available')?.value) || 0;
    const comments = row.querySelector('.wf-comments')?.value || '';
    workforce.push({ laborType, planned, available, comments });
  });

  // Collect equipment
  const equipment = [];
  document.querySelectorAll('#equipmentTable tbody tr').forEach(row => {
    equipment.push({
      equipmentType: row.children[0]?.querySelector('input')?.value || row.children[0]?.querySelector('select')?.value || '',
      quantity: parseFloat(row.children[1]?.querySelector('input')?.value) || 0,
      workingCondition: row.children[2]?.querySelector('input')?.value || row.children[2]?.querySelector('select')?.value || '',
      comments: row.children[3]?.querySelector('input')?.value || ''
    });
  });

  // Collect materials delivered
  const materialsDelivered = [];
  document.querySelectorAll('#matDeliveredTable tbody tr').forEach(row => {
    materialsDelivered.push({
      description: row.children[0]?.querySelector('input')?.value || '',
      unit: row.children[1]?.querySelector('input')?.value || '',
      quantity: parseFloat(row.children[2]?.querySelector('input')?.value) || 0,
      allocatedBlock: row.children[3]?.querySelector('input')?.value || row.children[3]?.querySelector('select')?.value || ''
    });
  });

  // Collect materials on site
  const materialsOnSite = [];
  document.querySelectorAll('#matOnSiteTable tbody tr').forEach(row => {
    materialsOnSite.push({
      description: row.children[0]?.querySelector('input')?.value || '',
      unit: row.children[1]?.querySelector('input')?.value || '',
      quantity: parseFloat(row.children[2]?.querySelector('input')?.value) || 0,
      allocatedBlock: row.children[3]?.querySelector('input')?.value || row.children[3]?.querySelector('select')?.value || ''
    });
  });

  // Collect issues
  const issues = [];
  document.querySelectorAll('#issuesTable tbody tr').forEach(row => {
    issues.push({
      block: row.children[0]?.querySelector('input')?.value || row.children[0]?.querySelector('select')?.value || '',
      issueDetails: row.children[1]?.querySelector('input')?.value || ''
    });
  });

  // Collect tests
  const tests = [];
  document.querySelectorAll('#testsTable tbody tr').forEach(row => {
    tests.push({
      test: row.children[0]?.querySelector('input')?.value || '',
      block: row.children[1]?.querySelector('input')?.value || row.children[1]?.querySelector('select')?.value || '',
      result: row.children[2]?.querySelector('input')?.value || ''
    });
  });

  // Collect correspondences
  const correspondences = [];
  document.querySelectorAll('#correspondencesTable tbody tr').forEach(row => {
    correspondences.push({
      date: row.children[0]?.querySelector('input')?.value || '',
      from: row.children[1]?.querySelector('input')?.value || '',
      to: row.children[2]?.querySelector('input')?.value || '',
      subject: row.children[3]?.querySelector('input')?.value || ''
    });
  });

  // Collect safety
  const safetyIssues = [];
  document.querySelectorAll('#safetyTable tbody tr').forEach(row => {
    safetyIssues.push({
      issue: row.children[0]?.querySelector('input')?.value || '',
      block: row.children[1]?.querySelector('input')?.value || row.children[1]?.querySelector('select')?.value || '',
      actionTaken: row.children[2]?.querySelector('input')?.value || ''
    });
  });

  // Collect stakeholders
  const stakeholders = [];
  document.querySelectorAll('#stakeholderTable tbody tr').forEach(row => {
    stakeholders.push({
      stakeholder: row.children[0]?.querySelector('input')?.value || '',
      contribution: row.children[1]?.querySelector('input')?.value || ''
    });
  });

  // Collect site orders
  const siteOrders = [];
  document.querySelectorAll('#siteOrdersTable tbody tr').forEach(row => {
    siteOrders.push({
      orderNo: row.children[0]?.querySelector('input')?.value || '',
      issuedTo: row.children[1]?.querySelector('input')?.value || '',
      instruction: row.children[2]?.querySelector('input')?.value || '',
      deadline: row.children[3]?.querySelector('input')?.value || ''
    });
  });

  // Collect performance
  const performance = [];
  document.querySelectorAll('#perfTable tbody tr').forEach(row => {
    const target = row.querySelector('.perf-target');
    const status = row.querySelector('.perf-status');
    if (target) {
      performance.push({
        block: target.dataset.block || '',
        dailyTargetAchievement: target.value + '%',
        status: status ? status.value : ''
      });
    }
  });

  // Build payload
  const payload = {
    action: 'submitDailyReport',
    site: site,
    reportDate: document.getElementById('reportDate').value,
    weatherAM: document.getElementById('weatherAM').value,
    weatherPM: document.getElementById('weatherPM').value,
    residentEngineer: document.getElementById('reName').value,
    activitySummary: document.getElementById('activitySummary').value,
    resourceEfficiency: document.getElementById('resourceEfficiency').value,
    recommendations: document.getElementById('recommendations').value,
    holdPointRequests: document.getElementById('holdPointRequests').value,
    blockStatuses: blockStatuses,
    workProgress: workProgress,
    workforce: workforce,
    equipment: equipment,
    materialsDelivered: materialsDelivered,
    materialsOnSite: materialsOnSite,
    issues: issues,
    tests: tests,
    correspondences: correspondences,
    safetyIssues: safetyIssues,
    stakeholders: stakeholders,
    siteOrders: siteOrders,
    performance: performance,
    photos: []
  };

  // Upload photos first if any
  if (photoFiles.length > 0) {
    showStatus('Uploading photos...', 'success');
    const photoPromises = photoFiles.map((file, idx) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
          const block = document.querySelectorAll('.photo-block')[idx]?.value || '';
          const caption = document.querySelectorAll('.photo-caption')[idx]?.value || '';
          payload.photos.push({
            data: e.target.result.split(',')[1],
            mimeType: file.type,
            fileName: file.name,
            block: block,
            caption: caption
          });
          resolve();
        };
        reader.readAsDataURL(file);
      });
    });
    Promise.all(photoPromises).then(() => {
      sendReport(payload);
    });
  } else {
    sendReport(payload);
  }
}

function sendReport(payload) {
  showStatus('Submitting report...', 'success');
  fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showStatus('Report submitted successfully! ID: ' + data.reportId, 'success');
        clearDraft();
        if (!editingReportId) {
          document.getElementById('dailyForm').reset();
          document.getElementById('reportDate').valueAsDate = new Date();
          document.getElementById('reName').value = sessionStorage.getItem('hdcre_user') || '';
          document.getElementById('blockStatusContainer').innerHTML = '';
          document.getElementById('workProgressContainer').innerHTML = '<p class="hint">Select a site first to load blocks and scheduled tasks.</p>';
          document.getElementById('performanceContainer').innerHTML = '<p class="hint">Performance rows load with block statuses.</p>';
          document.getElementById('photoPreview').innerHTML = '';
          document.getElementById('photoMetaContainer').innerHTML = '';
        }
        editingReportId = null;
        document.getElementById('editModeBanner').classList.add('hidden');
        document.getElementById('cancelEditBtn').classList.add('hidden');
        document.getElementById('submitBtn').textContent = 'Submit Daily Report';
      } else {
        showStatus('Error: ' + (data.error || 'Submission failed.'), 'error');
      }
    })
    .catch(() => {
      showStatus('Network error. Please try again.', 'error');
    });
}

function getPerformanceStatus(status, target) {
  if (status === 'Completed') return 'Completed';
  if (status === 'Critical' || target < 50) return 'Critical';
  if (status === 'Delayed' || target < 80) return 'Delayed';
  return 'On Track';
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}

// ========== MY REPORTS ==========

function loadMyReports() {
  const user = sessionStorage.getItem('hdcre_user');
  const container = document.getElementById('myReportsContent');
  container.innerHTML = '<p class="hint">Loading reports...</p>';
  fetch(API_BASE + '?endpoint=reports')
    .then(r => r.json())
    .then(data => {
      allReports = (data.reports || []).filter(r => r.residentEngineer === user);
      if (allReports.length === 0) {
        container.innerHTML = '<p class="hint">No reports found for your account.</p>';
        return;
      }
      let html = '<table class="reports-list-table"><thead><tr><th>Date</th><th>Site</th><th>Status</th><th>ID</th><th>Actions</th></tr></thead><tbody>';
      allReports.forEach(r => {
        html += '<tr>' +
          '<td>' + r.reportDate + '</td>' +
          '<td>' + r.site + '</td>' +
          '<td><span class="badge ' + r.approvalStatus + '">' + r.approvalStatus + '</span></td>' +
          '<td>' + r.reportId + '</td>' +
          '<td><button class="btn-sm view-report-btn" data-id="' + r.reportId + '">View</button></td>' +
          '</tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;

      // View buttons
      container.querySelectorAll('.view-report-btn').forEach(btn => {
        btn.addEventListener('click', () => viewReport(btn.dataset.id));
      });
    });
}

function viewReport(reportId) {
  const modal = document.getElementById('reportViewModal');
  const content = document.getElementById('reportViewContent');
  content.innerHTML = '<p class="hint">Loading report...</p>';
  modal.classList.remove('hidden');

  fetch(API_BASE + '?endpoint=reportDetail&reportId=' + encodeURIComponent(reportId))
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        content.innerHTML = '<p style="color:var(--danger)">' + data.error + '</p>';
        return;
      }
      let html = '';
      html += '<div class="detail-section"><h4>Report Info</h4>';
      html += '<div class="meta-grid">';
      html += '<span class="label">ID:</span><span>' + data.reportId + '</span>';
      html += '<span class="label">Date:</span><span>' + data.reportDate + '</span>';
      html += '<span class="label">Site:</span><span>' + data.site + '</span>';
      html += '<span class="label">RE:</span><span>' + data.residentEngineer + '</span>';
      html += '<span class="label">Weather:</span><span>' + data.weatherAM + ' / ' + data.weatherPM + '</span>';
      html += '<span class="label">Status:</span><span class="badge ' + data.approvalStatus + '">' + data.approvalStatus + '</span>';
      html += '</div></div>';

      html += '<div class="detail-section"><h4>Activity Summary</h4><p>' + (data.activitySummary || 'N/A') + '</p></div>';

      if (data.blockStatuses && data.blockStatuses.length) {
        html += '<div class="detail-section"><h4>Block Status</h4><table><tr><th>Block</th><th>Status</th><th>Target</th></tr>';
        data.blockStatuses.forEach(b => { html += '<tr><td>' + b.blockName + '</td><td>' + b.blockStatus + '</td><td>' + b.targetAchievement + '</td></tr>'; });
        html += '</table></div>';
      }

      if (data.workProgress && data.workProgress.length) {
        html += '<div class="detail-section"><h4>Work Progress</h4><table><tr><th>Block</th><th>Task</th><th>Planned</th><th>Executed</th><th>Daily %</th></tr>';
        data.workProgress.forEach(w => { html += '<tr><td>' + w.block + '</td><td>' + w.taskName + '</td><td>' + w.plannedQty + '</td><td>' + w.executedQty + '</td><td>' + w.dailyCompletion + '%</td></tr>'; });
        html += '</table></div>';
      }

      if (data.workforce && data.workforce.length) {
        html += '<div class="detail-section"><h4>Workforce</h4><table><tr><th>Type</th><th>Planned</th><th>Available</th></tr>';
        data.workforce.forEach(w => { html += '<tr><td>' + w.laborType + '</td><td>' + w.planned + '</td><td>' + w.available + '</td></tr>'; });
        html += '</table></div>';
      }

      if (data.equipment && data.equipment.length) {
        html += '<div class="detail-section"><h4>Equipment</h4><table><tr><th>Type</th><th>Qty</th><th>Condition</th></tr>';
        data.equipment.forEach(e => { html += '<tr><td>' + e.equipmentType + '</td><td>' + e.quantity + '</td><td>' + e.workingCondition + '</td></tr>'; });
        html += '</table></div>';
      }

      if (data.materials && data.materials.length) {
        html += '<div class="detail-section"><h4>Materials</h4><table><tr><th>Desc</th><th>Unit</th><th>Qty</th><th>Type</th><th>Block</th></tr>';
        data.materials.forEach(m => { html += '<tr><td>' + m.description + '</td><td>' + m.unit + '</td><td>' + m.quantity + '</td><td>' + m.type + '</td><td>' + m.allocatedBlock + '</td></tr>'; });
        html += '</table></div>';
      }

      if (data.issues && data.issues.length) {
        html += '<div class="detail-section"><h4>Issues</h4><table><tr><th>Block</th><th>Details</th></tr>';
        data.issues.forEach(i => { html += '<tr><td>' + i.block + '</td><td>' + i.issueDetails + '</td></tr>'; });
        html += '</table></div>';
      }

      if (data.performance && data.performance.length) {
        html += '<div class="detail-section"><h4>Performance</h4><table><tr><th>Block</th><th>Target</th><th>Status</th></tr>';
        data.performance.forEach(p => { html += '<tr><td>' + p.block + '</td><td>' + p.dailyTargetAchievement + '</td><td>' + p.status + '</td></tr>'; });
        html += '</table>';
        html += '<p><strong>Efficiency:</strong> ' + (data.resourceEfficiency || 'N/A') + '</p>';
        html += '<p><strong>Recommendations:</strong> ' + (data.recommendations || 'N/A') + '</p>';
        html += '</div>';
      }

      if (data.photos && data.photos.length) {
        html += '<div class="detail-section"><h4>Photos</h4><div class="photo-grid">';
        data.photos.forEach(p => {
          if (p.photoUrl) html += '<div><img src="' + p.photoUrl + '" alt="' + (p.caption || '') + '"><br><small>' + (p.caption || '') + ' - ' + (p.block || '') + '</small></div>';
        });
        html += '</div></div>';
      }

      if (data.directorComments) {
        html += '<div class="detail-section"><h4>Director Comments</h4><p>' + data.directorComments + '</p></div>';
      }

      content.innerHTML = html;
    });
}

// ========== EDIT REPORT ==========

function cancelEdit() {
  editingReportId = null;
  document.getElementById('dailyForm').reset();
  document.getElementById('reportDate').valueAsDate = new Date();
  document.getElementById('reName').value = sessionStorage.getItem('hdcre_user') || '';
  document.getElementById('editModeBanner').classList.add('hidden');
  document.getElementById('cancelEditBtn').classList.add('hidden');
  document.getElementById('submitBtn').textContent = 'Submit Daily Report';
  document.getElementById('photoSectionNote').classList.add('hidden');
}

// ========== DRAFT ==========

function saveDraft() {
  const site = document.getElementById('siteSelect').value;
  if (!site) return;
  try {
    const formData = {
      weatherAM: document.getElementById('weatherAM').value,
      weatherPM: document.getElementById('weatherPM').value,
      activitySummary: document.getElementById('activitySummary').value,
      resourceEfficiency: document.getElementById('resourceEfficiency').value,
      recommendations: document.getElementById('recommendations').value,
      holdPointRequests: document.getElementById('holdPointRequests').value
    };
    const key = 'hdcre_draft_' + site + '_' + document.getElementById('reportDate').value;
    localStorage.setItem(key, JSON.stringify(formData));
    localStorage.setItem('hdcre_draft_key', key);
  } catch (e) {}
}

function checkForDraft() {
  try {
    const key = localStorage.getItem('hdcre_draft_key');
    if (!key) return;
    const data = JSON.parse(localStorage.getItem(key));
    if (!data) return;
    const banner = document.getElementById('draftBanner');
    banner.innerHTML = 'Draft found for ' + key.replace('hdcre_draft_', '') + '. <a href="#" id="restoreDraft">Click to restore</a> or <a href="#" id="clearDraft">dismiss</a>.';
    banner.classList.remove('hidden');
    document.getElementById('restoreDraft').addEventListener('click', function(e) {
      e.preventDefault();
      if (data.weatherAM) document.getElementById('weatherAM').value = data.weatherAM;
      if (data.weatherPM) document.getElementById('weatherPM').value = data.weatherPM;
      if (data.activitySummary) document.getElementById('activitySummary').value = data.activitySummary;
      if (data.resourceEfficiency) document.getElementById('resourceEfficiency').value = data.resourceEfficiency;
      if (data.recommendations) document.getElementById('recommendations').value = data.recommendations;
      if (data.holdPointRequests) document.getElementById('holdPointRequests').value = data.holdPointRequests;
      banner.classList.add('hidden');
    });
    document.getElementById('clearDraft').addEventListener('click', function(e) {
      e.preventDefault();
      clearDraft();
      banner.classList.add('hidden');
    });
  } catch (e) {}
}

function clearDraft() {
  try {
    const key = localStorage.getItem('hdcre_draft_key');
    if (key) localStorage.removeItem(key);
    localStorage.removeItem('hdcre_draft_key');
  } catch (e) {}
}
