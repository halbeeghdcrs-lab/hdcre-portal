const API_BASE = 'https://script.google.com/macros/s/AKfycbx14uKC7ZyT991b3jltKDa_a33_cIKFADBzZYeCXsAszlPbsS8-gA2-5hAXTlzJodUl/exec';  // ⚠️ Replace with your real deployment URL
let currentSiteMeta = null;
const laborTypes = ['Mason','Laborer','Carpenter','Electrician','Plumber','Steel fixer','Operator','Driver','Painter','Other'];

document.addEventListener('DOMContentLoaded', async () => {
  await loadSites();
  populateWorkforceTable();
  setupAddButtons();
  document.getElementById('dailyForm').addEventListener('submit', handleSubmit);
});

// ---------- SITE & TASK MANAGEMENT ----------
async function loadSites() {
  try {
    const res = await fetch(`${API_BASE}?endpoint=sites`);
    const sites = await res.json();
    const select = document.getElementById('siteSelect');
    select.innerHTML = '';
    sites.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
    if (sites.length > 0) {
      select.value = sites[0].name;
      onSiteChange();
    }
    select.addEventListener('change', onSiteChange);
  } catch (e) {
    console.error('Failed to load sites', e);
    alert('Could not load sites. Check connection.');
  }
}

async function onSiteChange() {
  const site = document.getElementById('siteSelect').value;
  try {
    const res = await fetch(`${API_BASE}?endpoint=sites`);
    const allSites = await res.json();
    currentSiteMeta = allSites.find(s => s.name === site);
    if (currentSiteMeta && currentSiteMeta.hasMasterSchedule) {
      const tasks = await fetchTasks(site);
      buildDropdownTaskTable(tasks);
    } else {
      buildFreeTextTaskTable();
    }
  } catch (e) {
    console.error(e);
    buildFreeTextTaskTable();
  }
}

async function fetchTasks(site) {
  const url = `${API_BASE}?endpoint=tasks&site=${encodeURIComponent(site)}`;
  console.log('Fetching tasks for site:', site);
  console.log('Full URL:', url);
  const res = await fetch(url);
  const data = await res.json();
  console.log('Tasks received:', data);
  return data;
}

