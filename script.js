// ══════════════════════════════════════════════════════════════════════════
//  eCFR Citation Retriever — script.js  v2.3 (light)
//  Cascading live dropdowns: Titles → Dates → Parts → Sections from eCFR API
//  Default: Title 10, Part 50, latest date — auto-cascades on load
// ══════════════════════════════════════════════════════════════════════════

const ECFR_BASE     = 'https://www.ecfr.gov/api/versioner/v1';
const DEFAULT_TITLE = '10';
const DEFAULT_PART  = '50';

// ── Cache ────────────────────────────────────────────────────────────────
let titlesData     = [];               // [{number, name, latest_amended_on, …}]
let versionsCache  = {};               // { titleNum: [date, date, …] }
let structureCache = {};               // { "title-date": structureJSON }

// ── Mode ─────────────────────────────────────────────────────────────────
let currentMode = 'section';

async function setMode(mode) {
    currentMode = mode;
    document.getElementById('sectionFields').style.display = mode === 'section' ? 'block' : 'none';
    document.getElementById('partFields').style.display    = mode === 'part'    ? 'block' : 'none';
    document.getElementById('diffFields').style.display    = mode === 'diff'    ? 'block' : 'none';
    ['Section','Part','Diff'].forEach(m =>
        document.getElementById('mode' + m).classList.toggle('active', m.toLowerCase() === mode)
    );
    // If titles are loaded, populate the title select then cascade dates → parts → sections.
    // Results are cached after the first fetch so switching modes is fast.
    if (titlesData.length) {
        populateTitleSelect(mode);
        await onTitleChange(mode);
    }
}

// ── API Status indicator ─────────────────────────────────────────────────
function setApiStatus(state, text) {
    const dot  = document.getElementById('apiDot');
    const label = document.getElementById('apiStatusText');
    dot.className   = 'api-dot ' + state;
    label.textContent = text;
}

// ── UI Helpers ───────────────────────────────────────────────────────────
function showLoading(on) {
    document.getElementById('loadingBar').classList.toggle('active', on);
}

function showError(msg) {
    const el = document.getElementById('errorBanner');
    if (msg) { el.innerHTML = `<span class="error-icon">⚠</span> ${msg}`; el.classList.add('active'); }
    else      { el.classList.remove('active'); }
}

function showToast(msg = 'Copied to clipboard') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        if (btn) { btn.textContent = 'Copied!'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000); }
        showToast();
    }).catch(() => showToast('Copy failed'));
}

// Spinner helpers on individual selects
function selSpinner(id, on) {
    const el = document.getElementById('spin-' + id);
    if (el) el.style.display = on ? 'block' : 'none';
}
function selDisable(id, on) {
    const el = document.getElementById(id);
    if (el) el.disabled = on;
}
function selSet(id, options, selectedVal) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    options.forEach(({ val, label }) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = label;
        if (String(val) === String(selectedVal)) o.selected = true;
        sel.appendChild(o);
    });
    sel.disabled = false;
}

// ── Latest-date tag ───────────────────────────────────────────────────────
function setLatestTag(tagId, date, isLatest) {
    const el = document.getElementById(tagId);
    if (!el) return;
    el.textContent = isLatest ? `✓ Latest: ${date}` : `Latest available: ${date}`;
    el.style.display = 'block';
}

