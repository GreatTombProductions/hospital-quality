// Hospital Quality Check — Frontend
// Hospital name search + state browse + MD5 detail shards

const DATA_BASE = "data/";
const INDEX_DIR = DATA_BASE + "indices/name/";
const STATE_DIR = DATA_BASE + "indices/state/";
const DETAIL_DIR = DATA_BASE + "detail/";
const NUM_SHARDS = 256;

let currentMode = "search";
let stateSummary = null;
let stateCache = {};

// ── Mode switching ──

function setMode(mode) {
  currentMode = mode;
  document.getElementById("mode-search").classList.toggle("active", mode === "search");
  document.getElementById("mode-state").classList.toggle("active", mode === "state");
  document.getElementById("search-section").style.display = mode === "search" ? "block" : "none";
  document.getElementById("state-section").style.display = mode === "state" ? "block" : "none";
  hideDetail();

  if (mode === "state" && !stateSummary) {
    loadStateSummary();
  }
}

// ── Stars helper ──

function renderStars(rating) {
  if (rating === null || rating === undefined) return '<span style="color:var(--text2);font-size:0.85em">N/A</span>';
  let s = "";
  for (let i = 1; i <= 5; i++) {
    s += i <= rating ? "★" : "☆";
  }
  return `<span class="stars">${s}</span>`;
}

function ratingClass(r) {
  if (r === null || r === undefined) return "";
  if (r >= 4) return "good";
  if (r >= 3) return "warn";
  return "bad";
}

// ── Abbreviate hospital type ──

function abbrevType(t) {
  if (!t) return "";
  return t.replace("Acute Care Hospitals", "Acute Care")
          .replace("Critical Access Hospitals", "Critical Access")
          .replace("Acute Care - Veterans Administration", "VA Hospital")
          .replace("Acute Care - Department of Defense", "DoD Hospital")
          .replace("Rural Emergency Hospital", "Rural ER");
}

// ── Search ──

async function handleSearch() {
  const q = document.getElementById("search-input").value.trim();
  if (q.length < 1) {
    document.getElementById("search-results").innerHTML = "";
    return;
  }

  const firstChar = q[0].toUpperCase();
  const letter = /[A-Z]/.test(firstChar) ? firstChar : "other";

  try {
    const resp = await fetch(INDEX_DIR + letter + ".json");
    if (!resp.ok) {
      document.getElementById("search-results").innerHTML = '<div class="no-results">No hospitals found</div>';
      return;
    }
    const hospitals = await resp.json();

    const qLower = q.toLowerCase();
    const filtered = hospitals.filter(h =>
      (h.n + " " + h.s + " " + abbrevType(h.t)).toLowerCase().includes(qLower)
    ).slice(0, 50);

    if (filtered.length === 0) {
      document.getElementById("search-results").innerHTML = '<div class="no-results">No hospitals matching "' + escapeHtml(q) + '"</div>';
      return;
    }

    document.getElementById("search-results").innerHTML = filtered.map(h => resultItemHTML(h)).join("");
  } catch (e) {
    document.getElementById("search-results").innerHTML = '<div class="loading">Error loading results</div>';
  }
}

function resultItemHTML(h) {
  let badges = [];
  if (h.e) badges.push('<span class="badge badge-er">ER</span>');
  if (h.b) badges.push('<span class="badge badge-birth">Birthing</span>');

  return `
    <div class="result-item" onclick="showDetail('${h._md5}')">
      <div class="info">
        <div class="name">${escapeHtml(h.n)}</div>
        <div class="location">${escapeHtml(abbrevType(h.t))} · ${escapeHtml(h.s)}</div>
      </div>
      <div class="badges">
        ${renderStars(h.r)}
        ${badges.join("")}
      </div>
    </div>`;
}

// ── State browse ──

async function loadStateSummary() {
  try {
    const resp = await fetch(STATE_DIR + "_summary.json");
    stateSummary = await resp.json();
    renderStateList();
  } catch (e) {
    document.getElementById("state-list").innerHTML = '<div class="loading">Error loading states</div>';
  }
}

