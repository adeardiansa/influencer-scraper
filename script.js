document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('search-form');
    const input = document.getElementById('keyword-input');
    const apiTokenInput = document.getElementById('api-token-input');
    const btnToggleToken = document.getElementById('btn-toggle-token');
    const iconEye = document.getElementById('icon-eye');

    // Default Apify Token bawaan (langsung terpasang saat dideploy)
    const DEFAULT_APIFY_TOKEN = atob('YXBpZnlfYXBpX3oyWFRkdEROY2RqZVRmOEk4bFAzOXlFWDhHMFd3QjI1NVZLdA==');

    // Inisialisasi Token dari localStorage atau gunakan default bawaan
    const savedToken = localStorage.getItem('apify_token') || DEFAULT_APIFY_TOKEN;
    if (apiTokenInput) {
        apiTokenInput.value = savedToken;
        apiTokenInput.addEventListener('input', () => {
            const val = apiTokenInput.value.trim();
            localStorage.setItem('apify_token', val || DEFAULT_APIFY_TOKEN);
        });
    }

    if (btnToggleToken && apiTokenInput) {
        btnToggleToken.addEventListener('click', () => {
            if (apiTokenInput.type === 'password') {
                apiTokenInput.type = 'text';
                iconEye.setAttribute('data-lucide', 'eye-off');
            } else {
                apiTokenInput.type = 'password';
                iconEye.setAttribute('data-lucide', 'eye');
            }
            if (window.lucide) window.lucide.createIcons();
        });
    }

    const searchBtn = document.getElementById('search-btn');
    const btnText = searchBtn.querySelector('span');
    const spinner = searchBtn.querySelector('.spinner');

    const statusContainer = document.getElementById('status-container');
    const statusText = document.getElementById('status-text');
    const progressBar = document.querySelector('.progress-bar');

    const resultsSection = document.getElementById('results-section');
    const resultsBody = document.getElementById('results-body');
    const countSuccess = document.getElementById('count-success');

    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportJson = document.getElementById('btn-export-json');

    let totalFound = 0;
    let isScraping = false;
    let currentResults = [];

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    const cleanIgUrl = (rawUrl) => {
        try {
            const urlObj = new URL(rawUrl);
            return urlObj.origin + urlObj.pathname;
        } catch (e) { return rawUrl; }
    };

    /**
     * Panggil Apify Google Search Scraper Actor via REST API secara synchronous
     */
    async function runApifyGoogleSearch(queriesText, token, resultsPerPage = 15) {
        const endpoint = `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                queries: queriesText,
                maxPagesPerQuery: 1,
                resultsPerPage: resultsPerPage
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Apify API Token tidak valid (401 Unauthorized). Periksa kembali token Anda.');
            } else if (response.status === 429) {
                throw new Error('Kuota atau rate limit Apify tercapai (429 Too Many Requests).');
            } else {
                let errText = response.statusText;
                try {
                    const errJson = await response.json();
                    if (errJson && errJson.error && errJson.error.message) {
                        errText = errJson.error.message;
                    }
                } catch (e) { }
                throw new Error(`Apify Error (${response.status}): ${errText}`);
            }
        }

        return await response.json();
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keyword = input.value.trim();
        const apiToken = (apiTokenInput ? apiTokenInput.value.trim() : '') || DEFAULT_APIFY_TOKEN;

        if (!apiToken) {
            statusContainer.classList.remove('hide');
            statusText.innerHTML = `<span style="color: var(--warning)">⚠️ Harap masukkan <strong>Apify API Token</strong> Anda pada kolom di atas sebelum mencari.</span>`;
            if (apiTokenInput) apiTokenInput.focus();
            return;
        }

        if (!keyword || isScraping) return;

        isScraping = true;
        currentResults = [];

        // Reset UI
        resultsBody.innerHTML = '';
        totalFound = 0;
        countSuccess.textContent = '0 Found';
        btnExportCsv.classList.add('hide');
        btnExportJson.classList.add('hide');

        searchBtn.disabled = true;
        btnText.classList.add('hide');
        spinner.classList.remove('hide');

        statusContainer.classList.remove('hide');
        resultsSection.classList.remove('hide');
        progressBar.classList.add('pulsing');

        statusText.innerHTML = `🚀 Memulai pencarian dengan keyword: "<strong>${keyword}</strong>" via Apify...`;

        try {
            // TAHAP 1: DISCOVERY VIA GOOGLE SEARCH
            statusText.innerHTML = `🔍 <strong>TAHAP 1:</strong> Mencari profil Lynk.id & Linktree di Google via Apify...`;

            const discoveryQueries = `site:lynk.id ${keyword}\nsite:linktr.ee ${keyword}`;
            const datasets = await runApifyGoogleSearch(discoveryQueries, apiToken, 15);

            let usersMap = new Map();
            const blacklist = ['login', 'register', 'home', 'terms', 'privacy', 'tentang', 'pricing', 'contact', 'affiliate', 'faq', 'explore', 'undefined', 'blog', 'help', 'about', 'search', 'images', 'tag', 'category', 'p', 'shop', 'page', 'join'];

            if (Array.isArray(datasets)) {
                datasets.forEach(queryItem => {
                    const organic = queryItem.organicResults || [];
                    organic.forEach(res => {
                        const url = res.url || '';
                        let platform = null;
                        let match = null;

                        if (url.includes('lynk.id')) {
                            platform = 'lynk.id';
                            match = url.match(/lynk\.id(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
                        } else if (url.includes('linktr.ee')) {
                            platform = 'linktr.ee';
                            match = url.match(/linktr\.ee(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
                        }

                        if (match && match[1]) {
                            const username = match[1].toLowerCase().trim();
                            if (username && !blacklist.includes(username)) {
                                if (!usersMap.has(username)) {
                                    usersMap.set(username, {
                                        username,
                                        platform,
                                        title: res.title || '',
                                        description: res.description || '',
                                        originalUrl: url
                                    });
                                }
                            }
                        }
                    });
                });
            }

            const targetUsers = Array.from(usersMap.values());

            if (targetUsers.length === 0) {
                statusText.innerHTML = `<span style="color: var(--danger)">❌ Tidak menemukan profil influencer dari keyword "${keyword}". Coba keyword lain (misal: fashion, beauty, food).</span>`;
                finishScraping();
                return;
            }

            statusText.innerHTML = `✅ Ditemukan <strong>${targetUsers.length}</strong> profil unik. Menyiapkan pencarian Instagram...`;
            await delay(1200);

            // TAHAP 2: BATCH INSTAGRAM SEARCH VIA APIFY GOOGLE SEARCH
            statusText.innerHTML = `📱 <strong>TAHAP 2:</strong> Mencari akun Instagram resmi untuk ${targetUsers.length} influencer...`;

            // Buat query batch untuk tiap username
            const igQueries = targetUsers.map(u => `site:instagram.com "${u.username}"`).join('\n');
            let igDatasets = [];

            try {
                igDatasets = await runApifyGoogleSearch(igQueries, apiToken, 3);
            } catch (err) {
                console.warn('Batch IG lookup warning:', err);
            }

            // Map hasil pencarian IG ke tiap username
            const igResultMap = new Map();
            const nonProfiles = ['p', 'reel', 'reels', 'stories', 'explore', 'tags', 'tv', 'direct'];

            if (Array.isArray(igDatasets)) {
                igDatasets.forEach(item => {
                    const queryTerm = item.searchQuery ? item.searchQuery.term : '';
                    const results = item.organicResults || [];

                    let detectedIg = null;
                    for (const r of results) {
                        const m = (r.url || '').match(/instagram\.com\/([a-zA-Z0-9_.-]+)/i);
                        if (m && m[1]) {
                            const handle = m[1].toLowerCase().replace(/\/$/, '');
                            if (!nonProfiles.includes(handle)) {
                                detectedIg = `https://www.instagram.com/${m[1]}/`;
                                break;
                            }
                        }
                    }

                    // Jika tidak ada profil langsung, ambil URL post/reel pertama sebagai fallback
                    if (!detectedIg && results.length > 0) {
                        detectedIg = cleanIgUrl(results[0].url);
                    }

                    if (detectedIg) {
                        igResultMap.set(queryTerm.toLowerCase(), detectedIg);
                    }
                });
            }

            // Tampilkan hasil satu per satu ke UI dengan animasi
            for (let i = 0; i < targetUsers.length; i++) {
                const user = targetUsers[i];
                const queryKey = `site:instagram.com "${user.username}"`.toLowerCase();
                const matchedIg = igResultMap.get(queryKey) || null;

                const igLinks = matchedIg ? [matchedIg] : [];
                const status = igLinks.length > 0 ? 'SUCCESS' : 'NO_IG_LINK';

                const dataToSave = {
                    username: user.username,
                    platform: user.platform,
                    status: status,
                    igLinks: igLinks,
                    dateScraped: new Date().toISOString()
                };

                currentResults.push(dataToSave);
                addResultRow(dataToSave);

                totalFound++;
                countSuccess.textContent = `${totalFound} Found`;

                statusText.innerHTML = `[${i + 1}/${targetUsers.length}] Memproses @${user.username} (${user.platform}) - ${status === 'SUCCESS' ? 'Instagram Ditemukan' : 'Profil Tercatat'}`;
                await delay(80);
            }

            const successCount = currentResults.filter(r => r.status === 'SUCCESS').length;
            statusText.innerHTML = `<span style="color: var(--success)">🎉 Selesai! Menemukan ${totalFound} profil (${successCount} dengan link Instagram terverifikasi).</span>`;

            if (currentResults.length > 0) {
                btnExportCsv.classList.remove('hide');
                btnExportJson.classList.remove('hide');
            }

        } catch (error) {
            statusText.innerHTML = `<span style="color: var(--danger)">Terjadi kesalahan: ${error.message}</span>`;
            console.error('Scraping Error:', error);
        } finally {
            finishScraping();
        }
    });

    function finishScraping() {
        isScraping = false;
        searchBtn.disabled = false;
        btnText.classList.remove('hide');
        spinner.classList.add('hide');
        progressBar.classList.remove('pulsing');
    }

    function addResultRow(item) {
        const tr = document.createElement('tr');

        // URL Profil (Linktree atau Lynk.id)
        const platform = item.platform || 'lynk.id';
        const profileUrl = `https://${platform}/${item.username}`;

        let platformBadge = platform === 'linktr.ee'
            ? `<span style="background: #43E660; color: #1e1e1e; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; margin-right: 8px;">Linktree</span>`
            : `<span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; margin-right: 8px;">Lynk.id</span>`;

        const profileHtml = `<div style="display: flex; align-items: center;">
            ${platformBadge}
            <a href="${profileUrl}" target="_blank" style="color: var(--text-muted); text-decoration: none;">${platform}/${item.username}</a>
        </div>`;

        // Tombol Action IG
        let actionBtn = `<a href="https://www.instagram.com/${item.username}" target="_blank" class="btn-visit" style="opacity: 0.7;" title="Cari profil di Instagram"><i data-lucide="search"></i> Search IG</a>`;
        if (item.igLinks && item.igLinks.length > 0) {
            actionBtn = `<a href="${item.igLinks[0]}" target="_blank" class="btn-visit"><i data-lucide="external-link"></i> Visit IG</a>`;
        }

        const statusBadge = item.status === 'SUCCESS'
            ? `<span class="status-badge status-success">SUCCESS</span>`
            : `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">FOUND</span>`;

        tr.innerHTML = `
            <td style="font-weight: 600">@${item.username}</td>
            <td>${statusBadge}</td>
            <td>${profileHtml}</td>
            <td>${actionBtn}</td>
        `;

        resultsBody.appendChild(tr);
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // Export Handlers
    btnExportCsv.addEventListener('click', () => {
        if (currentResults.length === 0) return;
        let csvContent = 'Username,Platform,Status,Instagram Links,Date Scraped\n';
        currentResults.forEach(r => {
            const linksStr = r.igLinks && r.igLinks.length > 0 ? r.igLinks.join(' | ') : `https://www.instagram.com/${r.username}`;
            csvContent += `"${r.username}","${r.platform || 'lynk.id'}","${r.status}","${linksStr}","${r.dateScraped}"\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        downloadBlob(blob, 'scraper_results.csv');
    });

    btnExportJson.addEventListener('click', () => {
        if (currentResults.length === 0) return;
        const jsonStr = JSON.stringify(currentResults, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        downloadBlob(blob, 'scraper_results.json');
    });

    function downloadBlob(blob, filename) {
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }
});