// ── 1. Fetch all CFR Titles ──────────────────────────────────────────────
async function loadTitles() {
    setApiStatus('loading', 'Loading titles…');
    try {
        const res  = await fetch(`${ECFR_BASE}/titles.json`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        titlesData = data.titles || [];
        setApiStatus('ok', `${titlesData.length} titles loaded`);

        // Populate all three modes, then auto-cascade section mode with defaults
        populateTitleSelect('section');
        populateTitleSelect('part');
        populateTitleSelect('diff');

        // Auto-load Title 10 latest date + Part 50 on startup
        await onTitleChange('section');

    } catch (err) {
        setApiStatus('error', 'API unavailable');
        showError('Could not load CFR titles from eCFR API. Check your internet connection. ' + err.message);
    }
}

// ── 2. Populate Title select for a given mode ────────────────────────────
function populateTitleSelect(mode) {
    const prefix = { section: 's', part: 'p', diff: 'd' }[mode];
    const sel = document.getElementById(`${prefix}-title`);
    if (!sel) return;

    sel.innerHTML = '';

    titlesData.forEach(t => {
        const o = document.createElement('option');
        o.value = t.number;
        o.textContent = `Title ${t.number} — ${t.name}`;
        if (String(t.number) === DEFAULT_TITLE) o.selected = true;
        sel.appendChild(o);
    });
    sel.disabled = false;
}

// ── 3. Title changed → load versions (dates) + structure ────────────────
async function onTitleChange(mode) {
    const prefix = { section: 's', part: 'p', diff: 'd' }[mode];
    const titleNum = document.getElementById(`${prefix}-title`)?.value;
    if (!titleNum) return;

    // Reset downstream selects
    if (mode === 'section') {
        resetSelect('s-date',    '— loading dates… —');
        resetSelect('s-part',    '— select date first —');
        resetSelect('s-section', '— select part first —');
    } else if (mode === 'part') {
        resetSelect('p-date', '— loading dates… —');
        resetSelect('p-part', '— select date first —');
    } else if (mode === 'diff') {
        resetSelect('d-dateA',   '— loading dates… —');
        resetSelect('d-dateB',   '— loading dates… —');
        resetSelect('d-part',    '— select title first —');
        resetSelect('d-section', '— select part first —');
    }

    // Get or fetch versions
    const dates = await fetchVersions(titleNum, prefix);
    if (!dates || dates.length === 0) return;

    const latestDate = dates[0];  // Already sorted newest-first

    if (mode === 'section') {
        const opts = dates.map((d, i) => ({ val: d, label: d + (i === 0 ? ' ★ latest' : '') }));
        selSet('s-date', opts, latestDate);
        setLatestTag('s-latest-tag', latestDate, true);
        await loadStructure(titleNum, latestDate, 'section');

    } else if (mode === 'part') {
        const opts = dates.map((d, i) => ({ val: d, label: d + (i === 0 ? ' ★ latest' : '') }));
        selSet('p-date', opts, latestDate);
        setLatestTag('p-latest-tag', latestDate, true);
        await loadStructure(titleNum, latestDate, 'part');

    } else if (mode === 'diff') {
        const opts = dates.map((d, i) => ({ val: d, label: d + (i === 0 ? ' ★ latest' : '') }));
        selSet('d-dateA', opts, dates[Math.min(1, dates.length - 1)]); // second-latest as A
        selSet('d-dateB', opts, latestDate);                            // latest as B
        await loadStructure(titleNum, latestDate, 'diff');
    }
}

// ── 4. Fetch versions (dates) for a title ───────────────────────────────
async function fetchVersions(titleNum, spinPrefix) {
    if (versionsCache[titleNum]) return versionsCache[titleNum];

    // Diff mode has dateA/dateB instead of a single date spinner
    const spinId = spinPrefix === 'd' ? 'd-dateB' : `${spinPrefix}-date`;
    selSpinner(spinId, true);
    selDisable(`${spinPrefix}-date`, true);
    try {
        const res = await fetch(`${ECFR_BASE}/versions/title-${titleNum}.json`);
        if (!res.ok) throw new Error('versions HTTP ' + res.status);
        const data = await res.json();

        // Normalize: content_versions array or flat array, then deduplicate
        const raw = data.content_versions || data.versions || data || [];
        const dates = [...new Set(
            raw
                .map(v => (typeof v === 'string' ? v : v.date || v.amendment_date || ''))
                .filter(Boolean)
                .sort((a, b) => b.localeCompare(a)) // newest first
        )];

        versionsCache[titleNum] = dates;
        return dates;
    } catch (err) {
        showError(`Could not load dates for Title ${titleNum}: ${err.message}`);
        return [];
    } finally {
        const spinId = spinPrefix === 'd' ? 'd-dateB' : `${spinPrefix}-date`;
        selSpinner(spinId, false);
    }
}

// ── 5. Load structure (parts + sections) for title + date ───────────────
async function loadStructure(titleNum, date, mode) {
    const prefix = { section: 's', part: 'p', diff: 'd' }[mode];
    const cacheKey = `${titleNum}-${date}`;

    const partSel    = `${prefix}-part`;
    const sectionSel = mode !== 'part' ? `${prefix}-section` : null;

    resetSelect(partSel, '— loading parts… —');
    if (sectionSel) resetSelect(sectionSel, '— select part first —');

    selSpinner(`${prefix}-part`, true);

    let structure;
    if (structureCache[cacheKey]) {
        structure = structureCache[cacheKey];
    } else {
        try {
            const res = await fetch(`${ECFR_BASE}/structure/${date}/title-${titleNum}.json`);
            if (!res.ok) throw new Error('structure HTTP ' + res.status);
            structure = await res.json();
            structureCache[cacheKey] = structure;
        } catch (err) {
            showError(`Could not load structure for Title ${titleNum} on ${date}: ${err.message}`);
            selSpinner(`${prefix}-part`, false);
            return;
        }
    }

    // Extract parts from structure tree
    const parts = extractNodes(structure, 'part');
    if (parts.length === 0) {
        resetSelect(partSel, '— no parts found —');
        selSpinner(`${prefix}-part`, false);
        return;
    }

    const partOpts = parts.map(p => ({
        val:   p.identifier,
        label: `Part ${p.identifier}${p.label_description ? ' — ' + truncate(p.label_description, 45) : ''}`
    }));
    // Default to Part 50 if available (Title 10 default), otherwise first part
    const preferredPart = partOpts.find(p => p.val === DEFAULT_PART) ? DEFAULT_PART : partOpts[0].val;
    selSet(partSel, partOpts, preferredPart);
    selSpinner(`${prefix}-part`, false);

    // Auto-populate sections for the selected part
    onPartChange(mode);
}

// ── 6. Part changed → populate sections ─────────────────────────────────
function onPartChange(mode) {
    const prefix = { section: 's', part: 'p', diff: 'd' }[mode];
    const titleSel = document.getElementById(`${prefix}-title`);
    const dateSel  = mode === 'diff'
        ? document.getElementById('d-dateB')  // use Date B for structure reference
        : document.getElementById(`${prefix}-date`);

    const partSel    = `${prefix}-part`;
    const sectionSel = mode !== 'part' ? `${prefix}-section` : null;

    if (!sectionSel) return; // Part mode doesn't have a section dropdown

    const titleNum = titleSel?.value;
    const date     = dateSel?.value;
    const partNum  = document.getElementById(partSel)?.value;
    if (!titleNum || !date || !partNum) return;

    const cacheKey = `${titleNum}-${date}`;
    const structure = structureCache[cacheKey];
    if (!structure) return;

    selSpinner(`${prefix}-section`, true);
    resetSelect(sectionSel, '— loading sections… —');

    const partNode = findNode(structure, partNum, 'part');
    const sections = partNode ? extractNodes(partNode, 'section') : [];

    if (sections.length === 0) {
        resetSelect(sectionSel, '— no sections found —');
        selSpinner(`${prefix}-section`, false);
        return;
    }

    const sectionOpts = sections.map(s => ({
        val:   s.identifier,
        label: `§ ${s.identifier}${s.label_description ? ' — ' + truncate(s.label_description, 42) : ''}`
    }));
    selSet(sectionSel, sectionOpts, sectionOpts[0].val);
    selSpinner(`${prefix}-section`, false);
}

// ── Tree helpers ─────────────────────────────────────────────────────────
function extractNodes(node, type) {
    const results = [];
    function walk(n) {
        if (!n) return;
        if (n.type === type) { results.push(n); return; } // don't recurse into matching nodes for parts
        if (n.children) n.children.forEach(walk);
    }
    // For sections, we want to descend into parts
    function walkAll(n) {
        if (!n) return;
        if (n.type === type) { results.push(n); }
        if (n.children) n.children.forEach(walkAll);
    }
    if (type === 'part') walk(node);
    else walkAll(node);
    return results;
}

function findNode(node, id, type) {
    if (!node) return null;
    if (node.type === type && String(node.identifier) === String(id)) return node;
    if (node.children) {
        for (const c of node.children) { const f = findNode(c, id, type); if (f) return f; }
    }
    return null;
}

function resetSelect(id, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = `<option disabled selected>${placeholder}</option>`;
    sel.disabled  = true;
}

function truncate(str, max) {
    return str && str.length > max ? str.slice(0, max) + '…' : str;
}

// ── Date select change → reload structure if needed ───────────────────────
// Attach listeners after selects exist
function attachDateListeners() {
    document.getElementById('s-date')?.addEventListener('change', async () => {
        const title = document.getElementById('s-title')?.value;
        const date  = document.getElementById('s-date')?.value;
        if (title && date) {
            const el = document.getElementById('s-latest-tag');
            if (el) {
                const latest = versionsCache[title]?.[0];
                setLatestTag('s-latest-tag', latest, date === latest);
            }
            await loadStructure(title, date, 'section');
        }
    });
    document.getElementById('p-date')?.addEventListener('change', async () => {
        const title = document.getElementById('p-title')?.value;
        const date  = document.getElementById('p-date')?.value;
        if (title && date) {
            const el = document.getElementById('p-latest-tag');
            if (el) { const latest = versionsCache[title]?.[0]; setLatestTag('p-latest-tag', latest, date === latest); }
            await loadStructure(title, date, 'part');
        }
    });
    document.getElementById('d-dateB')?.addEventListener('change', async () => {
        const title = document.getElementById('d-title')?.value;
        const date  = document.getElementById('d-dateB')?.value;
        if (title && date) await loadStructure(title, date, 'diff');
    });
}

// ── History ──────────────────────────────────────────────────────────────
function loadHistory() {
    try { return JSON.parse(localStorage.getItem('ecfr_history') || '[]'); } catch { return []; }
}
function saveToHistory(entry) {
    let h = loadHistory().filter(e => e.key !== entry.key);
    h.unshift({ ...entry, ts: new Date().toLocaleString() });
    if (h.length > 25) h = h.slice(0, 25);
    localStorage.setItem('ecfr_history', JSON.stringify(h));
    renderHistory();
}
function clearHistory() {
    if (!confirm('Clear all search history?')) return;
    localStorage.removeItem('ecfr_history');
    renderHistory();
}
function deleteHistoryItem(key) {
    localStorage.setItem('ecfr_history', JSON.stringify(loadHistory().filter(e => e.key !== key)));
    renderHistory();
}
function renderHistory() {
    const list = document.getElementById('historyList');
    const h = loadHistory();
    if (!h.length) { list.innerHTML = '<div class="history-empty">No searches yet</div>'; return; }
    list.innerHTML = h.map(e => `
        <div class="history-item" onclick='restoreQuery(${JSON.stringify(e)})'>
            <div class="history-item-text">
                <div class="history-item-title">${e.label}</div>
                <div class="history-item-date">${e.ts}</div>
            </div>
            <button class="history-delete" onclick="event.stopPropagation();deleteHistoryItem('${e.key.replace(/'/g,"\\'")}')" title="Remove">×</button>
        </div>`).join('');
}
function restoreQuery(entry) {
    setMode(entry.mode);
    // History items now trigger live lookups — just re-run with saved params
    if (entry.mode === 'section') runQueryWith(entry.title, entry.date, entry.section);
    else if (entry.mode === 'diff')    runDiffWith(entry.title, entry.dateA, entry.dateB, entry.section);
    else if (entry.mode === 'part')    runPartBrowseWith(entry.title, entry.date, entry.part);
}

// ── Citation helpers ──────────────────────────────────────────────────────
function findFRMatches(text) {
    return (text || '').match(/\d{2} FR \d+/g) || [];
}
function extractTagText(xmlText, tagtext) {
    const startTag = tagtext === 'CITA' ? `<${tagtext} TYPE="N">` : `<${tagtext}>`;
    const endTag   = `</${tagtext}>`;
    const s = xmlText.indexOf(startTag), e = xmlText.indexOf(endTag);
    return (s !== -1 && e !== -1) ? xmlText.substring(s + startTag.length, e).trim() : null;
}

// ── eCFR XML Fetch ────────────────────────────────────────────────────────
async function fetchECFRXML(date, title, section) {
    const url = `${ECFR_BASE}/full/${date}/title-${title}.xml?section=${section}`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/xml' } });
    if (!res.ok) throw new Error(`eCFR API HTTP ${res.status} — Title ${title} §${section} on ${date}`);
    return res.text();
}

// ── FR PDF Fetch (bug-fixed) ──────────────────────────────────────────────
async function fetchFRPDFs(citations) {
    if (!citations?.length) return [];
    const q = citations.map(c => c.replaceAll(' ', '%20')).join(',');
    const res = await fetch(
        `https://www.federalregister.gov/api/v1/documents/${q}.json?fields[]=pdf_url&fields[]=citation&fields[]=title`,
        { headers: { accept: '*/*' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r, k) => ({
        citation: r.citation || citations[k] || '',
        pdf_url:  r.pdf_url  || null,
        title:    r.title    || ''
    }));
}

// ── Section Query ─────────────────────────────────────────────────────────
async function runQuery() {
    const title   = document.getElementById('s-title')?.value;
    const date    = document.getElementById('s-date')?.value;
    const section = document.getElementById('s-section')?.value;
    if (!title || !date || !section || section.startsWith('—')) {
        showError('Please wait for all dropdowns to finish loading, then select a section.'); return;
    }
    await runQueryWith(title, date, section);
}

async function runQueryWith(title, date, section) {
    showError(null);
    showLoading(true);
    document.getElementById('results').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><span>Fetching eCFR data…</span></div>';
    try {
        const xmlText  = await fetchECFRXML(date, title, section);
        const xmlDoc   = new DOMParser().parseFromString(xmlText, 'application/xml');
        const head     = extractTagText(xmlText, 'HEAD');
        const cita     = extractTagText(xmlText, 'CITA');
        const pEls     = xmlDoc.getElementsByTagName('P');
        const citations = findFRMatches(cita || '');
        let frResults = [];
        try { frResults = await fetchFRPDFs(citations); } catch {}
        renderSection({ head, cita, citations, pEls, frResults, date, title, section });
        saveToHistory({ mode:'section', key:`sec-${title}-${section}-${date}`, label:`Title ${title} §${section} (${date})`, title, date, section });
    } catch (err) {
        showError(err.message);
        document.getElementById('results').innerHTML = '';
    } finally { showLoading(false); }
}

function renderSection({ head, cita, citations, pEls, frResults, date, title, section }) {
    let html = '';
    if (cita) {
        const frLinks  = citations.map(c => `<a class="fr-link" href="https://www.federalregister.gov/citation/${c.replaceAll(' ','-')}" target="_blank">↗ ${c}</a>`).join('');
        const pdfLinks = frResults.filter(r => r.pdf_url).map(r =>
            `<a class="pdf-link" href="${r.pdf_url}" target="_blank">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10H8v2h4v-2zm0 4H8v2h4v-2zM8 8h8V6H8v2zm12-2l-6-6H6C4.9 0 4 .9 4 2v20c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6zm-2 14H6V2h7v5h5v13z"/></svg>
                PDF ${r.citation}
            </a>`).join('');
        html += `<div class="result-card">
            <div class="result-card-header"><span class="result-card-title">Citations</span><button class="copy-btn" onclick="copyToClipboard(${JSON.stringify(cita)},this)">Copy</button></div>
            <div class="result-card-body">
                <div class="citation-text">${cita}</div>
                ${frLinks  ? `<div class="link-row">${frLinks}</div>`  : ''}
                ${pdfLinks ? `<div class="link-row" style="margin-top:8px">${pdfLinks}</div>` : ''}
            </div></div>`;
    }
    if (head) {
        html += `<div class="result-card">
            <div class="result-card-header"><span class="result-card-title">Section — ${title} CFR §${section}</span><button class="copy-btn" onclick="copyToClipboard(${JSON.stringify(head)},this)">Copy</button></div>
            <div class="result-card-body"><div class="section-heading">${head}</div></div></div>`;
    }
    if (pEls.length > 0) {
        const allText = Array.from(pEls).map(p => p.textContent).join('\n\n');
        html += `<div class="result-card">
            <div class="result-card-header"><span class="result-card-title">Section Text — ${date}</span><button class="copy-btn" onclick="copyToClipboard(${JSON.stringify(allText)},this)">Copy</button></div>
            <div class="result-card-body">${Array.from(pEls).map(p => `<div class="section-para">${p.textContent}</div>`).join('')}</div></div>`;
    }
    if (!html) html = '<div class="results-placeholder"><p>No content found. Try a different date or section.</p></div>';
    document.getElementById('results').innerHTML = html;
}

// ── Part Browser ──────────────────────────────────────────────────────────
async function runPartBrowse() {
    const title = document.getElementById('p-title')?.value;
    const date  = document.getElementById('p-date')?.value;
    const part  = document.getElementById('p-part')?.value;
    if (!title || !date || !part || part.startsWith('—')) {
        showError('Select a title, date, and part.'); return;
    }
    await runPartBrowseWith(title, date, part);
}

async function runPartBrowseWith(title, date, part) {
    showError(null); showLoading(true);
    document.getElementById('results').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><span>Loading part structure…</span></div>';
    try {
        const cacheKey = `${title}-${date}`;
        if (!structureCache[cacheKey]) {
            const res = await fetch(`${ECFR_BASE}/structure/${date}/title-${title}.json`);
            if (!res.ok) throw new Error('Structure API HTTP ' + res.status);
            structureCache[cacheKey] = await res.json();
        }
        const partNode = findNode(structureCache[cacheKey], part, 'part');
        if (!partNode) throw new Error(`Part ${part} not found in Title ${title} on ${date}.`);
        renderPartBrowser(partNode, date, title, part);
        saveToHistory({ mode:'part', key:`part-${title}-${part}-${date}`, label:`Title ${title} Part ${part} (${date})`, title, date, part });
    } catch (err) {
        showError(err.message);
        document.getElementById('results').innerHTML = '';
    } finally { showLoading(false); }
}

function renderPartBrowser(partNode, date, title, part) {
    let rows = '';
    function walk(node, depth) {
        if (!node.children) return;
        for (const child of node.children) {
            const isSection = child.type === 'section';
            const ml = depth * 18;
            const clickAttr = isSection
                ? `onclick="loadSection('${date}','${title}','${child.identifier}')" style="margin-left:${ml}px;cursor:pointer"`
                : `style="margin-left:${ml}px;cursor:default;opacity:0.7"`;
            rows += `<div class="part-item" ${clickAttr}>
                <span class="part-num">${child.identifier || ''}</span>
                <span class="part-desc">${child.label_description || child.label || ''}</span>
                ${isSection ? '<span class="part-load">→ load</span>' : ''}
            </div>`;
            if (child.children) walk(child, depth + 1);
        }
    }
    walk(partNode, 0);
    document.getElementById('results').innerHTML = `
    <div class="result-card">
        <div class="result-card-header"><span class="result-card-title">Title ${title} · Part ${part} Structure (${date})</span></div>
        <div class="result-card-body">
            <div class="part-header-desc">${partNode.label_description || partNode.label || ''}</div>
            <div class="part-tree">${rows || '<div class="history-empty">No sections found.</div>'}</div>
        </div></div>`;
}

function loadSection(date, title, section) {
    setMode('section');
    // Update selects to match restored values, then fetch
    const tSel = document.getElementById('s-title');
    if (tSel) tSel.value = title;
    // Fetch directly — structure already cached
    runQueryWith(title, date, section);
}

// ── Diff View ─────────────────────────────────────────────────────────────
async function runDiff() {
    const title   = document.getElementById('d-title')?.value;
    const section = document.getElementById('d-section')?.value;
    const dateA   = document.getElementById('d-dateA')?.value;
    const dateB   = document.getElementById('d-dateB')?.value;
    if (!title || !section || !dateA || !dateB || section.startsWith('—')) {
        showError('Select a title, section, and both dates.'); return;
    }
    await runDiffWith(title, dateA, dateB, section);
}

async function runDiffWith(title, dateA, dateB, section) {
    showError(null); showLoading(true);
    document.getElementById('results').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><span>Fetching both versions…</span></div>';
    try {
        const [xmlA, xmlB] = await Promise.all([fetchECFRXML(dateA, title, section), fetchECFRXML(dateB, title, section)]);
        const parseText = xml => Array.from(new DOMParser().parseFromString(xml,'application/xml').getElementsByTagName('P')).map(p=>p.textContent).join('\n\n');
        renderDiff({ textA:parseText(xmlA), textB:parseText(xmlB), headA:extractTagText(xmlA,'HEAD'), headB:extractTagText(xmlB,'HEAD'), citaA:extractTagText(xmlA,'CITA'), citaB:extractTagText(xmlB,'CITA'), dateA, dateB, title, section });
        saveToHistory({ mode:'diff', key:`diff-${title}-${section}-${dateA}-${dateB}`, label:`Diff §${section}: ${dateA} vs ${dateB}`, title, dateA, dateB, section });
    } catch (err) {
        showError(err.message);
        document.getElementById('results').innerHTML = '';
    } finally { showLoading(false); }
}

// Word-level LCS diff
function wordDiff(a, b) {
    const wA = a.split(/(\s+)/), wB = b.split(/(\s+)/);
    const m = wA.length, n = wB.length;
    const dp = Array.from({length:m+1},()=>new Uint16Array(n+1));
    for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
        dp[i][j] = wA[i-1]===wB[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j],dp[i][j-1]);
    const ops=[]; let i=m,j=n;
    while(i>0||j>0){
        if(i>0&&j>0&&wA[i-1]===wB[j-1]){ops.unshift({type:'same',val:wA[i-1]});i--;j--;}
        else if(j>0&&(i===0||dp[i][j-1]>=dp[i-1][j])){ops.unshift({type:'add',val:wB[j-1]});j--;}
        else{ops.unshift({type:'del',val:wA[i-1]});i--;}
    }
    return ops;
}
function esc(s){return s.replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function buildDiffPane(ops,side){
    return ops.map(op=>{
        const t=esc(op.val);
        if(op.type==='same') return `<span class="diff-same">${t}</span>`;
        if(op.type==='add'&&side==='b') return `<span class="diff-add">${t}</span>`;
        if(op.type==='del'&&side==='a') return `<span class="diff-del">${t}</span>`;
        return '';
    }).join('');
}
function renderDiff({textA,textB,headA,headB,citaA,citaB,dateA,dateB,title,section}){
    const ops=wordDiff(textA,textB);
    const adds=ops.filter(o=>o.type==='add'&&o.val.trim()).length;
    const dels=ops.filter(o=>o.type==='del'&&o.val.trim()).length;
    const sames=ops.filter(o=>o.type==='same'&&o.val.trim()).length;
    const unchanged=adds===0&&dels===0;
    const citaBlock = citaA===citaB
        ? `<span class="diff-no-change">✓ Citations unchanged between versions</span>`
        : `<div class="diff-cita-changed">⚠ Citations differ</div>
           <div class="diff-cita-detail"><b>${dateA}:</b> ${citaA||'(none)'}</div>
           <div class="diff-cita-detail"><b>${dateB}:</b> ${citaB||'(none)'}</div>`;
    document.getElementById('results').innerHTML = `
    <div class="result-card">
        <div class="result-card-header"><span class="result-card-title">Title ${title} §${section} — Version Comparison</span></div>
        <div class="result-card-body">
            <div class="diff-stats">
                <span class="stat-add">+${adds} added</span>
                <span class="stat-del">−${dels} removed</span>
                <span class="stat-same">${sames} unchanged</span>
                ${unchanged?'<span class="stat-identical">✓ Identical</span>':''}
            </div>
            <div class="diff-cita-block">${citaBlock}</div>
            <div class="diff-legend"><span class="legend-add">■ Added</span><span class="legend-del">■ Removed</span><span class="legend-same">■ Unchanged</span></div>
            <div class="diff-container">
                <div class="diff-pane">
                    <div class="diff-pane-label">📅 ${dateA} — ${headA||section}</div>
                    <div class="diff-pane-body">${buildDiffPane(ops,'a')||'<em style="color:var(--text-dim)">No content</em>'}</div>
                </div>
                <div class="diff-pane">
                    <div class="diff-pane-label">📅 ${dateB} — ${headB||section}</div>
                    <div class="diff-pane-body">${buildDiffPane(ops,'b')||'<em style="color:var(--text-dim)">No content</em>'}</div>
                </div>
            </div>
        </div></div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────
renderHistory();
attachDateListeners();
loadTitles();