// ---------- TASK TABLE BUILDERS (with Unit column) ----------
function buildDropdownTaskTable(tasks) {
  const container = document.getElementById('taskTableContainer');
  let html = `<table><thead><tr><th>#</th><th>Task</th><th>Unit</th><th>Executed QTY</th><th>Remarks</th></tr></thead><tbody>`;
  for (let i = 1; i <= 10; i++) {
    html += `<tr>
      <td>${i}</td>
      <td><select class="taskDropdown" data-row="${i}">
        <option value="">-- Select --</option>`;
    tasks.forEach(t => {
      html += `<option value="${t}">${t}</option>`;
    });
    html += `</select></td>
      <td><input type="text" class="taskUnit" data-row="${i}" placeholder="e.g. m³"></td>
      <td><input type="number" class="taskQty" data-row="${i}" step="any"></td>
      <td><input type="text" class="taskRemark" data-row="${i}"></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

function buildFreeTextTaskTable() {
  const container = document.getElementById('taskTableContainer');
  let html = `<table><thead><tr><th>#</th><th>Task Description</th><th>Unit</th><th>Executed QTY</th><th>Remarks</th></tr></thead><tbody>`;
  for (let i = 1; i <= 10; i++) {
    html += `<tr>
      <td>${i}</td>
      <td><input type="text" class="taskDesc" data-row="${i}"></td>
      <td><input type="text" class="taskUnit" data-row="${i}" placeholder="e.g. m³"></td>
      <td><input type="number" class="taskQty" data-row="${i}" step="any"></td>
      <td><input type="text" class="taskRemark" data-row="${i}"></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ---------- WORKFORCE ----------
function populateWorkforceTable() {
  const tbody = document.querySelector('#workforceTable tbody');
  tbody.innerHTML = '';
  laborTypes.forEach(lt => {
    tbody.innerHTML += `<tr>
      <td>${lt}</td>
      <td><input type="number" class="wfPlanned" value="0"></td>
      <td><input type="number" class="wfAvailable" value="0"></td>
      <td><input type="text" class="wfComments"></td>
    </tr>`;
  });
}

// ---------- DYNAMIC ROW BUTTONS (DATA SAFE) ----------
function setupAddButtons() {
  document.getElementById('addEquipmentRow').addEventListener('click', () => {
    const tbody = document.querySelector('#equipmentTable tbody');
    const newRow = tbody.insertRow(); // does NOT erase existing rows
    newRow.innerHTML = `
      <td><input type="text"></td>
      <td><input type="text"></td>
      <td><input type="number" value="1"></td>
      <td><select><option>Good</option><option>Fair</option><option>Broken</option><option>Under Repair</option></select></td>
      <td><input type="text"></td>`;
  });

  document.getElementById('addMatDeliveredRow').addEventListener('click', () => {
    const tbody = document.querySelector('#matDeliveredTable tbody');
    const newRow = tbody.insertRow();
    newRow.innerHTML = `
      <td><input type="text"></td>
      <td><input type="text"></td>
      <td><input type="text"></td>
      <td><input type="number" step="any"></td>`;
  });

  document.getElementById('addMatOnSiteRow').addEventListener('click', () => {
    const tbody = document.querySelector('#matOnSiteTable tbody');
    const newRow = tbody.insertRow();
    newRow.innerHTML = `
      <td><input type="text"></td>
      <td><input type="text"></td>
      <td><input type="text"></td>
      <td><input type="number" step="any"></td>`;
  });
}

// ---------- DATA COLLECTION (NOW WITH UNIT) ----------
function collectTasks() {
  const rows = document.querySelectorAll('#taskTableContainer tbody tr');
  const tasks = [];
  rows.forEach(row => {
    let name = '';
    const sel = row.querySelector('select.taskDropdown');
    if (sel) name = sel.value;
    else {
      const inp = row.querySelector('input.taskDesc');
      if (inp) name = inp.value;
    }
    const unitEl = row.querySelector('input.taskUnit');
    const qtyEl = row.querySelector('input.taskQty');
    const remarkEl = row.querySelector('input.taskRemark');
    if (name && qtyEl && qtyEl.value) {
      tasks.push({
        name,
        unit: unitEl ? unitEl.value : '',
        executedQty: parseFloat(qtyEl.value),
        remark: remarkEl ? remarkEl.value : ''
      });
    }
  });
  return tasks;
}

function collectTableData(tableId, fields) {
  const rows = document.querySelectorAll(`${tableId} tbody tr`);
  const data = [];
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    const obj = {};
    fields.forEach((field, idx) => {
      const input = cells[idx]?.querySelector('input, select');
      obj[field] = input ? input.value : '';
    });
    // Only include if at least one field has a non‑default value
    if (Object.values(obj).some(v => v !== '' && v !== '0')) {
      data.push(obj);
    }
  });
  return data;
}

async function handleSubmit(e) {
  e.preventDefault();
  const photos = document.getElementById('photos').files;
  if (photos.length < 3) {
    alert('Please upload at least 3 photos.');
    return;
  }

  const report = {
    site: document.getElementById('siteSelect').value,
    reportDate: document.getElementById('reportDate').value,
    weatherAM: document.getElementById('weatherAM').value,
    weatherPM: document.getElementById('weatherPM').value,
    reName: document.getElementById('reName').value,
    activitySummary: document.getElementById('activitySummary').value,
    tasks: collectTasks(),
    workforce: collectTableData('#workforceTable', ['laborType','planned','available','comments']),
    equipment: collectTableData('#equipmentTable', ['eqId','type','qty','condition','comments']),
    materialsDelivered: collectTableData('#matDeliveredTable', ['matId','desc','unit','qty']),
    materialsOnSite: collectTableData('#matOnSiteTable', ['matId','desc','unit','qty']),
    hasIssues: document.getElementById('hasIssues').value,
    issueDesc: document.getElementById('issueDesc').value,
    photos: await readPhotosAsBase64(photos)
  };

  console.log('Submitting report:', report);

  try {
    const res = await fetch(`${API_BASE}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'submitReport', report })
    });
    const result = await res.json();
    if (result.success) {
      document.getElementById('status').innerText = 'Report submitted! Pending Director review.';
      document.getElementById('dailyForm').reset();
      onSiteChange();
    } else {
      document.getElementById('status').innerText = 'Error: ' + (result.message || 'Unknown');
    }
  } catch (err) {
    document.getElementById('status').innerText = 'Submission failed. Check connection.';
  }
}

function readPhotosAsBase64(fileList) {
  return Promise.all(Array.from(fileList).map(file => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ name: file.name, data: e.target.result });
      reader.readAsDataURL(file);
    });
  }));
}
