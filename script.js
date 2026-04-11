// ══════════════════════════════════════════════════════════════════════════
//  eCFR Citation Retriever — script.js  v2.0
//  Fixes: PDF wiring, %20 encoding, stray URL, data.results indexing, global leak
//  New:   Search history, diff view, part browser, loading states, error UI,
//         copy-to-clipboard, FR PDF links displayed
// ══════════════════════════════════════════════════════════════════════════

// ── Mode Toggle ─────────────────────────────────────────────────────────
let currentMode = 'section';

function setMode(mode) {
    currentMode = mode;
    document.getElementById('sectionFields').style.display = mode === 'section' ? 'block' : 'none';
    document.getElementById('partFields').style.display   = mode === 'part'    ? 'block' : 'none';
    document.getElementById('diffFields').style.display   = mode === 'diff'    ? 'block' : 'none';
    ['Section','Part','Diff'].forEach(m =>
        document.getElementById('mode' + m).classList.toggle('active', m.toLowerCase() === mode)
    );
}

// ── UI Helpers ───────────────────────────────────────────────────────────
function showLoading(on) {
    document.getElementById('loadingBar').classList.toggle('active', on);
}

function showError(msg) {
    const el = document.getElementById('errorBanner');
    if (msg) {
        el.innerHTML = `<span class="error-icon">⚠</span> ${msg}`;
        el.classList.add('active');
    } else {
        el.classList.remove('active');
    }
}

function showToast(msg = 'Copied to clipboard') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        if (btn) {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
        }
        showToast();
    }).catch(() => showToast('Copy failed — try manually'));
}

// ── History ──────────────────────────────────────────────────────────────
function loadHistory() {
    try { return JSON.parse(localStorage.getItem('ecfr_history') || '[]'); }
    catch { return []; }
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
    const h = loadHistory().filter(e => e.key !== key);
    localStorage.setItem('ecfr_history', JSON.stringify(h));
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('historyList');
    const h = loadHistory();
    if (h.length === 0) {
        list.innerHTML = '<div class="history-empty">No searches yet</div>';
        return;
    }
    list.innerHTML = h.map(e => {
        const safeEntry = JSON.stringify(e).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return `
        <div class="history-item" onclick='restoreQuery(${JSON.stringify(e)})'>
            <div class="history-item-text">
                <div class="history-item-title">${e.label}</div>
                <div class="history-item-date">${e.ts}</div>
            </div>
            <button class="history-delete" onclick="event.stopPropagation();deleteHistoryItem('${e.key.replace(/'/g,"\\'")}')" title="Remove">×</button>
        </div>`;
    }).join('');
}

function restoreQuery(entry) {
    setMode(entry.mode);
    if (entry.mode === 'section') {
        document.getElementById('date').value    = entry.date    || '';
        document.getElementById('title').value   = entry.title   || '';
        document.getElementById('section').value = entry.section || '';
        runQuery();
    } else if (entry.mode === 'diff') {
        document.getElementById('dateA').value   = entry.dateA   || '';
        document.getElementById('dateB').value   = entry.dateB   || '';
        document.getElementById('titleD').value  = entry.title   || '';
        document.getElementById('sectionD').value= entry.section || '';
        runDiff();
    } else if (entry.mode === 'part') {
        document.getElementById('dateP').value   = entry.date    || '';
        document.getElementById('titleP').value  = entry.title   || '';
        document.getElementById('part').value    = entry.part    || '';
        runPartBrowse();
    }
}

// ── Citation Parsing ─────────────────────────────────────────────────────
function findFRMatches(text) {
    const regex = /\d{2} FR \d+/g;
    return text.match(regex) || [];
}

// ── XML Tag Extractor ────────────────────────────────────────────────────
function extractTagText(xmlText, tagtext) {
    const startTag = tagtext === 'CITA' ? `<${tagtext} TYPE="N">` : `<${tagtext}>`;
    const endTag   = `</${tagtext}>`;
    const startIdx = xmlText.indexOf(startTag);
    const endIdx   = xmlText.indexOf(endTag);
    if (startIdx !== -1 && endIdx !== -1) {
        return xmlText.substring(startIdx + startTag.length, endIdx).trim();
    }
    return null;
}

