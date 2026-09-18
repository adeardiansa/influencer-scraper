document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('search-form');
    const input = document.getElementById('keyword-input');
    // Hardcoded ScraperAPI Key
    const API_KEY = '9f68393c5f575c83104d491728e91865';
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

    async function fetchWithScraperAPI(targetUrl, apiKey) {
        const scraperUrl = `https://api.scraperapi.com?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}`;
        const response = await fetch(scraperUrl);
        if (!response.ok) throw new Error(`ScraperAPI Error: ${response.status} ${response.statusText}`);
        return await response.text();
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keyword = input.value.trim();
        const apiKey = API_KEY;
        if (!keyword || !apiKey || isScraping) return;

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

        statusText.innerHTML = `🚀 Memulai pencarian dengan keyword: "${keyword}"`;

        try {
            let usersMap = new Map();
            const totalPages = 2; // Kurangi jumlah halaman agar menghemat request ScraperAPI
            const platformsToSearch = ['lynk.id', 'linktr.ee'];

            statusText.innerHTML = '🔍 TAHAP 1: Mencari akun di internet (via ScraperAPI)...';

            for (const platform of platformsToSearch) {
                for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                    const bParam = (pageNum - 1) * 10 + 1;
                    const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(`site:${platform} ${keyword}`.trim())}&b=${bParam}`;

                    statusText.innerHTML = `Mengumpulkan dari ${platform} halaman ${pageNum}... (1 request)`;

                    try {
                        const htmlContent = await fetchWithScraperAPI(searchUrl, apiKey);

                        let regex;
                        if (platform === 'lynk.id') regex = /lynk\.id(?:%2F|\/)([a-zA-Z0-9_.-]+)/gi;
                        if (platform === 'linktr.ee') regex = /linktr\.ee(?:%2F|\/)([a-zA-Z0-9_.-]+)/gi;

                        let match;
                        while ((match = regex.exec(htmlContent)) !== null) {
                            const username = match[1].toLowerCase().trim();
                            const blacklist = ['login', 'register', 'home', 'terms', 'privacy', 'tentang', 'pricing', 'contact', 'affiliate', 'faq', 'explore', 'undefined', 'blog', 'help', 'about', 'search', 'images'];
                            if (username && !blacklist.includes(username)) {
                                if (!usersMap.has(username)) {
                                    usersMap.set(username, platform);
                                }
                            }
                        }
                    } catch (err) {
                        console.error('Search fetch error:', err);
                    }
                }
            }

            const targetUsers = Array.from(usersMap, ([username, platform]) => ({ username, platform }));

            if (targetUsers.length === 0) {
                statusText.innerHTML = `<span style="color: var(--danger)">❌ Tidak menemukan satupun username. Periksa API Key atau keyword Anda.</span>`;
                finishScraping();
                return;
            }

            statusText.innerHTML = `✅ Ditemukan ${targetUsers.length} profil. Mulai mengekstrak IG...`;
            await delay(1000);

            // TAHAP 2: SCRAPING PROFIL
            for (let i = 0; i < targetUsers.length; i++) {
                const { username, platform } = targetUsers[i];
                const currentIndexInfo = `[${i + 1}/${targetUsers.length}]`;

                statusText.innerHTML = `${currentIndexInfo} Membuka profil ${platform}: ${username}... (1 request)`;

                const url = `https://${platform}/${username}`;
                let status = "FAILED";
                let igLinksClean = [];

                try {
                    const profileHtml = await fetchWithScraperAPI(url, apiKey);

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(profileHtml, 'text/html');

                    const links = Array.from(doc.querySelectorAll('a[href*="instagram.com"]')).map(a => a.href);
                    if (links.length > 0) {
                        igLinksClean = [...new Set(links.map(cleanIgUrl))];
                        status = "SUCCESS";
                    } else {
                        status = "NO_IG_LINK";
                    }
                } catch (err) {
                    status = `ERROR: Gagal load profil`;
                }

                const dataToSave = { username, platform, status, igLinks: igLinksClean, dateScraped: new Date().toISOString() };
                currentResults.push(dataToSave);

                statusText.innerHTML = `${currentIndexInfo} Selesai mengecek ${username} - ${status}`;

                if (status === 'SUCCESS') {
                    addResultRow(dataToSave);
                    totalFound++;
                    countSuccess.textContent = `${totalFound} Found`;
                }
            }

            statusText.innerHTML = `<span style="color: var(--success)">🎉 Proses Selesai! Menemukan ${totalFound} profil dengan Instagram.</span>`;

            if (currentResults.length > 0) {
                btnExportCsv.classList.remove('hide');
                btnExportJson.classList.remove('hide');
            }

        } catch (error) {
            statusText.innerHTML = `<span style="color: var(--danger)">Terjadi kesalahan fatal: ${error.message}</span>`;
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

        // URL Profil (Linktree atau Lynk.id) untuk kolom ke-3
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
        let actionBtn = `<button class="btn-visit disabled"><i data-lucide="external-link"></i> N/A</button>`;
        if (item.igLinks && item.igLinks.length > 0) {
            actionBtn = `<a href="${item.igLinks[0]}" target="_blank" class="btn-visit"><i data-lucide="external-link"></i> Visit IG</a>`;
        }

        tr.innerHTML = `
            <td style="font-weight: 600">@${item.username}</td>
            <td><span class="status-badge status-success">SUCCESS</span></td>
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
            const linksStr = r.igLinks && r.igLinks.length > 0 ? r.igLinks.join(' | ') : '';
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