function renderStateList() {
  if (!stateSummary) return;

  // Sort by hospital count descending
  const states = Object.entries(stateSummary).sort((a, b) => b[1].hc - a[1].hc);

  document.getElementById("state-list").innerHTML = states.map(([st, info]) => {
    const avgStars = info.ar > 0 ? info.ar.toFixed(1) + " ★" : "N/A";
    return `
      <div class="state-card" onclick="loadStateHospitals('${st}')">
        <div class="st-name">${info.n || st} <span style="color:var(--text2);font-weight:400;font-size:0.85em">${info.hc} hospitals</span></div>
        <div class="st-stats">
          <span>Avg Rating: ${avgStars}</span>
          <span>Rated: ${info.rc}/${info.hc}</span>
          <span>ER: ${info.er}</span>
        </div>
      </div>`;
  }).join("");
}

async function loadStateHospitals(st) {
  if (stateCache[st]) {
    renderStateHospitals(st, stateCache[st]);
    return;
  }

  try {
    const resp = await fetch(STATE_DIR + st + ".json");
    const hospitals = await resp.json();
    stateCache[st] = hospitals;
    renderStateHospitals(st, hospitals);
  } catch (e) {
    document.getElementById("state-hospitals").innerHTML = '<div class="loading">Error loading hospitals for ' + st + '</div>';
  }
}