// ── eCFR API Fetch ───────────────────────────────────────────────────────
async function fetchECFRXML(date, title, section) {
    const url = `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${title}.xml?section=${section}`;
    const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/xml' } });
    if (!res.ok) throw new Error(`eCFR API error: HTTP ${res.status} — Title ${title} §${section} on ${date}`);
    return res.text();
}

// ── Federal Register PDF Fetch (FIXED) ──────────────────────────────────
//  Bug fixes:
//    1. Space encoding was `%` — now correctly `%20`
//    2. Stray URL literal removed
//    3. data.results[k].pdf_url instead of data.results.pdf_url
async function fetchFRPDFs(citations) {
    if (!citations || citations.length === 0) return [];

    // FIX 1: correct %20 encoding (was replaceAll(' ', '%'))
    const queryString = citations.map(c => c.replaceAll(' ', '%20')).join(',');
    const url = `https://www.federalregister.gov/api/v1/documents/${queryString}.json?fields[]=pdf_url&fields[]=citation&fields[]=title&fields[]=document_number`;

    // FIX 2: stray URL literal that was floating here has been removed

    const res = await fetch(url, { method: 'GET', headers: { 'accept': '*/*' } });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.results || data.results.length === 0) return [];

    // FIX 3: properly index each result (was `data.results.pdf_url` — undefined)
    return data.results.map((r, k) => ({
        citation: r.citation || citations[k] || '',
        pdf_url:  r.pdf_url  || null,
        title:    r.title    || '',
        doc_num:  r.document_number || ''
    }));
}

// ── Section Query ────────────────────────────────────────────────────────
async function runQuery() {
    const date    = document.getElementById('date').value.trim();
    const title   = document.getElementById('title').value.trim();
    const section = document.getElementById('section').value.trim();
    if (!date || !title || !section) { showError('Please fill in all fields.'); return; }

    showError(null);
    showLoading(true);
    document.getElementById('results').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><span>Fetching eCFR data…</span></div>';

    try {
        const xmlText = await fetchECFRXML(date, title, section);
        const xmlDoc  = new DOMParser().parseFromString(xmlText, 'application/xml');
        const head    = extractTagText(xmlText, 'HEAD');
        const cita    = extractTagText(xmlText, 'CITA');
        const pEls    = xmlDoc.getElementsByTagName('P');

        // FIX: citaFRs now properly declared with const (was implicit global)
        const citations = cita ? findFRMatches(cita) : [];

        let frResults = [];
        try { frResults = await fetchFRPDFs(citations); } catch { /* FR API optional */ }

        renderSection({ head, cita, citations, pEls, frResults, date, title, section });
        saveToHistory({
            mode: 'section',
            key:  `sec-${title}-${section}-${date}`,
            label: `Title ${title} §${section} (${date})`,
            date, title, section
        });
    } catch (err) {
        showError(err.message || 'Failed to fetch eCFR data. Check your inputs and try again.');
        document.getElementById('results').innerHTML = '';
    } finally {
        showLoading(false);
    }
}

function renderSection({ head, cita, citations, pEls, frResults, date, title, section }) {
    let html = '';

    if (cita) {
        const frLinks = citations.map(c => {
            const slug = c.replaceAll(' ', '-');
            return `<a class="fr-link" href="https://www.federalregister.gov/citation/${slug}" target="_blank">↗ ${c}</a>`;
        }).join('');

        const pdfLinks = frResults
            .filter(r => r.pdf_url)
            .map(r => `<a class="pdf-link" href="${r.pdf_url}" target="_blank">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10H8v2h4v-2zm0 4H8v2h4v-2zM8 8h8V6H8v2zm12-2l-6-6H6C4.9 0 4 .9 4 2v20c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6zm-2 14H6V2h7v5h5v13z"/></svg>
                PDF ${r.citation}
            </a>`).join('');

        html += `
        <div class="result-card">
            <div class="result-card-header">
                <span class="result-card-title">Citations</span>
                <button class="copy-btn" onclick="copyToClipboard(${JSON.stringify(cita)}, this)">Copy</button>
            </div>
            <div class="result-card-body">
                <div class="citation-text">${cita}</div>
                ${frLinks  ? `<div class="link-row">${frLinks}</div>`  : ''}
                ${pdfLinks ? `<div class="link-row" style="margin-top:8px">${pdfLinks}</div>` : ''}
            </div>
        </div>`;
    }

    if (head) {
        html += `
        <div class="result-card">
            <div class="result-card-header">
                <span class="result-card-title">Section — ${title} CFR §${section}</span>
                <button class="copy-btn" onclick="copyToClipboard(${JSON.stringify(head)}, this)">Copy</button>
            </div>
            <div class="result-card-body">
                <div class="section-heading">${head}</div>
            </div>
        </div>`;
    }

    if (pEls.length > 0) {
        const allText = Array.from(pEls).map(p => p.textContent).join('\n\n');
        html += `
        <div class="result-card">
            <div class="result-card-header">
                <span class="result-card-title">Section Text — ${date}</span>
                <button class="copy-btn" onclick="copyToClipboard(${JSON.stringify(allText)}, this)">Copy</button>
            </div>
            <div class="result-card-body">
                ${Array.from(pEls).map(p => `<div class="section-para">${p.textContent}</div>`).join('')}
            </div>
        </div>`;
    }

    if (!html) {
        html = '<div class="results-placeholder"><p>No content returned for this section. Try a different date or verify the section number.</p></div>';
    }
    document.getElementById('results').innerHTML = html;
}

