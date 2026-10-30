document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('search-form');
    const input = document.getElementById('keyword-input');
    const apiTokenInput = document.getElementById('api-token-input');
    const btnToggleToken = document.getElementById('btn-toggle-token');
    const iconEye = document.getElementById('icon-eye');
    const platformSelect = document.getElementById('platform-select');
    const limitSelect = document.getElementById('limit-select');

    // Default Apify Token bawaan
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

    const nonProfiles = [
        'p', 'reel', 'reels', 'stories', 'explore', 'tags', 'tv', 'direct',
        'popular', 'accounts', 'about', 'legal', 'terms', 'privacy',
        'developer', 'directory', 'help', 'login', 'signup', 'home',
        'pricing', 'contact', 'affiliate', 'faq', 'undefined', 'blog',
        'shop', 'page', 'join', 'register', 'tentang'
    ];

    /**
     * Ekstraksi handle Instagram dari URL, Title, atau Snippet
     */
    function extractInstagramUser(url, title, snippet) {
        // 1. Ekstraksi langsung dari URL instagram.com/<username>
        const urlMatch = (url || '').match(/instagram\.com(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
        if (urlMatch && urlMatch[1]) {
            const u = urlMatch[1].toLowerCase().replace(/\/$/, '').trim();
            if (!nonProfiles.includes(u) && u.length > 1) {
                return u;
            }
        }

        // 2. Ekstraksi pola @username dari Title
        if (title) {
            const titleMatch = title.match(/@([a-zA-Z0-9_.]+)/);
            if (titleMatch && titleMatch[1]) {
                const u = titleMatch[1].toLowerCase().replace(/[.,!?:;]$/, '').trim();
                if (!nonProfiles.includes(u) && u.length > 1) {
                    return u;
                }
            }
        }

        // 3. Ekstraksi pola @username dari Snippet
        if (snippet) {
            const snipMatch = snippet.match(/@([a-zA-Z0-9_.]+)/);
            if (snipMatch && snipMatch[1]) {
                const u = snipMatch[1].toLowerCase().replace(/[.,!?:;]$/, '').trim();
                if (!nonProfiles.includes(u) && u.length > 1) {
                    return u;
                }
            }
        }

        return null;
    }

    /**
     * Panggil Apify Google Search Scraper Actor via REST API secara synchronous
     * dengan target regional dan bahasa Indonesia (countryCode: "id", languageCode: "id")
     */
    async function runApifyGoogleSearch(queriesText, token, resultsPerPage = 30) {
        const endpoint = `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                queries: queriesText,
                countryCode: 'id',
                languageCode: 'id',
                maxPagesPerQuery: 1,
                resultsPerPage: resultsPerPage
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Apify API Token tidak valid (401 Unauthorized). Silakan cek kembali token Anda.');
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

    /**
     * Ekstraksi kandidat kreator dari hasil organic Google Search
     */
    function parseOrganicResults(datasets, usersMap, platformChoice) {
        if (!Array.isArray(datasets)) return;

        datasets.forEach(queryItem => {
            const organic = queryItem.organicResults || [];
            organic.forEach(res => {
                const url = res.url || '';
                const title = res.title || '';
                const snippet = res.description || '';

                // 1. Deteksi Instagram KOL
                if (url.includes('instagram.com') && (platformChoice === 'all' || platformChoice === 'instagram')) {
                    const igUser = extractInstagramUser(url, title, snippet);
                    if (igUser && !nonProfiles.includes(igUser)) {
                        if (!usersMap.has(igUser)) {
                            usersMap.set(igUser, {
                                username: igUser,
                                platform: 'instagram.com',
                                title: title || `KOL Instagram @${igUser}`,
                                description: snippet,
                                profileUrl: `https://www.instagram.com/${igUser}/`,
                                igLinks: [`https://www.instagram.com/${igUser}/`],
                                status: 'KOL INSTAGRAM',
                                country: 'Indonesia 🇮🇩'
                            });
                        }
                    }
                }

                // 2. Deteksi Lynk.id (Platform Bio link asli Indonesia)
                else if (url.includes('lynk.id') && (platformChoice === 'all' || platformChoice === 'lynk')) {
                    const match = url.match(/lynk\.id(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
                    if (match && match[1]) {
                        const username = match[1].toLowerCase().trim();
                        if (username && !nonProfiles.includes(username) && !usersMap.has(username)) {
                            usersMap.set(username, {
                                username: username,
                                platform: 'lynk.id',
                                title: title || `Lynk.id Profile @${username}`,
                                description: snippet,
                                profileUrl: `https://lynk.id/${username}`,
                                igLinks: [],
                                status: 'LYNK.ID CREATOR',
                                country: 'Indonesia 🇮🇩'
                            });
                        }
                    }
                }

                // 3. Deteksi Linktree Indonesia
                else if (url.includes('linktr.ee') && (platformChoice === 'all' || platformChoice === 'linktree')) {
                    const match = url.match(/linktr\.ee(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
                    if (match && match[1]) {
                        const username = match[1].toLowerCase().trim();
                        if (username && !nonProfiles.includes(username) && !usersMap.has(username)) {
                            usersMap.set(username, {
                                username: username,
                                platform: 'linktr.ee',
                                title: title || `Linktree Profile @${username}`,
                                description: snippet,
                                profileUrl: `https://linktr.ee/${username}`,
                                igLinks: [],
                                status: 'LINKTREE CREATOR',
                                country: 'Indonesia 🇮🇩'
                            });
                        }
                    }
                }
            });
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keyword = input.value.trim();
        const apiToken = (apiTokenInput ? apiTokenInput.value.trim() : '') || DEFAULT_APIFY_TOKEN;
        const platformChoice = platformSelect ? platformSelect.value : 'all';
        const minTarget = parseInt(limitSelect ? limitSelect.value : '10', 10) || 10;

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
        countSuccess.textContent = '0 Ditemukan';
        btnExportCsv.classList.add('hide');
        btnExportJson.classList.add('hide');

        searchBtn.disabled = true;
        btnText.classList.add('hide');
        spinner.classList.remove('hide');

        statusContainer.classList.remove('hide');
        resultsSection.classList.remove('hide');
        progressBar.classList.add('pulsing');

        statusText.innerHTML = `🚀 Memulai scraping untuk keyword: "<strong>${keyword}</strong>" (Khusus Indonesia 🇮🇩, Target Minimal: ${minTarget})...`;

        try {
            // TAHAP 1: DISCOVERY INFLUENCER & KOL INDONESIA
            statusText.innerHTML = `🔍 <strong>TAHAP 1:</strong> Menelusuri database Google Indonesia untuk menemukan profil kreator...`;

            let primaryQueries = [];
            if (platformChoice === 'all' || platformChoice === 'instagram') {
                primaryQueries.push(`site:instagram.com ${keyword} (endorse OR "paid promote" OR kol OR influencer) indonesia`);
                primaryQueries.push(`site:instagram.com ${keyword} (creator OR blogger OR vlogger) (jakarta OR surabaya OR bandung OR indonesia)`);
            }
            if (platformChoice === 'all' || platformChoice === 'lynk') {
                primaryQueries.push(`site:lynk.id ${keyword}`);
            }
            if (platformChoice === 'all' || platformChoice === 'linktree') {
                primaryQueries.push(`site:linktr.ee ${keyword} (indonesia OR jakarta OR bandung OR surabaya)`);
            }

            let usersMap = new Map();

            // Jalankan Batch 1
            const datasets = await runApifyGoogleSearch(primaryQueries.join('\n'), apiToken, 30);
            parseOrganicResults(datasets, usersMap, platformChoice);

            // JIKA HASIL KURANG DARI TARGET MINIMAL (misal < 10):
            // Otomatis jalankan ekspansi query variasi Indonesia agar mencapai minimal target
            if (usersMap.size < minTarget) {
                statusText.innerHTML = `⚡ Ditemukan ${usersMap.size} profil. Menjalankan ekspansi pencarian agar mencapai minimal ${minTarget} hasil...`;
                
                let expandQueries = [];
                if (platformChoice === 'all' || platformChoice === 'instagram') {
                    expandQueries.push(`site:instagram.com "${keyword}" indonesia`);
                    expandQueries.push(`site:instagram.com "${keyword}" endorse jakarta`);
                }
                if (platformChoice === 'all' || platformChoice === 'lynk') {
                    expandQueries.push(`site:lynk.id "${keyword}"`);
                }
                if (platformChoice === 'all' || platformChoice === 'linktree') {
                    expandQueries.push(`site:linktr.ee "${keyword}" endorse indonesia`);
                }

                if (expandQueries.length > 0) {
                    try {
                        const expandDatasets = await runApifyGoogleSearch(expandQueries.join('\n'), apiToken, 30);
                        parseOrganicResults(expandDatasets, usersMap, platformChoice);
                    } catch (err) {
                        console.warn('Expansion query error:', err);
                    }
                }
            }

            const targetUsers = Array.from(usersMap.values());

            if (targetUsers.length === 0) {
                statusText.innerHTML = `<span style="color: var(--danger)">❌ Tidak menemukan profil influencer dari keyword "${keyword}". Silakan coba kata kunci lain (misal: fashion, beauty, kuliner, gadget).</span>`;
                finishScraping();
                return;
            }

            statusText.innerHTML = `✅ Ditemukan <strong>${targetUsers.length}</strong> profil kreator Indonesia. Menyinkronkan Instagram...`;
            await delay(800);

            // TAHAP 2: LOOKUP INSTAGRAM UNTUK PROFIL LYNK.ID / LINKTREE YANG BELUM ADA IG
            const needIgLookup = targetUsers.filter(u => u.platform !== 'instagram.com');
            const igResultMap = new Map();

            if (needIgLookup.length > 0) {
                statusText.innerHTML = `📱 <strong>TAHAP 2:</strong> Memverifikasi akun Instagram untuk ${needIgLookup.length} kreator bio...`;
                // Buat query batch untuk pencarian IG
                const igQueries = needIgLookup.map(u => `site:instagram.com "${u.username}"`).join('\n');

                try {
                    const igDatasets = await runApifyGoogleSearch(igQueries, apiToken, 3);
                    if (Array.isArray(igDatasets)) {
                        igDatasets.forEach(item => {
                            const queryTerm = item.searchQuery ? item.searchQuery.term : '';
                            const results = item.organicResults || [];

                            let detectedIg = null;
                            for (const r of results) {
                                const igUser = extractInstagramUser(r.url, r.title, r.description);
                                if (igUser) {
                                    detectedIg = `https://www.instagram.com/${igUser}/`;
                                    break;
                                }
                            }

                            if (detectedIg) {
                                igResultMap.set(queryTerm.toLowerCase(), detectedIg);
                            }
                        });
                    }
                } catch (err) {
                    console.warn('Batch IG lookup warning:', err);
                }
            }

            // Tampilkan hasil ke UI tabel
            for (let i = 0; i < targetUsers.length; i++) {
                const user = targetUsers[i];
                let igLink = null;

                if (user.platform === 'instagram.com') {
                    igLink = user.profileUrl;
                    user.status = 'KOL INSTAGRAM';
                } else {
                    const queryKey = `site:instagram.com "${user.username}"`.toLowerCase();
                    const matchedIg = igResultMap.get(queryKey) || null;
                    if (matchedIg) {
                        igLink = matchedIg;
                        user.status = 'VERIFIED IG';
                    }
                }

                if (igLink && !user.igLinks.includes(igLink)) {
                    user.igLinks = [igLink];
                }

                const dataToSave = {
                    username: user.username,
                    platform: user.platform,
                    title: user.title,
                    description: user.description,
                    profileUrl: user.profileUrl,
                    status: user.status,
                    igLinks: user.igLinks,
                    country: 'Indonesia 🇮🇩',
                    dateScraped: new Date().toISOString()
                };

                currentResults.push(dataToSave);
                addResultRow(dataToSave);

                totalFound++;
                countSuccess.textContent = `${totalFound} Ditemukan`;

                statusText.innerHTML = `[${i + 1}/${targetUsers.length}] Memproses @${user.username} (${user.platform}) - ${user.status}`;
                await delay(60);
            }

            const igCount = currentResults.filter(r => r.igLinks && r.igLinks.length > 0).length;
            statusText.innerHTML = `<span style="color: var(--success)">🎉 Selesai! Berhasil menemukan <strong>${totalFound}</strong> kreator Indonesia (${igCount} memiliki link Instagram aktif).</span>`;

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
        const platform = item.platform || 'instagram.com';

        // Badge Platform
        let platformBadge = '';
        if (platform === 'instagram.com') {
            platformBadge = `<span class="platform-pill pill-instagram"><i data-lucide="camera" style="width:12px;height:12px"></i> Instagram</span>`;
        } else if (platform === 'lynk.id') {
            platformBadge = `<span class="platform-pill pill-lynk"><i data-lucide="link" style="width:12px;height:12px"></i> Lynk.id</span>`;
        } else {
            platformBadge = `<span class="platform-pill pill-linktree"><i data-lucide="share-2" style="width:12px;height:12px"></i> Linktree</span>`;
        }

        // Status Badge
        let statusBadgeHtml = '';
        if (item.status === 'KOL INSTAGRAM') {
            statusBadgeHtml = `<span class="status-badge status-kol-ig">✨ KOL INSTAGRAM</span>`;
        } else if (item.status === 'VERIFIED IG') {
            statusBadgeHtml = `<span class="status-badge status-success">✓ VERIFIED IG</span>`;
        } else {
            statusBadgeHtml = `<span class="status-badge status-found">PROFIL AKTIF</span>`;
        }

        // Action Button
        let actionBtn = '';
        if (item.igLinks && item.igLinks.length > 0) {
            actionBtn = `<a href="${item.igLinks[0]}" target="_blank" rel="noopener noreferrer" class="btn-visit btn-ig"><i data-lucide="instagram"></i> Visit IG</a>`;
        } else {
            actionBtn = `<a href="https://www.instagram.com/${item.username}/" target="_blank" rel="noopener noreferrer" class="btn-visit"><i data-lucide="search"></i> Cari IG</a>`;
        }

        // Bio Snippet
        const bioText = item.description || item.title || 'Profil kreator Indonesia';

        tr.innerHTML = `
            <td data-label="Creator / KOL">
                <div class="user-cell">
                    <a href="${item.profileUrl}" target="_blank" rel="noopener noreferrer" class="user-handle">@${item.username}</a>
                    <span class="user-country">🇮🇩 Indonesia</span>
                </div>
            </td>
            <td data-label="Platform">${platformBadge}</td>
            <td data-label="Bio / Niche">
                <div class="bio-snippet" title="${bioText.replace(/"/g, '&quot;')}">${bioText}</div>
            </td>
            <td data-label="Status">${statusBadgeHtml}</td>
            <td data-label="Action">${actionBtn}</td>
        `;

        resultsBody.appendChild(tr);
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // Export Handlers
    btnExportCsv.addEventListener('click', () => {
        if (currentResults.length === 0) return;
        let csvContent = 'Username,Platform,Negara,Profile URL,Instagram URL,Bio / Info,Status,Tanggal Scraped\n';
        currentResults.forEach(r => {
            const igUrl = r.igLinks && r.igLinks.length > 0 ? r.igLinks[0] : `https://www.instagram.com/${r.username}/`;
            const cleanBio = (r.description || r.title || '').replace(/"/g, '""').replace(/\n/g, ' ');
            csvContent += `"${r.username}","${r.platform}","${r.country}","${r.profileUrl}","${igUrl}","${cleanBio}","${r.status}","${r.dateScraped}"\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        downloadBlob(blob, `influencer_indonesia_${Date.now()}.csv`);
    });

    btnExportJson.addEventListener('click', () => {
        if (currentResults.length === 0) return;
        const jsonStr = JSON.stringify(currentResults, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        downloadBlob(blob, `influencer_indonesia_${Date.now()}.json`);
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
