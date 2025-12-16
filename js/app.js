(function () {
    // Use CONFIG from config.js if available, otherwise fallback to defaults
    const SUPABASE_URL = 'https://sxfcohtvewuadrvnmeka.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZmNvaHR2ZXd1YWRydm5tZWthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2OTMyMDUsImV4cCI6MjA4MTI2OTIwNX0.5bDoDWt8Yt58B78WcKvLLyzEMJzain68K1Rk77L9QgM';

    const PSGC_BASE_URL = 'https://psgc.cloud/api';
    
    let supabaseClient = null;
    let supabaseChannel = null;

    let reportList = [];
    let map = null;
    let mapLayers = [];
    let mapMarkersByReportId = {};
    let trendChart = null;

    let currentUserRole = null;
    let currentUsername = null;
    let currentPasswordMasked = '';

    let submitInFlight = false;
    let pendingFocusReportId = null;
    let focusLatestOnNextMapOpen = false;

    const LEGACY_LOCATION_COORDS = {};

    // Filter state
    let filteredReportList = [];
    let currentFilters = {
        search: '',
        status: '',
        diagnosis: '',
        dateFrom: '',
        dateTo: ''
    };

    function qs(id) {
        return document.getElementById(id);
    }

    function safeText(value) {
        return String(value == null ? '' : value);
    }

    function showLoading(elementId, show) {
        const el = qs(elementId);
        if (!el) return;
        el.style.display = show ? 'flex' : 'none';
    }

    function setDateInputToToday(id) {
        const el = qs(id);
        if (!el) return;
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        el.value = `${yyyy}-${mm}-${dd}`;
    }

    function ensureToastContainer() {
        let el = qs('toast-container');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast-container';
            el.className = 'toast-container';
            document.body.appendChild(el);
        }
        return el;
    }

    function toastIcon(type) {
        if (type === 'success') return '✓';
        if (type === 'error') return '!';
        if (type === 'warning') return '⚠';
        return 'i';
    }

    function showToast(type, title, msg) {
        const container = ensureToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast ${type || ''}`;

        const icon = document.createElement('div');
        icon.className = 'toast-icon';
        icon.textContent = toastIcon(type);

        const body = document.createElement('div');
        body.className = 'toast-body';

        const t = document.createElement('div');
        t.className = 'toast-title';
        t.textContent = safeText(title || '');

        const m = document.createElement('div');
        m.className = 'toast-msg';
        m.textContent = safeText(msg || '');

        body.appendChild(t);
        body.appendChild(m);

        toast.appendChild(icon);
        toast.appendChild(body);

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        const remove = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
            }, 220);
        };

        setTimeout(remove, 3200);
        toast.addEventListener('click', remove);
    }

    function closeModal() {
        const root = qs('modal-root');
        if (!root) return;
        root.innerHTML = '';
    }

    function showModal(title, bodyNode, actions) {
        const root = qs('modal-root');
        if (!root) return;
        root.innerHTML = '';

        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'modal';

        const header = document.createElement('div');
        header.className = 'modal-header';

        const h = document.createElement('div');
        h.className = 'modal-title';
        h.textContent = safeText(title || '');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'btn-secondary';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', closeModal);

        header.appendChild(h);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'modal-body';
        if (bodyNode) body.appendChild(bodyNode);

        const footer = document.createElement('div');
        footer.className = 'modal-actions';

        (actions || []).forEach(a => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = a.className || 'btn-primary';
            b.textContent = safeText(a.text || 'OK');
            b.addEventListener('click', () => {
                if (a.onClick) a.onClick();
            });
            footer.appendChild(b);
        });

        modal.appendChild(header);
        modal.appendChild(body);
        if ((actions || []).length > 0) modal.appendChild(footer);

        backdrop.appendChild(modal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
        });

        root.appendChild(backdrop);
    }

    function showConfirm(title, msg, okText, cancelText, danger) {
        return new Promise(resolve => {
            const body = document.createElement('div');
            body.style.display = 'flex';
            body.style.flexDirection = 'column';
            body.style.gap = '10px';

            const p = document.createElement('div');
            p.textContent = safeText(msg);
            body.appendChild(p);

            const onOk = () => {
                closeModal();
                resolve(true);
            };

            const onCancel = () => {
                closeModal();
                resolve(false);
            };

            showModal(title, body, [
                { text: safeText(cancelText || 'Cancel'), className: 'btn-secondary', onClick: onCancel },
                { text: safeText(okText || 'OK'), className: danger ? 'btn-primary' : 'btn-primary', onClick: onOk }
            ]);
        });
    }

    function loadLocalReports() {
        try {
            const raw = localStorage.getItem('epiReports_v4');
            if (!raw) return [];
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    function saveLocalReports() {
        localStorage.setItem('epiReports_v4', JSON.stringify(reportList));
    }

    function getSelectedOptionText(selectId) {
        const el = qs(selectId);
        if (!el) return '';
        const opt = el.options[el.selectedIndex];
        return opt ? safeText(opt.textContent || opt.innerText || opt.value) : '';
    }

    function clearAndDisableSelect(el, placeholder) {
        if (!el) return;
        el.innerHTML = '';
        const o = document.createElement('option');
        o.value = '';
        o.textContent = safeText(placeholder || 'Select');
        el.appendChild(o);
        el.value = '';
        el.disabled = true;
    }

    async function fetchJson(url) {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }

    async function initAddressSelectors() {
        const provinceEl = qs('r-province');
        const muniEl = qs('r-muni');
        const brgyEl = qs('r-brgy');

        if (!provinceEl || !muniEl || !brgyEl) return;

        clearAndDisableSelect(muniEl, 'Select Municipality / City');
        clearAndDisableSelect(brgyEl, 'Select Barangay');

        provinceEl.innerHTML = '<option value="">Select Province</option>';

        try {
            const provinces = await fetchJson(`${PSGC_BASE_URL}/provinces/`);
            provinces
                .slice()
                .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)))
                .forEach(p => {
                    const o = document.createElement('option');
                    o.value = safeText(p.code || p.id || '');
                    o.textContent = safeText(p.name || '');
                    provinceEl.appendChild(o);
                });
        } catch (e) {
            showToast('warning', 'PSGC unavailable', 'Province list failed to load.');
        }

        provinceEl.addEventListener('change', async () => {
            clearAndDisableSelect(muniEl, 'Select Municipality / City');
            clearAndDisableSelect(brgyEl, 'Select Barangay');

            const code = provinceEl.value;
            if (!code) return;

            try {
                const items = await fetchJson(`${PSGC_BASE_URL}/provinces/${encodeURIComponent(code)}/cities-municipalities/`);
                muniEl.disabled = false;
                muniEl.innerHTML = '<option value="">Select Municipality / City</option>';
                items
                    .slice()
                    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)))
                    .forEach(m => {
                        const o = document.createElement('option');
                        o.value = safeText(m.code || m.id || '');
                        o.textContent = safeText(m.name || '');
                        muniEl.appendChild(o);
                    });
            } catch (e) {
                showToast('warning', 'PSGC unavailable', 'Municipality list failed to load.');
            }
        });

        muniEl.addEventListener('change', async () => {
            clearAndDisableSelect(brgyEl, 'Select Barangay');
            const code = muniEl.value;
            if (!code) return;

            try {
                const items = await fetchJson(`${PSGC_BASE_URL}/cities-municipalities/${encodeURIComponent(code)}/barangays/`);
                brgyEl.disabled = false;
                brgyEl.innerHTML = '<option value="">Select Barangay</option>';
                items
                    .slice()
                    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)))
                    .forEach(b => {
                        const o = document.createElement('option');
                        o.value = safeText(b.code || b.id || '');
                        o.textContent = safeText(b.name || '');
                        brgyEl.appendChild(o);
                    });
            } catch (e) {
                showToast('warning', 'PSGC unavailable', 'Barangay list failed to load.');
            }
        });
    }

    async function geocodeBarangayHall(provinceName, muniName, brgyName, streetName) {
        // Try multiple geocoding queries with increasing specificity
        const queries = [];
        
        // If street name provided, try with it first
        if (streetName && streetName.trim()) {
            queries.push(`${streetName.trim()}, ${brgyName}, ${muniName}, ${provinceName}, Philippines`);
        }
        
        // Try with barangay hall
        queries.push(`Barangay Hall, ${brgyName}, ${muniName}, ${provinceName}, Philippines`);
        
        // Try with just barangay
        queries.push(`${brgyName}, ${muniName}, ${provinceName}, Philippines`);
        
        // Try with municipality and province as fallback
        queries.push(`${muniName}, ${provinceName}, Philippines`);

        for (const query of queries) {
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
                const data = await fetchJson(url);
                
                if (Array.isArray(data) && data.length > 0) {
                    const it = data[0];
                    const lat = Number(it.lat);
                    const lng = Number(it.lon);
                    
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        // Validate coordinates are within Philippines bounds
                        if (lat >= 4.0 && lat <= 21.0 && lng >= 116.0 && lng <= 127.0) {
                            return { lat, lng };
                        }
                    }
                }
                
                // Add delay to respect Nominatim rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
                console.warn('Geocoding attempt failed:', query, err);
                // Continue to next query
            }
        }
        
        return null;
    }

    function mulberry32(a) {
        return function () {
            let t = (a += 0x6D2B79F5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function jitterLatLngWithinMeters(lat, lng, meters, seed) {
        const rand = mulberry32(Number(seed) || Date.now());
        const radius = meters;
        const u = rand();
        const v = rand();
        const w = radius * Math.sqrt(u);
        const t = 2 * Math.PI * v;
        const dx = w * Math.cos(t);
        const dy = w * Math.sin(t);

        const latRad = (lat * Math.PI) / 180;
        const metersPerDegLat = 111320;
        const metersPerDegLng = 111320 * Math.cos(latRad);

        const dLat = dy / metersPerDegLat;
        const dLng = dx / metersPerDegLng;

        return [lat + dLat, lng + dLng];
    }

    function initMap() {
        if (map) return;
        map = L.map('map-container').setView([12.8797, 121.7740], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    }

    function clearMapLayers() {
        if (!map) return;
        mapLayers.forEach(l => {
            try { map.removeLayer(l); } catch { }
        });
        mapLayers = [];
        mapMarkersByReportId = {};
    }

    function updateMapMarkers() {
        if (!map) return;
        clearMapLayers();

        reportList.forEach(report => {
            const baseLat = typeof report.lat === 'number' ? report.lat : (report.lat ? Number(report.lat) : null);
            const baseLng = typeof report.lng === 'number' ? report.lng : (report.lng ? Number(report.lng) : null);
            let lat = baseLat;
            let lng = baseLng;

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                const legacy = LEGACY_LOCATION_COORDS[report.loc];
                if (!legacy) return;
                lat = legacy[0];
                lng = legacy[1];
            }

            const jittered = jitterLatLngWithinMeters(lat, lng, 1000, report.id);
            lat = jittered[0];
            lng = jittered[1];

            let color = 'green';
            if (report.status === 'Critical') color = 'red';
            else if (report.status === 'Stable') color = 'orange';

            const halo = L.circle([lat, lng], {
                color,
                fillColor: color,
                fillOpacity: 0.12,
                radius: 500,
                weight: 1,
                opacity: 0.55
            }).addTo(map);

            const dot = L.circleMarker([lat, lng], {
                radius: 7,
                color: '#ffffff',
                weight: 2,
                fillColor: color,
                fillOpacity: 1
            }).addTo(map);

            const locText = report.province && report.municipality && report.barangay
                ? `${report.province} - ${report.municipality} - ${report.barangay}`
                : (report.loc || 'Unknown');

            dot.bindPopup(`<b>${safeText(report.name)}</b><br>Diagnosis: ${safeText(report.diag || '')}<br>Status: ${safeText(report.status)}<br>Loc: ${safeText(locText)}`);

            mapLayers.push(halo);
            mapLayers.push(dot);
            mapMarkersByReportId[report.id] = dot;
        });
    }

    function focusReportOnMap(reportId) {
        if (!map || !reportId) return false;
        const layer = mapMarkersByReportId[reportId];
        if (!layer || !layer.getLatLng) return false;
        const latlng = layer.getLatLng();
        if (!latlng) return false;
        const targetZoom = Math.max(map.getZoom(), 13);
        map.setView(latlng, targetZoom, { animate: true });
        if (layer.openPopup) layer.openPopup();
        return true;
    }

    function refreshUI() {
        renderTable();
        updateDashboard();
        if (map) {
            updateMapMarkers();

            if (focusLatestOnNextMapOpen && pendingFocusReportId) {
                const focused = focusReportOnMap(pendingFocusReportId);
                if (focused) {
                    focusLatestOnNextMapOpen = false;
                    pendingFocusReportId = null;
                }
            }
        }
        updateProfileUI();
    }

    function updateDashboard() {
        const activeCases = reportList.filter(r => r && r.status !== 'Recovered').length;
        const dispActive = qs('disp-active');
        const dispTotal = qs('disp-total');
        if (dispActive) dispActive.textContent = String(activeCases);
        if (dispTotal) dispTotal.textContent = String(reportList.length);

        const criticalReports = reportList.filter(r => r && r.status === 'Critical');
        const criticalLocs = Array.from(new Set(criticalReports.map(r => r.loc || (r.barangay || 'Unknown'))));
        const zoneListEl = qs('zone-list');

        if (zoneListEl) {
            if (criticalLocs.length > 0) {
                zoneListEl.textContent = criticalLocs.join(', ');
                zoneListEl.style.color = '#b91c1c';
            } else {
                zoneListEl.textContent = 'No Critical Zones';
                zoneListEl.style.color = '#166534';
            }
        }

        updateChart();
    }

    function applyFilters() {
        filteredReportList = reportList.filter(item => {
            if (!item) return false;

            // Search filter
            if (currentFilters.search) {
                const searchLower = currentFilters.search.toLowerCase();
                const matchesSearch = 
                    safeText(item.name || '').toLowerCase().includes(searchLower) ||
                    safeText(item.loc || '').toLowerCase().includes(searchLower) ||
                    safeText(item.diag || '').toLowerCase().includes(searchLower) ||
                    safeText(item.province || '').toLowerCase().includes(searchLower) ||
                    safeText(item.municipality || '').toLowerCase().includes(searchLower) ||
                    safeText(item.barangay || '').toLowerCase().includes(searchLower);
                if (!matchesSearch) return false;
            }

            // Status filter
            if (currentFilters.status && item.status !== currentFilters.status) {
                return false;
            }

            // Diagnosis filter
            if (currentFilters.diagnosis && item.diag !== currentFilters.diagnosis) {
                return false;
            }

            // Date range filter
            if (currentFilters.dateFrom || currentFilters.dateTo) {
                if (!item.date) return false;
                const itemDate = new Date(item.date);
                if (isNaN(itemDate.getTime())) return false;

                if (currentFilters.dateFrom) {
                    const fromDate = new Date(currentFilters.dateFrom);
                    if (itemDate < fromDate) return false;
                }

                if (currentFilters.dateTo) {
                    const toDate = new Date(currentFilters.dateTo);
                    toDate.setHours(23, 59, 59, 999); // Include entire end date
                    if (itemDate > toDate) return false;
                }
            }

            return true;
        });

        // Update result count
        const countEl = qs('table-result-count');
        if (countEl) {
            const total = reportList.length;
            const filtered = filteredReportList.length;
            if (filtered === total) {
                countEl.textContent = `${total} records`;
            } else {
                countEl.textContent = `${filtered} of ${total} records`;
            }
        }
    }

    function renderTable() {
        const tbody = qs('report-table-body');
        if (!tbody) return;

        showLoading('table-loading', true);

        applyFilters();

        tbody.innerHTML = '';

        if (filteredReportList.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.style.textAlign = 'center';
            td.style.padding = '40px';
            td.style.color = '#64748b';
            td.textContent = currentFilters.search || currentFilters.status || currentFilters.diagnosis || currentFilters.dateFrom || currentFilters.dateTo
                ? 'No records match your filters'
                : 'No records found';
            tr.appendChild(td);
            tbody.appendChild(tr);
            showLoading('table-loading', false);
            return;
        }

        filteredReportList.forEach(item => {
            if (!item) return;
            const tr = document.createElement('tr');

            const tdDate = document.createElement('td');
            tdDate.textContent = safeText(item.date);

            const tdName = document.createElement('td');
            tdName.textContent = safeText(item.name);

            const tdLoc = document.createElement('td');
            tdLoc.textContent = safeText(item.loc);

            const tdStatus = document.createElement('td');
            const badge = document.createElement('span');
            const badgeClass = item.status === 'Critical' ? 'critical' : (item.status === 'Stable' ? 'stable' : 'recovered');
            badge.className = `badge ${badgeClass}`;
            badge.textContent = safeText(item.status);
            tdStatus.appendChild(badge);

            const tdAction = document.createElement('td');
            if (currentUserRole === 'admin') {
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-edit';
                editBtn.textContent = 'Edit';
                editBtn.addEventListener('click', () => openEditReport(item.id));

                const delBtn = document.createElement('button');
                delBtn.className = 'btn-delete';
                delBtn.style.marginLeft = '6px';
                delBtn.textContent = 'Delete';
                delBtn.addEventListener('click', () => deleteReport(item.id));

                tdAction.appendChild(editBtn);
                tdAction.appendChild(delBtn);
            } else {
                tdAction.textContent = '—';
            }

            tr.appendChild(tdDate);
            tr.appendChild(tdName);
            tr.appendChild(tdLoc);
            tr.appendChild(tdStatus);
            tr.appendChild(tdAction);

            tbody.appendChild(tr);
        });

        showLoading('table-loading', false);
    }

    function initTableFilters() {
        const searchInput = qs('table-search');
        const statusFilter = qs('table-filter-status');
        const diagnosisFilter = qs('table-filter-diagnosis');
        const dateFromFilter = qs('table-filter-date-from');
        const dateToFilter = qs('table-filter-date-to');
        const clearBtn = qs('table-clear-filters');

        const updateFilters = () => {
            currentFilters.search = searchInput ? safeText(searchInput.value || '').trim() : '';
            currentFilters.status = statusFilter ? safeText(statusFilter.value || '') : '';
            currentFilters.diagnosis = diagnosisFilter ? safeText(diagnosisFilter.value || '') : '';
            currentFilters.dateFrom = dateFromFilter ? safeText(dateFromFilter.value || '') : '';
            currentFilters.dateTo = dateToFilter ? safeText(dateToFilter.value || '') : '';
            renderTable();
        };

        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(updateFilters, 300); // Debounce
            });
        }

        if (statusFilter) statusFilter.addEventListener('change', updateFilters);
        if (diagnosisFilter) diagnosisFilter.addEventListener('change', updateFilters);
        if (dateFromFilter) dateFromFilter.addEventListener('change', updateFilters);
        if (dateToFilter) dateToFilter.addEventListener('change', updateFilters);

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                currentFilters = { search: '', status: '', diagnosis: '', dateFrom: '', dateTo: '' };
                if (searchInput) searchInput.value = '';
                if (statusFilter) statusFilter.value = '';
                if (diagnosisFilter) diagnosisFilter.value = '';
                if (dateFromFilter) dateFromFilter.value = '';
                if (dateToFilter) dateToFilter.value = '';
                renderTable();
            });
        }
    }

    function updateChart() {
        const ctx = qs('trendChart');
        if (!ctx || !window.Chart) return;

        showLoading('chart-loading', true);

        // Group reports by month
        const monthlyData = {};
        const now = new Date();
        const last6Months = [];

        // Generate last 6 months labels
        for (let i = 5; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            last6Months.push({ key: monthKey, label: monthLabel });
            monthlyData[monthKey] = { critical: 0, stable: 0, recovered: 0 };
        }

        // Count cases by month and status
        reportList.forEach(report => {
            if (!report || !report.date) return;
            const reportDate = new Date(report.date);
            if (isNaN(reportDate.getTime())) return;

            const monthKey = `${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyData[monthKey]) {
                if (report.status === 'Critical') monthlyData[monthKey].critical++;
                else if (report.status === 'Stable') monthlyData[monthKey].stable++;
                else if (report.status === 'Recovered') monthlyData[monthKey].recovered++;
            }
        });

        const labels = last6Months.map(m => m.label);
        const criticalData = last6Months.map(m => monthlyData[m.key].critical);
        const stableData = last6Months.map(m => monthlyData[m.key].stable);
        const recoveredData = last6Months.map(m => monthlyData[m.key].recovered);

        const whiteBackground = {
            id: 'customCanvasBackgroundColor',
            beforeDraw: (chart) => {
                const c = chart.canvas.getContext('2d');
                c.save();
                c.fillStyle = 'white';
                c.fillRect(0, 0, chart.width, chart.height);
                c.restore();
            }
        };

        const dataLabelPlugin = {
            id: 'dataLabels',
            afterDatasetsDraw: (chart) => {
                const { ctx: c } = chart;
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                        const value = dataset.data[index];
                        if (value > 0) {
                            c.fillStyle = '#475569';
                            c.font = 'bold 12px Segoe UI';
                            c.textAlign = 'center';
                            c.fillText(String(value), bar.x, bar.y - 8);
                        }
                    });
                });
            }
        };

        if (trendChart) {
            trendChart.data.labels = labels;
            trendChart.data.datasets[0].data = criticalData;
            trendChart.data.datasets[1].data = stableData;
            trendChart.data.datasets[2].data = recoveredData;
            trendChart.update();
            showLoading('chart-loading', false);
            return;
        }

        trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Critical',
                        data: criticalData,
                        backgroundColor: '#ef4444',
                        borderRadius: 6
                    },
                    {
                        label: 'Stable',
                        data: stableData,
                        backgroundColor: '#f97316',
                        borderRadius: 6
                    },
                    {
                        label: 'Recovered',
                        data: recoveredData,
                        backgroundColor: '#10b981',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 20 } },
                scales: { 
                    y: { beginAtZero: true, ticks: { stepSize: 1 } },
                    x: { stacked: false }
                },
                plugins: { 
                    legend: { 
                        display: true,
                        position: 'top'
                    } 
                }
            },
            plugins: [whiteBackground, dataLabelPlugin]
        });

        showLoading('chart-loading', false);
    }

    function downloadChartImage() {
        const canvas = qs('trendChart');
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = 'Monthly_Trend_Chart.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    function downloadCSV() {
        // Use filtered list if filters are active, otherwise use full list
        const dataToExport = (currentFilters.search || currentFilters.status || 
                              currentFilters.diagnosis || currentFilters.dateFrom || 
                              currentFilters.dateTo) ? filteredReportList : reportList;

        if (dataToExport.length === 0) {
            showToast('warning', 'No data', 'No data to export.');
            return;
        }

        let csv = 'Date,Name,Location,Province,Municipality,Barangay,Diagnosis,Status\n';
        dataToExport.forEach(r => {
            if (!r) return;
            const row = [
                r.date, 
                r.name, 
                r.loc, 
                r.province || '',
                r.municipality || '',
                r.barangay || '',
                r.diag, 
                r.status
            ]
                .map(v => `"${safeText(v).replace(/"/g, '""')}"`)
                .join(',');
            csv += row + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const filterSuffix = (currentFilters.search || currentFilters.status || 
                             currentFilters.diagnosis || currentFilters.dateFrom || 
                             currentFilters.dateTo) ? '_Filtered' : '';
        link.download = `EpiWatch_Data_Report${filterSuffix}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async function openEditReport(id) {
        const report = reportList.find(r => r && r.id === id);
        if (!report) return;

        if (currentUserRole !== 'admin') {
            showToast('warning', 'View only', 'This account is view-only and cannot edit records.');
            return;
        }

        const form = document.createElement('div');
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '12px';

        const mkGroup = (label, inputEl) => {
            const wrap = document.createElement('div');
            wrap.className = 'form-group';

            const l = document.createElement('label');
            l.className = 'form-label';
            l.textContent = label;

            wrap.appendChild(l);
            wrap.appendChild(inputEl);
            return wrap;
        };

        const dateEl = document.createElement('input');
        dateEl.className = 'form-input';
        dateEl.type = 'date';
        dateEl.value = safeText(report.date);

        const nameEl = document.createElement('input');
        nameEl.className = 'form-input';
        nameEl.type = 'text';
        nameEl.value = safeText(report.name);

        const diagEl = document.createElement('select');
        diagEl.className = 'form-select';
        ['Dengue', 'Cholera', 'Typhoid', 'Influenza', 'COVID-19'].forEach(v => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = v;
            diagEl.appendChild(o);
        });
        diagEl.value = safeText(report.diag);

        const statusEl = document.createElement('select');
        statusEl.className = 'form-select';
        ['Critical', 'Stable', 'Recovered'].forEach(v => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = v;
            statusEl.appendChild(o);
        });
        statusEl.value = safeText(report.status || 'Stable');

        form.appendChild(mkGroup('Date', dateEl));
        form.appendChild(mkGroup('Patient Name', nameEl));
        form.appendChild(mkGroup('Diagnosis', diagEl));
        form.appendChild(mkGroup('Status', statusEl));

        const save = async () => {
            const next = { ...report };
            next.date = safeText(dateEl.value || '').trim();
            next.name = safeText(nameEl.value || '').trim();
            next.diag = safeText(diagEl.value);
            next.status = safeText(statusEl.value);

            const idx = reportList.findIndex(r => r && r.id === id);
            if (idx >= 0) reportList[idx] = next;
            saveLocalReports();
            refreshUI();

            if (supabaseClient) {
                // Build update object without street column (if it doesn't exist in DB)
                const updateData = {
                    date: next.date,
                    name: next.name,
                    loc: next.loc,
                    province: next.province || null,
                    municipality: next.municipality || null,
                    barangay: next.barangay || null,
                    lat: next.lat || null,
                    lng: next.lng || null,
                    diag: next.diag,
                    status: next.status
                };
                // Only include street if it exists in the report object
                // (We'll add it to DB schema separately if needed)

                const { error } = await supabaseClient
                    .from('reports')
                    .update(updateData)
                    .eq('id', id);

                if (error) {
                    console.error('Supabase update error:', error);
                    showToast('error', 'Sync failed', `Update failed: ${error.message || 'Database error'}. Check Supabase policies.`);
                    closeModal();
                    return;
                }

                // Reload from Supabase to ensure sync
                await loadReportsFromSupabase();
            } else {
                saveLocalReports();
            }

            refreshUI();
            showToast('success', 'Updated', 'Record updated successfully.');
            closeModal();
        };

        showModal('Edit Record', form, [
            { text: 'Cancel', className: 'btn-secondary', onClick: closeModal },
            { text: 'Save Changes', className: 'btn-primary', onClick: save }
        ]);
    }

    async function deleteReport(id) {
        const report = reportList.find(r => r && r.id === id);
        if (!report) return;

        if (currentUserRole !== 'admin') {
            showToast('warning', 'View only', 'This account is view-only and cannot delete records.');
            return;
        }

        const ok = await showConfirm('Delete record', `Delete record for ${safeText(report.name || 'this patient')}?`, 'Delete', 'Cancel', true);
        if (!ok) return;

        if (supabaseClient) {
            // First, remove from local list for immediate UI update
            const originalList = [...reportList];
            reportList = reportList.filter(r => r && r.id !== id);
            saveLocalReports();
            refreshUI();

            // Then try to delete from Supabase
            const { data, error } = await supabaseClient
                .from('reports')
                .delete()
                .eq('id', id)
                .select();

            if (error) {
                console.error('Supabase delete error:', error);
                // Restore local list if delete failed
                reportList = originalList;
                saveLocalReports();
                refreshUI();
                showToast('error', 'Sync failed', `Delete failed: ${error.message || 'Database error'}. Check Supabase policies.`);
                return;
            }

            // Reload from Supabase to ensure sync
            await loadReportsFromSupabase();
            showToast('success', 'Deleted', 'Record deleted successfully.');
        } else {
            reportList = reportList.filter(r => r && r.id !== id);
            saveLocalReports();
            refreshUI();
            showToast('success', 'Deleted', 'Record deleted successfully.');
        }
    }

    async function loadReportsFromSupabase() {
        if (!supabaseClient) return;
        
        showLoading('table-loading', true);
        
        try {
            const { data, error } = await supabaseClient
                .from('reports')
                .select('*')
                .order('id', { ascending: false });

            if (error) {
                console.error('Supabase load error:', error);
                showToast('warning', 'Supabase', `Could not load: ${error.message || 'Database error'}. Using local data.`);
                showLoading('table-loading', false);
                return;
            }

            if (!Array.isArray(data)) {
                showLoading('table-loading', false);
                return;
            }
            
            reportList = data.map(r => ({
                id: Number(r.id),
                date: r.date,
                name: r.name,
                loc: r.loc,
                province: r.province,
                municipality: r.municipality,
                barangay: r.barangay,
                street: r.street || null,
                lat: typeof r.lat === 'number' ? r.lat : (r.lat ? Number(r.lat) : null),
                lng: typeof r.lng === 'number' ? r.lng : (r.lng ? Number(r.lng) : null),
                diag: r.diag,
                status: r.status
            }));
            saveLocalReports();
            refreshUI();
        } catch (err) {
            showToast('error', 'Load failed', 'Failed to load data from server.');
        } finally {
            showLoading('table-loading', false);
        }
    }

    function initSupabaseSync() {
        if (!window.supabase || !window.supabase.createClient) return;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            console.warn('Supabase credentials not configured');
            return;
        }

        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } catch {
            supabaseClient = null;
            return;
        }

        try {
            supabaseChannel = supabaseClient
                .channel('public:reports')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, async () => {
                    await loadReportsFromSupabase();
                })
                .subscribe();
        } catch {
            supabaseChannel = null;
        }
    }

    function updateProfileUI() {
        const u = qs('profile-username');
        const r = qs('profile-role');
        const p = qs('profile-password');
        if (u) u.textContent = safeText(currentUsername || '—');
        if (r) r.textContent = safeText(currentUserRole || '—');
        if (p) p.value = safeText(currentPasswordMasked || '');

        // Update desktop sidebar user info
        const sidebarUser = qs('sidebar-user-display');
        const sidebarRole = qs('sidebar-user-role');
        if (sidebarUser) sidebarUser.textContent = safeText(currentUsername || '—');
        if (sidebarRole) sidebarRole.textContent = safeText(currentUserRole || '—');
    }

    function applyRolePermissions() {
        const form = qs('report-form');
        if (!form) return;

        if (currentUserRole !== 'admin') {
            Array.from(form.querySelectorAll('input, select, button')).forEach(el => {
                if (el && el.type !== 'button') el.disabled = true;
            });
            const btn = form.querySelector('button[type="submit"]');
            if (btn) btn.disabled = true;
        } else {
            Array.from(form.querySelectorAll('input, select')).forEach(el => {
                if (el && (el.id === 'r-muni' || el.id === 'r-brgy')) return;
                if (el) el.disabled = false;
            });
            const btn = form.querySelector('button[type="submit"]');
            if (btn) btn.disabled = false;
        }
    }

    function toggleSidebar(open) {
        // Don't allow sidebar to open on mobile app
        const isMobileApp = document.body.classList.contains('mobile-app');
        if (isMobileApp) {
            return;
        }

        const sidebar = qs('desktop-sidebar');
        const backdrop = qs('sidebar-backdrop');
        const hamburger = qs('hamburger-btn');
        
        if (open === undefined) {
            open = !sidebar?.classList.contains('open');
        }
        
        if (sidebar) {
            if (open) {
                sidebar.classList.add('open');
            } else {
                sidebar.classList.remove('open');
            }
        }
        
        if (backdrop) {
            if (open) {
                backdrop.classList.add('active');
            } else {
                backdrop.classList.remove('active');
            }
        }
        
        if (hamburger) {
            if (open) {
                hamburger.classList.add('active');
            } else {
                hamburger.classList.remove('active');
            }
        }
    }

    function closeSidebar() {
        toggleSidebar(false);
    }

    function showPage(pageId, btn) {
        const pages = document.querySelectorAll('.page');
        pages.forEach(p => p.classList.remove('active'));

        // Update desktop nav items
        const desktopNavItems = document.querySelectorAll('.desktop-nav-item');
        desktopNavItems.forEach(n => {
            if (!n.classList.contains('logout')) n.classList.remove('active');
        });

        // Update mobile nav items (if any)
        const navItems = document.querySelectorAll('.nav-item:not(.desktop-nav-item)');
        navItems.forEach(n => {
            if (!n.classList.contains('logout')) n.classList.remove('active');
        });

        const target = qs(pageId);
        if (target) target.classList.add('active');

        if (btn) {
            btn.classList.add('active');
        } else {
            // Try desktop nav first
            const desktopNav = document.querySelector(`.desktop-nav-item[data-page="${pageId}"]`);
            if (desktopNav) {
                desktopNav.classList.add('active');
            } else {
                const byData = document.querySelector(`.nav-item[data-page="${pageId}"]`);
                if (byData) byData.classList.add('active');
            }
        }

        // Close sidebar on mobile after navigation (mobile uses bottom nav, not sidebar)
        const isMobile = document.body.classList.contains('mobile-app');
        if (isMobile) {
            closeSidebar();
        }

        const title = qs('page-title');
        if (title) {
            if (pageId === 'dashboard') title.textContent = 'Surveillance Dashboard';
            else if (pageId === 'map') title.textContent = 'Live Map';
            else if (pageId === 'reports') title.textContent = 'Submit Report';
            else if (pageId === 'informations') title.textContent = 'Case Information';
            else title.textContent = 'EpiWatch';
        }

        if (pageId === 'map') {
            setTimeout(() => {
                initMap();
                if (map) map.invalidateSize();
                updateMapMarkers();
            }, 60);
        }

        if (pageId === 'dashboard') {
            setTimeout(() => {
                if (trendChart && typeof trendChart.resize === 'function') {
                    trendChart.resize();
                }
            }, 60);
        }

        window.dispatchEvent(new CustomEvent('epiwatch:page', { detail: { pageId } }));
    }

    function setLoginError(msg) {
        const err = qs('login-error');
        if (!err) return;
        if (msg) {
            err.textContent = msg;
            err.style.display = 'block';
        } else {
            err.style.display = 'none';
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        const u = safeText(qs('login-user')?.value || '').trim();
        const p = safeText(qs('login-pass')?.value || '').trim();

        if (!u || !p) {
            setLoginError('Please enter both username and password');
            showToast('error', 'Login failed', 'Please enter both username and password.');
            return;
        }

        setLoginError('');
        const loginBtn = qs('login-submit-btn');
        const loginBtnText = qs('login-btn-text');
        const loginLoading = qs('login-loading');
        if (loginBtn) loginBtn.disabled = true;
        if (loginBtnText) loginBtnText.style.display = 'none';
        if (loginLoading) loginLoading.style.display = 'inline-flex';

        try {
            // Try Supabase Auth first if available
            if (supabaseClient && typeof supabaseClient.auth !== 'undefined') {
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email: u,
                    password: p
                });

                if (!error && data?.user) {
                    // Get user role from metadata or user_metadata
                    const userRole = data.user.user_metadata?.role || data.user.app_metadata?.role || 'viewer';
                    currentUsername = data.user.email || u;
                    currentUserRole = userRole;
                    currentPasswordMasked = '••••••••';
                    
                    const login = qs('login-screen');
                    const app = qs('app-container');
                    if (login) login.style.display = 'none';
                    if (app) app.style.display = 'flex';

                    const display = qs('user-display');
                    if (display) display.textContent = safeText(currentUsername);

                    initApp();
                    showLoading('login-loading', false);
                    return;
                }
            }

            // Fallback to legacy authentication (for backward compatibility)
            // NOTE: This is insecure and should be replaced with proper authentication
            const adminOk = (u === 'maui wowie' && p === 'honolulu123');
            const viewerOk = (u === 'viewer' && p === 'viewer123');

            if (!adminOk && !viewerOk) {
                setLoginError('Incorrect Username or Password');
                showToast('error', 'Login failed', 'Incorrect username or password.');
                if (loginBtn) loginBtn.disabled = false;
                if (loginBtnText) loginBtnText.style.display = 'inline';
                if (loginLoading) loginLoading.style.display = 'none';
                return;
            }

            currentUsername = u;
            currentUserRole = adminOk ? 'admin' : 'viewer';
            currentPasswordMasked = p;

            const login = qs('login-screen');
            const app = qs('app-container');
            if (login) login.style.display = 'none';
            if (app) app.style.display = 'flex';

            const display = qs('user-display');
            if (display) display.textContent = safeText(currentUsername);

            initApp();
        } catch (err) {
            setLoginError('Login error occurred');
            showToast('error', 'Login failed', 'An error occurred during login.');
            const loginBtn = qs('login-submit-btn');
            const loginBtnText = qs('login-btn-text');
            const loginLoading = qs('login-loading');
            if (loginBtn) loginBtn.disabled = false;
            if (loginBtnText) loginBtnText.style.display = 'inline';
            if (loginLoading) loginLoading.style.display = 'none';
        }
    }

    async function handleLogout() {
        const ok = await showConfirm('Log out', 'Are you sure you want to log out?', 'Log out', 'Cancel', false);
        if (!ok) return;

        const app = qs('app-container');
        const login = qs('login-screen');
        if (app) app.style.display = 'none';
        if (login) login.style.display = 'flex';

        const userEl = qs('login-user');
        const passEl = qs('login-pass');
        if (userEl) userEl.value = '';
        if (passEl) passEl.value = '';

        currentUsername = null;
        currentUserRole = null;
        currentPasswordMasked = '';

        updateProfileUI();

        window.dispatchEvent(new CustomEvent('epiwatch:logout'));
    }

    async function submitReport(e) {
        e.preventDefault();

        if (currentUserRole !== 'admin') {
            showToast('warning', 'View only', 'This account is view-only and cannot add new entries.');
            return;
        }

        if (submitInFlight) return;
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const prevBtnText = submitBtn ? submitBtn.textContent : '';
        submitInFlight = true;

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
        }

        try {
            const provinceCode = safeText(qs('r-province')?.value || '').trim();
            const muniCode = safeText(qs('r-muni')?.value || '').trim();
            const brgyCode = safeText(qs('r-brgy')?.value || '').trim();

            const provinceName = getSelectedOptionText('r-province');
            const muniName = getSelectedOptionText('r-muni');
            const brgyName = getSelectedOptionText('r-brgy');

            if (!provinceCode || !muniCode || !brgyCode) {
                showToast('warning', 'Missing location', 'Please select Province, Municipality/City, and Barangay.');
                return;
            }

            const nameVal = safeText(qs('r-name')?.value || '').trim();
            const dateVal = safeText(qs('r-date')?.value || '').trim();

            const now = Date.now();
            const dupe = reportList.find(r => {
                if (!r) return false;
                const sameName = safeText(r.name || '').trim().toLowerCase() === nameVal.toLowerCase();
                const sameDate = safeText(r.date || '').trim() === dateVal;
                const sameLoc = safeText(r.barangay || '').trim().toLowerCase() === safeText(brgyName || '').trim().toLowerCase();
                const recent = Number.isFinite(Number(r.id)) ? (now - Number(r.id) < 120000) : false;
                return sameName && sameDate && sameLoc && recent;
            });

            if (dupe) {
                showToast('warning', 'Duplicate blocked', 'This looks like a duplicate submission. Please wait.');
                return;
            }

            const streetName = safeText(qs('r-street')?.value || '').trim();
            
            showLoading('table-loading', true);
            const geo = await geocodeBarangayHall(provinceName, muniName, brgyName, streetName);
            showLoading('table-loading', false);
            
            if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
                showToast('error', 'Location Error', 'Could not locate the selected address. Please try adding a street name or building name, or verify the location details.');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = prevBtnText;
                }
                submitInFlight = false;
                return;
            }

            const locString = streetName 
                ? `${streetName}, ${brgyName}, ${muniName}, ${provinceName}`
                : `${brgyName}, ${muniName}, ${provinceName}`;

            const newReport = {
                id: Date.now(),
                date: dateVal,
                name: nameVal,
                loc: locString,
                province: provinceName,
                municipality: muniName,
                barangay: brgyName,
                street: streetName || null,
                lat: geo.lat,
                lng: geo.lng,
                diag: safeText(qs('r-diag')?.value || ''),
                status: safeText(qs('r-status')?.value || 'Stable')
            };

            reportList.unshift(newReport);
            pendingFocusReportId = newReport.id;
            focusLatestOnNextMapOpen = true;

            if (supabaseClient) {
                // Build insert object without street column (if it doesn't exist in DB)
                const insertData = {
                    id: newReport.id,
                    date: newReport.date,
                    name: newReport.name,
                    loc: newReport.loc,
                    province: newReport.province,
                    municipality: newReport.municipality,
                    barangay: newReport.barangay,
                    lat: newReport.lat,
                    lng: newReport.lng,
                    diag: newReport.diag,
                    status: newReport.status
                };
                // Only include street if column exists in DB
                // (We'll add it to DB schema separately if needed)

                const { error } = await supabaseClient.from('reports').insert(insertData);

                if (error) {
                    console.error('Supabase insert error:', error);
                    saveLocalReports();
                    refreshUI();
                    showToast('error', 'Sync failed', `Save failed: ${error.message || 'Database error'}. Check Supabase policies.`);
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = prevBtnText;
                    }
                    submitInFlight = false;
                    return;
                } else {
                    // Reload from Supabase to ensure sync
                    await loadReportsFromSupabase();
                }
            } else {
                saveLocalReports();
                refreshUI();
            }

            e.target.reset();
            setDateInputToToday('r-date');
            clearAndDisableSelect(qs('r-muni'), 'Select Municipality / City');
            clearAndDisableSelect(qs('r-brgy'), 'Select Barangay');
            if (qs('r-street')) qs('r-street').value = '';
            showToast('success', 'Saved', 'Record saved successfully.');
        } catch (err) {
            showToast('error', 'Save failed', 'Something went wrong while saving. Please try again.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = prevBtnText;
            }
            submitInFlight = false;
        }
    }

    function initApp() {
        reportList = loadLocalReports();
        filteredReportList = [...reportList];

        initSupabaseSync();
        initAddressSelectors();
        initTableFilters();

        setDateInputToToday('r-date');

        applyRolePermissions();

        setTimeout(async () => {
            initMap();
            if (supabaseClient) await loadReportsFromSupabase();
            refreshUI();
        }, 80);

        const passToggle = qs('profile-pass-toggle');
        const passInput = qs('profile-password');
        if (passToggle && passInput) {
            passToggle.addEventListener('click', () => {
                const isHidden = passInput.type === 'password';
                passInput.type = isHidden ? 'text' : 'password';
                passToggle.textContent = isHidden ? 'Hide' : 'Show';
            });
        }

        const profLogout = qs('profile-logout');
        if (profLogout) {
            profLogout.addEventListener('click', () => {
                handleLogout();
            });
        }

        updateProfileUI();
        showToast('success', 'Welcome', `Signed in as ${safeText(currentUsername)} (${safeText(currentUserRole)})`);

        // Detect mobile vs desktop
        // Mobile (both app and browser) use bottom navigation
        // Desktop uses sidebar
        if (window.innerWidth <= 768) {
            // Mobile (both app and browser) - use bottom navigation
            document.body.classList.add('mobile-app');
            document.body.classList.remove('mobile-browser');
        } else {
            // Desktop - use sidebar
            document.body.classList.remove('mobile-app', 'mobile-browser');
        }

        // Initialize desktop sidebar (only for desktop)
        initDesktopSidebar();
    }

    function isMobileBrowser() {
        // Check if it's a mobile device
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Check if it's running in standalone mode (PWA/App) vs browser
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                           window.navigator.standalone || 
                           document.referrer.includes('android-app://');
        
        // Mobile browser = mobile device but NOT standalone
        return isMobileDevice && !isStandalone;
    }

    function initDesktopSidebar() {
        const hamburger = qs('hamburger-btn');
        const sidebar = qs('desktop-sidebar');
        const backdrop = qs('sidebar-backdrop');
        const closeBtn = qs('sidebar-close-btn');
        const desktopNavItems = document.querySelectorAll('.desktop-nav-item[data-page]');

        if (hamburger) {
            hamburger.addEventListener('click', () => toggleSidebar());
        }

        if (backdrop) {
            backdrop.addEventListener('click', closeSidebar);
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', closeSidebar);
        }

        desktopNavItems.forEach(item => {
            item.addEventListener('click', () => {
                const pageId = item.getAttribute('data-page');
                if (pageId) {
                    showPage(pageId, item);
                }
            });
        });

        // Auto-open sidebar on desktop only (NOT on mobile)
        const isMobile = document.body.classList.contains('mobile-app');
        const shouldShowDesktopUI = window.innerWidth > 768 && !isMobile;
        if (shouldShowDesktopUI) {
            setTimeout(() => toggleSidebar(true), 100);
        }
    }

    window.handleLogin = handleLogin;
    window.handleLogout = handleLogout;
    window.showPage = showPage;
    window.submitReport = submitReport;
    window.downloadChartImage = downloadChartImage;
    window.downloadCSV = downloadCSV;
    window.openEditReport = openEditReport;
    window.deleteReport = deleteReport;

    function updateMobileBrowserDetection() {
        // Mobile (both app and browser) use bottom navigation
        // Desktop uses sidebar
        if (window.innerWidth <= 768) {
            // Mobile (both app and browser) - use bottom navigation
            document.body.classList.add('mobile-app');
            document.body.classList.remove('mobile-browser');
        } else {
            // Desktop - use sidebar
            document.body.classList.remove('mobile-app', 'mobile-browser');
        }
    }

    window.addEventListener('resize', () => {
        updateMobileBrowserDetection();
    });

    document.addEventListener('DOMContentLoaded', () => {
        ensureToastContainer();
        updateProfileUI();
        updateMobileBrowserDetection();
    });
})();