// ── Part Browser ─────────────────────────────────────────────────────────
async function runPartBrowse() {
    const date  = document.getElementById('dateP').value.trim();
    const title = document.getElementById('titleP').value.trim();
    const part  = document.getElementById('part').value.trim();
    if (!date || !title || !part) { showError('Please fill in all fields.'); return; }

    showError(null);
    showLoading(true);
    document.getElementById('results').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><span>Loading part structure…</span></div>';

    try {
        const url = `https://www.ecfr.gov/api/versioner/v1/structure/${date}/title-${title}.json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Structure API error: HTTP ${res.status} — Title ${title} on ${date}`);
        const data = await res.json();

        const partNode = findNodeByIdentifier(data, part, 'part');
        if (!partNode) throw new Error(`Part ${part} not found in Title ${title} for ${date}. Check the part number.`);

        renderPartBrowser(partNode, date, title, part);
        saveToHistory({
            mode: 'part',
            key:  `part-${title}-${part}-${date}`,
            label: `Title ${title} Part ${part} (${date})`,
            date, title, part
        });
    } catch (err) {
        showError(err.message);
        document.getElementById('results').innerHTML = '';
    } finally {
        showLoading(false);
    }
}

function findNodeByIdentifier(node, id, type) {
    if (!node) return null;
    if (node.type === type && String(node.identifier) === String(id)) return node;
    if (node.children) {
        for (const child of node.children) {
            const found = findNodeByIdentifier(child, id, type);
            if (found) return found;
        }
    }
    return null;
}