function renderStateHospitals(st, hospitals) {
  document.getElementById("state-list").style.display = "none";
  const el = document.getElementById("state-hospitals");
  el.style.display = "block";
  const info = stateSummary[st];
  const stateName = info ? info.n : st;
  el.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="back" onclick="document.getElementById('state-list').style.display='';document.getElementById('state-hospitals').style.display='none';">← Back to states</button>
      <h3 style="margin-bottom:4px">${stateName} — ${hospitals.length} hospitals</h3>
      <div style="font-size:0.85em;color:var(--text2)">Ranked by CMS star rating (highest first)</div>
    </div>
    ${hospitals.map(h => resultItemHTML(h)).join("")}`;
}

// ── Detail view ──

async function showDetail(md5) {
  const shardId = parseInt(md5.substring(0, 2), 16) % NUM_SHARDS;
  const shardHex = shardId.toString(16).padStart(2, "0");

  const panel = document.getElementById("detail-panel");
  panel.innerHTML = '<div class="loading">Loading...</div>';
  panel.classList.add("active");
  panel.scrollIntoView({ behavior: "smooth" });

  try {
    const resp = await fetch(DETAIL_DIR + shardHex + ".json");
    const shard = await resp.json();
    const h = shard[md5];

    if (!h) {
      panel.innerHTML = '<div class="loading">Hospital not found</div>';
      return;
    }

    panel.innerHTML = detailHTML(h);
  } catch (e) {
    panel.innerHTML = '<div class="loading">Error loading hospital details</div>';
  }
}

function hideDetail() {
  document.getElementById("detail-panel").classList.remove("active");
}

function detailHTML(h) {
  const r = h.r;
  const rCls = ratingClass(r);
  const ratingLabel = r !== null ? r + " out of 5 stars" : "Not Rated";

  // Tags
  let tags = [];
  tags.push(`<span class="tag">${escapeHtml(h.t)}</span>`);
  tags.push(`<span class="tag">${escapeHtml(h.ow)}</span>`);
  if (h.er) tags.push('<span class="tag yes">✓ Emergency Services</span>');
  else tags.push('<span class="tag no">No ER</span>');
  if (h.bi) tags.push('<span class="tag yes">✓ Birthing Friendly</span>');

  // Mortality bar
  const mortTotal = h.mc || 0;
  const mortBetterPct = mortTotal > 0 ? (h.mb / mortTotal * 100) : 0;
  const mortWorsePct = mortTotal > 0 ? (h.mw / mortTotal * 100) : 0;
  const mortSamePct = 100 - mortBetterPct - mortWorsePct;

  // Safety bar
  const safTotal = h.sc || 0;
  const safBetterPct = safTotal > 0 ? (h.sb / safTotal * 100) : 0;
  const safWorsePct = safTotal > 0 ? (h.sw / safTotal * 100) : 0;
  const safSamePct = 100 - safBetterPct - safWorsePct;

  // Readmission bar
  const readmTotal = h.rc || 0;
  const readmBetterPct = readmTotal > 0 ? (h.rb / readmTotal * 100) : 0;
  const readmWorsePct = readmTotal > 0 ? (h.rw / readmTotal * 100) : 0;
  const readmSamePct = 100 - readmBetterPct - readmWorsePct;

  function barRow(label, total, betterPct, worsePct, samePct, betterCount, worseCount) {
    if (total === 0) {
      return `<div class="bar-row">
        <div class="label">${label}</div>
        <div class="bar-track"><span style="color:var(--text2);font-size:0.78em;padding:0 8px">No data</span></div>
        <div class="count"></div>
      </div>`;
    }
    return `<div class="bar-row">
      <div class="label">${label}</div>
      <div class="bar-track">
        ${betterPct > 0 ? `<div class="bar-seg" style="width:${betterPct}%;background:var(--good)" title="${betterCount} better"></div>` : ""}
        ${samePct > 0 ? `<div class="bar-seg" style="width:${samePct}%;background:#404060" title="same as national"></div>` : ""}
        ${worsePct > 0 ? `<div class="bar-seg" style="width:${worsePct}%;background:var(--bad)" title="${worseCount} worse"></div>` : ""}
      </div>
      <div class="count">${total} meas.</div>
    </div>`;
  }

  // Overall quality verdict
  let qualityVerdict = "";
  if (r === null) {
    qualityVerdict = "Not enough data for CMS rating";
  } else if (r >= 4) {
    qualityVerdict = "Above average — " + r + " out of 5 stars";
  } else if (r >= 3) {
    qualityVerdict = "Average — " + r + " out of 5 stars";
  } else {
    qualityVerdict = "Below average — " + r + " out of 5 stars";
  }

  return `
    <button class="back" onclick="hideDetail()">← Back to results</button>
    <h2>${escapeHtml(h.n)}</h2>
    <div class="subtitle">${escapeHtml(h.a)}, ${escapeHtml(h.c)}, ${escapeHtml(h.s)} ${escapeHtml(h.z)} · ${escapeHtml(h.co)} County${h.ph ? ' · ' + escapeHtml(h.ph) : ''}</div>

    <div class="big-rating">
      <div class="big-stars">${r !== null ? "★★★★★".slice(0, r) + "☆☆☆☆☆".slice(r) : "—"}</div>
      <div class="big-label">CMS Overall Hospital Rating — ${qualityVerdict}</div>
    </div>

    <div class="tags">${tags.join(" ")}</div>

    <div class="section"><h3>Quality Measure Groups — Compared to National Average</h3></div>

    ${barRow("Mortality / Death Rates", mortTotal, mortBetterPct, mortWorsePct, mortSamePct, h.mb, h.mw)}
    ${barRow("Safety / Complications", safTotal, safBetterPct, safWorsePct, safSamePct, h.sb, h.sw)}
    ${barRow("Readmission Rates", readmTotal, readmBetterPct, readmWorsePct, readmSamePct, h.rb, h.rw)}

    <div style="font-size:0.75em;color:var(--text2);margin-top:4px;margin-bottom:16px">
      <span style="color:var(--good)">■ Better than national</span> ·
      <span style="color:#404080">■ No different</span> ·
      <span style="color:var(--bad)">■ Worse than national</span>
    </div>

    <div class="section"><h3>Measure Counts</h3></div>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="big">${h.tm || 0}</div>
        <div class="small">Total Measures Tracked</div>
      </div>
      <div class="metric-card">
        <div class="big good">${h.tb || 0}</div>
        <div class="small">Better Than National</div>
      </div>
      <div class="metric-card">
        <div class="big bad">${h.tw || 0}</div>
        <div class="small">Worse Than National</div>
      </div>
      <div class="metric-card">
        <div class="big">${h.mc || 0}</div>
        <div class="small">Mortality Measures</div>
      </div>
      <div class="metric-card">
        <div class="big">${h.sc || 0}</div>
        <div class="small">Safety Measures</div>
      </div>
      <div class="metric-card">
        <div class="big">${h.rc || 0}</div>
        <div class="small">Readmission Measures</div>
      </div>
      <div class="metric-card">
        <div class="big">${h.pc || 0}</div>
        <div class="small">Patient Experience</div>
      </div>
      <div class="metric-card">
        <div class="big">${h.tc || 0}</div>
        <div class="small">Timely & Effective</div>
      </div>
    </div>

    <div class="source-note" style="margin-top:20px;padding:10px">
      CMS star ratings are based on quality measures across 5 groups: Mortality, Safety, Readmission, Patient Experience, and Timely & Effective Care.
      "Better/Worse than national" means the hospital's rate is statistically significantly different from the national rate.
      Data from CMS Provider Data. Updated quarterly. Not all hospitals have enough data for every measure.
    </div>
  `;
}

// ── Utils ──

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("search-input").focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== document.getElementById("search-input")) {
    e.preventDefault();
    document.getElementById("search-input").focus();
  }
  if (e.key === "Escape") {
    hideDetail();
    document.getElementById("search-input").focus();
  }
});
