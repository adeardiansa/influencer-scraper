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
     * Ekstraksi handle Instagram dari URL, Title, atau Snippet (untuk Phase 1 Discovery)
     */
    function extractInstagramUser(url, title, snippet) {
        const urlMatch = (url || '').match(/instagram\.com(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
        if (urlMatch && urlMatch[1]) {
            const u = urlMatch[1].toLowerCase().replace(/\/$/, '').trim();
            if (!nonProfiles.includes(u) && u.length > 1) {
                return u;
            }
        }
        if (title) {
            const tm = title.match(/@([a-zA-Z0-9_.]+)/);
            if (tm && tm[1]) {
                const u = tm[1].toLowerCase().replace(/[.,!?:;]$/, '').trim();
                if (!nonProfiles.includes(u) && u.length > 1) {
                    return u;
                }
            }
        }
        if (snippet) {
            const sm = snippet.match(/@([a-zA-Z0-9_.]+)/);
            if (sm && sm[1]) {
                const u = sm[1].toLowerCase().replace(/[.,!?:;]$/, '').trim();
                if (!nonProfiles.includes(u) && u.length > 1) {
                    return u;
                }
            }
        }
        return null;
    }

    /**
     * Cari kecocokan akun Instagram yang paling relevan (Strict & Smart Matching)
     * Mencegah akun orang lain yang cuma me-mention agar tidak keliru dianggap akun kreator.
     */
    function findBestInstagramMatch(organicResults, originalUsername) {
        if (!Array.isArray(organicResults) || organicResults.length === 0) return null;
        const targetNorm = originalUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
        let bestCandidate = null;
        let highestScore = 0;

        for (const r of organicResults) {
            // 1. Cek handle langsung dari URL profil instagram.com/<handle>
            const m = (r.url || '').match(/instagram\.com(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
            let candidate = null;
            if (m && m[1]) {
                const u = m[1].toLowerCase().replace(/\/$/, '').trim();
                if (!nonProfiles.includes(u) && u.length > 1) {
                    candidate = u;
                }
            }

            // 2. Fallback cek pola @handle di Title jika URL adalah post/reel
            if (!candidate) {
                const tm = (r.title || '').match(/@([a-zA-Z0-9_.]+)/);
                if (tm && tm[1]) {
                    const u = tm[1].toLowerCase().replace(/[.,!?:;]$/, '').trim();
                    if (!nonProfiles.includes(u) && u.length > 1) {
                        candidate = u;
                    }
                }
            }

            if (candidate) {
                const candNorm = candidate.replace(/[^a-z0-9]/g, '');
                let score = 0;

                // Skor 100: Persis sama (tanpa tanda baca/underscore)
                if (candNorm === targetNorm) {
                    score = 100;
                }
                // Skor 80: Mengandung satu sama lain (misal torenda vs torenda.official atau torendaid)
                else if (candNorm.includes(targetNorm) || targetNorm.includes(candNorm)) {
                    score = 80;
                }
                // Skor 20: Tidak mirip (kemungkinan akun orang lain yang me-mention/collab)
                else {
                    score = 20;
                }

                if (score > highestScore) {
                    highestScore = score;
                    bestCandidate = candidate;
                }
            }
        }

        // Hanya terima jika tingkat kecocokan tinggi (score >= 70)
        return highestScore >= 70 ? bestCandidate : null;
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
                    const igDatasets = await runApifyGoogleSearch(igQueries, apiToken, 5);
                    if (Array.isArray(igDatasets)) {
                        igDatasets.forEach(item => {
                            const queryTerm = (item.searchQuery ? item.searchQuery.term : '').toLowerCase();
                            const results = item.organicResults || [];

                            // Cari kreator yang bersesuaian dengan query ini
                            const matchedUser = needIgLookup.find(u =>
                                queryTerm.includes(`"${u.username.toLowerCase()}"`) ||
                                queryTerm.includes(u.username.toLowerCase())
                            );

                            if (matchedUser) {
                                const bestIgCandidate = findBestInstagramMatch(results, matchedUser.username);
                                if (bestIgCandidate) {
                                    igResultMap.set(matchedUser.username.toLowerCase(), bestIgCandidate);
                                }
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
                let igHandle = null;

                if (user.platform === 'instagram.com') {
                    igHandle = user.username;
                    user.status = 'KOL INSTAGRAM';
                } else {
                    const matchedCandidate = igResultMap.get(user.username.toLowerCase()) || null;
                    if (matchedCandidate) {
                        igHandle = matchedCandidate;
                        user.status = 'VERIFIED IG';
                    }
                }

                const igLinks = igHandle ? [`https://www.instagram.com/${igHandle}/`] : [];

                const dataToSave = {
                    username: user.username,
                    igHandle: igHandle,
                    platform: user.platform,
                    title: user.title,
                    description: user.description,
                    profileUrl: user.profileUrl,
                    status: user.status,
                    igLinks: igLinks,
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

        // Creator Cell
        let creatorCellHtml = '';
        if (platform === 'instagram.com') {
            creatorCellHtml = `
                <div class="user-cell">
                    <a href="${item.profileUrl}" target="_blank" rel="noopener noreferrer" class="user-handle">@${item.username}</a>
                    <span class="user-country">📸 Akun Resmi Instagram</span>
                </div>
            `;
        } else {
            let igSubHtml = '';
            if (item.igHandle) {
                igSubHtml = `
                    <a href="https://www.instagram.com/${item.igHandle}/" target="_blank" rel="noopener noreferrer" class="user-ig-sub" title="Akun Instagram Terverifikasi">
                        ↳ <i data-lucide="instagram" style="width:11px;height:11px"></i> IG: <strong>@${item.igHandle}</strong>
                    </a>
                `;
            } else {
                const platformName = platform === 'lynk.id' ? 'Lynk.id' : 'Linktree';
                igSubHtml = `<span class="user-country">🇮🇩 Profil ${platformName}</span>`;
            }

            creatorCellHtml = `
                <div class="user-cell">
                    <a href="${item.profileUrl}" target="_blank" rel="noopener noreferrer" class="user-handle" title="Buka profil ${platform}">@${item.username}</a>
                    ${igSubHtml}
                </div>
            `;
        }

        // Action Button
        let actionBtn = '';
        if (item.igHandle) {
            actionBtn = `<a href="https://www.instagram.com/${item.igHandle}/" target="_blank" rel="noopener noreferrer" class="btn-visit btn-ig" title="Kunjungi @${item.igHandle} di Instagram"><i data-lucide="instagram"></i> Visit IG (@${item.igHandle})</a>`;
        } else {
            actionBtn = `<a href="https://www.instagram.com/${item.username}/" target="_blank" rel="noopener noreferrer" class="btn-visit" title="Cari @${item.username} di Instagram"><i data-lucide="search"></i> Cari di IG</a>`;
        }

        // Bio Snippet
        const bioText = item.description || item.title || 'Profil kreator Indonesia';

        tr.innerHTML = `
            <td data-label="Creator / KOL">
                ${creatorCellHtml}
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
        let csvContent = 'Username Profil,Akun Instagram,Platform,Negara,Profile URL,Instagram URL,Bio / Info,Status,Tanggal Scraped\n';
        currentResults.forEach(r => {
            const igHandle = r.igHandle || (r.platform === 'instagram.com' ? r.username : '-');
            const igUrl = r.igLinks && r.igLinks.length > 0 ? r.igLinks[0] : (r.igHandle ? `https://www.instagram.com/${r.igHandle}/` : `https://www.instagram.com/${r.username}/`);
            const cleanBio = (r.description || r.title || '').replace(/"/g, '""').replace(/\n/g, ' ');
            csvContent += `"${r.username}","${igHandle}","${r.platform}","${r.country}","${r.profileUrl}","${igUrl}","${cleanBio}","${r.status}","${r.dateScraped}"\n`;
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