function renderPartBrowser(partNode, date, title, part) {
    let rows = '';
    function walk(node, depth) {
        if (!node.children) return;
        for (const child of node.children) {
            const isSection = child.type === 'section';
            const indent    = depth * 18;
            const clickAttr = isSection
                ? `onclick="loadSection('${date}','${title}','${child.identifier}')" style="margin-left:${indent}px;cursor:pointer"`
                : `style="margin-left:${indent}px;cursor:default;opacity:0.75"`;
            rows += `
            <div class="part-item" ${clickAttr}>
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
        <div class="result-card-header">
            <span class="result-card-title">Title ${title} · Part ${part} Structure (${date})</span>
        </div>
        <div class="result-card-body">
            <div class="part-header-desc">${partNode.label_description || partNode.label || ''}</div>
            <div class="part-tree">${rows || '<div class="history-empty">No sections found in this part.</div>'}</div>
        </div>
    </div>`;
}

function loadSection(date, title, section) {
    setMode('section');
    document.getElementById('date').value    = date;
    document.getElementById('title').value   = title;
    document.getElementById('section').value = section;
    runQuery();
}

// ── Diff View ────────────────────────────────────────────────────────────
async function runDiff() {
    const dateA   = document.getElementById('dateA').value.trim();
    const dateB   = document.getElementById('dateB').value.trim();
    const title   = document.getElementById('titleD').value.trim();
    const section = document.getElementById('sectionD').value.trim();
    if (!dateA || !dateB || !title || !section) { showError('Please fill in all fields.'); return; }

    showError(null);
    showLoading(true);
    document.getElementById('results').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><span>Fetching both versions for comparison…</span></div>';

    try {
        const [xmlA, xmlB] = await Promise.all([
            fetchECFRXML(dateA, title, section),
            fetchECFRXML(dateB, title, section)
        ]);

        const parseText = xml => {
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            return Array.from(doc.getElementsByTagName('P')).map(p => p.textContent).join('\n\n');
        };

        renderDiff({
            textA:  parseText(xmlA),
            textB:  parseText(xmlB),
            headA:  extractTagText(xmlA, 'HEAD'),
            headB:  extractTagText(xmlB, 'HEAD'),
            citaA:  extractTagText(xmlA, 'CITA'),
            citaB:  extractTagText(xmlB, 'CITA'),
            dateA, dateB, title, section
        });

        saveToHistory({
            mode: 'diff',
            key:  `diff-${title}-${section}-${dateA}-${dateB}`,
            label: `Diff §${section}: ${dateA} vs ${dateB}`,
            dateA, dateB, title, section
        });
    } catch (err) {
        showError(err.message);
        document.getElementById('results').innerHTML = '';
    } finally {
        showLoading(false);
    }
}

// Word-level LCS diff
function wordDiff(a, b) {
    const wA = a.split(/(\s+)/);
    const wB = b.split(/(\s+)/);
    const m = wA.length, n = wB.length;

    // Build LCS table
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = wA[i-1] === wB[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

    // Backtrack
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && wA[i-1] === wB[j-1]) {
            ops.unshift({ type: 'same', val: wA[i-1] }); i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
            ops.unshift({ type: 'add', val: wB[j-1] }); j--;
        } else {
            ops.unshift({ type: 'del', val: wA[i-1] }); i--;
        }
    }
    return ops;
}

function esc(s) { return s.replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function buildDiffPane(ops, side) {
    return ops.map(op => {
        const t = esc(op.val);
        if (op.type === 'same')                    return `<span class="diff-same">${t}</span>`;
        if (op.type === 'add' && side === 'b')     return `<span class="diff-add">${t}</span>`;
        if (op.type === 'del' && side === 'a')     return `<span class="diff-del">${t}</span>`;
        return ''; // opposite side's change — omit
    }).join('');
}

function renderDiff({ textA, textB, headA, headB, citaA, citaB, dateA, dateB, title, section }) {
    const ops   = wordDiff(textA, textB);
    const adds  = ops.filter(o => o.type === 'add' && o.val.trim()).length;
    const dels  = ops.filter(o => o.type === 'del' && o.val.trim()).length;
    const sames = ops.filter(o => o.type === 'same' && o.val.trim()).length;
    const unchanged = adds === 0 && dels === 0;

    const citaBlock = citaA === citaB
        ? `<span class="diff-no-change">✓ Citations unchanged between versions</span>`
        : `<div class="diff-cita-changed">⚠ Citations differ between versions</div>
           <div class="diff-cita-detail"><b>${dateA}:</b> ${citaA || '(none)'}</div>
           <div class="diff-cita-detail"><b>${dateB}:</b> ${citaB || '(none)'}</div>`;

    document.getElementById('results').innerHTML = `
    <div class="result-card">
        <div class="result-card-header">
            <span class="result-card-title">Title ${title} §${section} — Version Comparison</span>
        </div>
        <div class="result-card-body">

            <div class="diff-stats">
                <span class="stat-add">+${adds} words added</span>
                <span class="stat-del">−${dels} words removed</span>
                <span class="stat-same">${sames} words unchanged</span>
                ${unchanged ? '<span class="stat-identical">✓ Sections are identical</span>' : ''}
            </div>

            <div class="diff-cita-block">${citaBlock}</div>

            <div class="diff-legend">
                <span class="legend-add">■ Added</span>
                <span class="legend-del">■ Removed</span>
                <span class="legend-same">■ Unchanged</span>
            </div>

            <div class="diff-container">
                <div class="diff-pane">
                    <div class="diff-pane-label">📅 ${dateA} — ${headA || section}</div>
                    <div class="diff-pane-body">${buildDiffPane(ops, 'a') || '<em style="color:var(--text-dim)">No content</em>'}</div>
                </div>
                <div class="diff-pane">
                    <div class="diff-pane-label">📅 ${dateB} — ${headB || section}</div>
                    <div class="diff-pane-body">${buildDiffPane(ops, 'b') || '<em style="color:var(--text-dim)">No content</em>'}</div>
                </div>
            </div>

        </div>
    </div>`;
}

// ── Init ─────────────────────────────────────────────────────────────────
renderHistory();
