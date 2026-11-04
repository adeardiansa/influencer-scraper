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

    // Rute internal & URL sistem Instagram yang BUKAN akun pengguna
    const INSTAGRAM_RESERVED_ROUTES = [
        'about', 'accounts', 'api', 'blog', 'business', 'channel', 'channels',
        'community', 'contact', 'creator', 'creators', 'developer', 'developers',
        'directory', 'direct', 'download', 'emails', 'events', 'explore',
        'features', 'graphql', 'guide', 'guides', 'help', 'integrity',
        'invites', 'jobs', 'legal', 'link', 'live', 'login', 'media', 'meta',
        'p', 'popular', 'press', 'privacy', 'profile', 'reel', 'reels',
        'safety', 'security', 'session', 'settings', 'share', 'shop', 'signup',
        'stories', 'story', 'support', 'tags', 'terms', 'threads', 'tv',
        'v', 'video', 'web', 'your_activity', 'home', 'pricing', 'affiliate',
        'faq', 'undefined', 'page', 'join', 'register', 'tentang'
    ];

    /**
     * Validasi ketat format handle Instagram:
     * 1. Panjang 2 - 30 karakter
     * 2. Hanya huruf (a-z), angka (0-9), titik (.), dan garis bawah (_)
     * 3. TIDAK boleh mengandung tanda strip (-) atau spasi
     * 4. TIDAK boleh diawali atau diakhiri titik (.)
     * 5. TIDAK boleh mengandung dua titik berturut-turut (..)
     * 6. Bukan rute internal Instagram (p, reel, popular, explore, dll)
     */
    function isValidInstagramHandle(handle) {
        if (!handle || typeof handle !== 'string') return false;
        let clean = handle.trim().toLowerCase().replace(/^@/, '');
        clean = clean.replace(/[\/.,!?:;]+$/, '').replace(/^[\/.,!?:;]+/, '');

        if (clean.length < 2 || clean.length > 30) return false;
        if (!/^[a-z0-9_][a-z0-9_.]*[a-z0-9_]$/.test(clean) && !/^[a-z0-9_]$/.test(clean)) return false;
        if (clean.includes('..')) return false;
        if (INSTAGRAM_RESERVED_ROUTES.includes(clean)) return false;

        return true;
    }

    /**
     * Bersihkan teks handle dan pastikan valid
     */
    function cleanInstagramHandle(handle) {
        if (!handle || typeof handle !== 'string') return null;
        let clean = handle.trim().toLowerCase().replace(/^@/, '');
        clean = clean.replace(/[\/.,!?:;]+$/, '').replace(/^[\/.,!?:;]+/, '');
        return isValidInstagramHandle(clean) ? clean : null;
    }

    /**
     * Ekstraksi handle Instagram dari URL, Title, atau Snippet (untuk Phase 1 Discovery)
     */
    function extractInstagramUser(url, title, snippet) {
        // 1. Ekstraksi langsung dari URL: instagram.com/<handle>
        const urlMatch = (url || '').match(/instagram\.com(?:\/|%2F)([a-zA-Z0-9_.]+)/i);
        if (urlMatch && urlMatch[1]) {
            const cleaned = cleanInstagramHandle(urlMatch[1]);
            if (cleaned) {
                return cleaned;
            }
        }

        // 2. Ekstraksi pola @handle dari Title (misal: "Nama (@handle) • Instagram photos")
        if (title) {
            const tm = title.match(/@([a-zA-Z0-9_.]+)/);
            if (tm && tm[1]) {
                const cleaned = cleanInstagramHandle(tm[1]);
                if (cleaned) {
                    return cleaned;
                }
            }
        }

        // 3. Ekstraksi pola @handle dari Snippet
        if (snippet) {
            const sm = snippet.match(/@([a-zA-Z0-9_.]+)/);
            if (sm && sm[1]) {
                const cleaned = cleanInstagramHandle(sm[1]);
                if (cleaned) {
                    return cleaned;
                }
            }
        }

        return null;
    }

    /**
     * Ekstraksi handle TikTok dari URL profil/video: tiktok.com/@<handle>
     * Aturan TikTok: 2 - 24 karakter, huruf/angka/titik/garis bawah, tidak diakhiri titik.
     * URL non-akun (misal /discover/, /tag/) otomatis diabaikan karena tidak memakai "@".
     */
    function extractTiktokUser(url) {
        const m = (url || '').match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/i);
        if (!m || !m[1]) return null;
        const clean = m[1].toLowerCase().replace(/\.+$/, '');
        if (clean.length < 2 || clean.length > 24) return null;
        return clean;
    }

    /**
     * Cari kecocokan akun TikTok yang paling relevan.
     * Hanya menerima handle yang sama/mirip: query "@username" membuat hampir semua hasil
     * menyebut username di judul/deskripsi, sehingga aturan itu memicu salah cocok.
     */
    function findBestTiktokMatch(organicResults, originalUsername) {
        if (!Array.isArray(organicResults) || organicResults.length === 0) return null;
        const targetNorm = originalUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
        let bestCandidate = null;
        let highestScore = 0;

        for (const r of organicResults) {
            const candidate = extractTiktokUser(r.url);
            if (!candidate) continue;

            const candNorm = candidate.replace(/[^a-z0-9]/g, '');
            let score = 20;
            if (candNorm === targetNorm) {
                score = 100;
            } else if (candNorm.includes(targetNorm) || targetNorm.includes(candNorm)) {
                score = 80;
            }

            if (score > highestScore) {
                highestScore = score;
                bestCandidate = candidate;
            }
        }

        return highestScore >= 70 ? bestCandidate : null;
    }

    /**
     * Cari kecocokan akun Instagram yang paling relevan (Strict & Smart Matching)
     * Hanya menerima handle yang valid dan memiliki skor kemiripan tinggi.
     */
    function findBestInstagramMatch(organicResults, originalUsername) {
        if (!Array.isArray(organicResults) || organicResults.length === 0) return null;
        const targetNorm = originalUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
        let bestCandidate = null;
        let highestScore = 0;

        for (const r of organicResults) {
            let candidate = null;

            // 1. Cek dari URL profil
            const m = (r.url || '').match(/instagram\.com(?:\/|%2F)([a-zA-Z0-9_.]+)/i);
            if (m && m[1]) {
                candidate = cleanInstagramHandle(m[1]);
            }

            // 2. Cek dari Title (@handle)
            if (!candidate && r.title) {
                const tm = r.title.match(/@([a-zA-Z0-9_.]+)/);
                if (tm && tm[1]) {
                    candidate = cleanInstagramHandle(tm[1]);
                }
            }

            if (candidate) {
                const candNorm = candidate.replace(/[^a-z0-9]/g, '');
                let score = 0;

                // Skor 100: Persis sama
                if (candNorm === targetNorm) {
                    score = 100;
                }
                // Skor 80: Mengandung satu sama lain (misal torenda vs torendajewelry)
                else if (candNorm.includes(targetNorm) || targetNorm.includes(candNorm)) {
                    score = 80;
                }
                // Skor 75: Bio atau deskripsi profil Instagram secara eksplisit memuat link bio kreator (misal "lynk.id/xxx" atau "linktr.ee/xxx")
                else if (
                    (r.description && r.description.toLowerCase().includes(originalUsername.toLowerCase())) ||
                    (r.title && r.title.toLowerCase().includes(originalUsername.toLowerCase()))
                ) {
                    score = 75;
                }
                // Skor 20: Tidak mirip
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
                    if (igUser && isValidInstagramHandle(igUser)) {
                        if (!usersMap.has(igUser)) {
                            usersMap.set(igUser, {
                                username: igUser,
                                igHandle: igUser,
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

                // 2. Deteksi TikTok KOL
                else if (url.includes('tiktok.com') && (platformChoice === 'all' || platformChoice === 'tiktok')) {
                    const ttUser = extractTiktokUser(url);
                    const key = ttUser ? `tiktok:${ttUser}` : null;
                    if (ttUser && !usersMap.has(key)) {
                        usersMap.set(key, {
                            username: ttUser,
                            igHandle: null,
                            tiktokHandle: ttUser,
                            platform: 'tiktok.com',
                            title: title || `KOL TikTok @${ttUser}`,
                            description: snippet,
                            profileUrl: `https://www.tiktok.com/@${ttUser}`,
                            igLinks: [],
                            status: 'KOL TIKTOK',
                            country: 'Indonesia 🇮🇩'
                        });
                    }
                }

                // 3. Deteksi Lynk.id (Platform Bio link asli Indonesia)
                else if (url.includes('lynk.id') && (platformChoice === 'all' || platformChoice === 'lynk')) {
                    const match = url.match(/lynk\.id(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
                    if (match && match[1]) {
                        const username = match[1].toLowerCase().trim().replace(/\/$/, '');
                        if (username && !INSTAGRAM_RESERVED_ROUTES.includes(username) && !usersMap.has(username)) {
                            usersMap.set(username, {
                                username: username,
                                igHandle: null,
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

                // 4. Deteksi Linktree Indonesia
                else if (url.includes('linktr.ee') && (platformChoice === 'all' || platformChoice === 'linktree')) {
                    const match = url.match(/linktr\.ee(?:\/|%2F)([a-zA-Z0-9_.-]+)/i);
                    if (match && match[1]) {
                        const username = match[1].toLowerCase().trim().replace(/\/$/, '');
                        if (username && !INSTAGRAM_RESERVED_ROUTES.includes(username) && !usersMap.has(username)) {
                            usersMap.set(username, {
                                username: username,
                                igHandle: null,
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
                primaryQueries.push(`site:instagram.com "${keyword}" (endorse OR "paid promote" OR kol OR influencer) indonesia`);
                primaryQueries.push(`site:instagram.com "${keyword}" (creator OR blogger OR vlogger) (jakarta OR surabaya OR bandung OR indonesia)`);
            }
            if (platformChoice === 'all' || platformChoice === 'tiktok') {
                primaryQueries.push(`site:tiktok.com "${keyword}" (endorse OR kol OR influencer) indonesia`);
                primaryQueries.push(`site:tiktok.com "${keyword}" (creator OR "open collab" OR review) (jakarta OR surabaya OR bandung OR indonesia)`);
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
                if (platformChoice === 'all' || platformChoice === 'tiktok') {
                    expandQueries.push(`site:tiktok.com "${keyword}" indonesia`);
                    expandQueries.push(`site:tiktok.com "${keyword}" endorse jakarta`);
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

            // TAHAP 2: LOOKUP INSTAGRAM UNTUK PROFIL LYNK.ID / LINKTREE / TIKTOK YANG BELUM ADA IG
            const needIgLookup = targetUsers.filter(u => u.platform !== 'instagram.com');
            const igResultMap = new Map();

            if (needIgLookup.length > 0) {
                statusText.innerHTML = `📱 <strong>TAHAP 2:</strong> Memverifikasi akun Instagram untuk ${needIgLookup.length} kreator...`;
                // Buat query batch untuk pencarian IG (mencari berdasarkan username dan bio-link yang ditempel di profil IG)
                const igQueries = needIgLookup.map(u => {
                    if (u.platform === 'tiktok.com') {
                        return `site:instagram.com "${u.username}"`;
                    }
                    const domain = u.platform === 'lynk.id' ? 'lynk.id' : 'linktr.ee';
                    return `site:instagram.com "${u.username}" OR "${domain}/${u.username}"`;
                }).join('\n');

                try {
                    const igDatasets = await runApifyGoogleSearch(igQueries, apiToken, 5);
                    if (Array.isArray(igDatasets)) {
                        igDatasets.forEach(item => {
                            const queryTerm = (item.searchQuery ? item.searchQuery.term : '').toLowerCase();
                            const results = item.organicResults || [];

                            // Cari kreator yang bersesuaian dengan query ini
                            const matchedUser = needIgLookup.find(u =>
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

            // TAHAP 3: LOOKUP TIKTOK UNTUK KREATOR YANG BUKAN BERASAL DARI TIKTOK
            const needTtLookup = targetUsers.filter(u => u.platform !== 'tiktok.com');
            const ttResultMap = new Map();

            if (needTtLookup.length > 0) {
                statusText.innerHTML = `🎵 <strong>TAHAP 3:</strong> Mencari akun TikTok untuk ${needTtLookup.length} kreator...`;
                const ttQueryToUser = new Map();
                needTtLookup.forEach(u => ttQueryToUser.set(`site:tiktok.com "@${u.username}"`.toLowerCase(), u));

                try {
                    const ttDatasets = await runApifyGoogleSearch(Array.from(ttQueryToUser.keys()).join('\n'), apiToken, 5);
                    if (Array.isArray(ttDatasets)) {
                        ttDatasets.forEach(item => {
                            const queryTerm = (item.searchQuery ? item.searchQuery.term : '').toLowerCase();
                            const matchedUser = ttQueryToUser.get(queryTerm);
                            if (matchedUser) {
                                const bestTtCandidate = findBestTiktokMatch(item.organicResults || [], matchedUser.username);
                                if (bestTtCandidate) {
                                    ttResultMap.set(matchedUser.username.toLowerCase(), bestTtCandidate);
                                }
                            }
                        });
                    }
                } catch (err) {
                    console.warn('Batch TikTok lookup warning:', err);
                }
            }

            // Tampilkan hasil ke UI tabel
            for (let i = 0; i < targetUsers.length; i++) {
                const user = targetUsers[i];
                let igHandle = null;

                if (user.platform === 'instagram.com') {
                    igHandle = user.username;
                    user.status = 'KOL INSTAGRAM';
                } else if (user.platform === 'tiktok.com') {
                    igHandle = igResultMap.get(user.username.toLowerCase()) || null;
                    user.status = 'KOL TIKTOK';
                } else {
                    const matchedCandidate = igResultMap.get(user.username.toLowerCase()) || null;
                    if (matchedCandidate) {
                        igHandle = matchedCandidate;
                        user.status = 'VERIFIED IG';
                    } else {
                        user.status = 'NO_IG';
                    }
                }

                user.igHandle = igHandle;
                if (!user.tiktokHandle) {
                    user.tiktokHandle = ttResultMap.get(user.username.toLowerCase()) || null;
                }
                const igLinks = igHandle ? [`https://www.instagram.com/${igHandle}/`] : [];

                const dataToSave = {
                    username: user.username,
                    igHandle: igHandle,
                    tiktokHandle: user.tiktokHandle || null,
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

            const igCount = currentResults.filter(r => r.igHandle).length;
            const ttCount = currentResults.filter(r => r.tiktokHandle).length;
            statusText.innerHTML = `<span style="color: var(--success)">🎉 Selesai! Berhasil menemukan <strong>${totalFound}</strong> kreator Indonesia (${igCount} akun Instagram, ${ttCount} akun TikTok).</span>`;

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
        } else if (platform === 'tiktok.com') {
            platformBadge = `<span class="platform-pill pill-tiktok"><i data-lucide="music-2" style="width:12px;height:12px"></i> TikTok</span>`;
        } else if (platform === 'lynk.id') {
            platformBadge = `<span class="platform-pill pill-lynk"><i data-lucide="link" style="width:12px;height:12px"></i> Lynk.id</span>`;
        } else {
            platformBadge = `<span class="platform-pill pill-linktree"><i data-lucide="share-2" style="width:12px;height:12px"></i> Linktree</span>`;
        }

        // Status Badge
        let statusBadgeHtml = '';
        if (item.status === 'KOL INSTAGRAM') {
            statusBadgeHtml = `<span class="status-badge status-kol-ig">✨ KOL INSTAGRAM</span>`;
        } else if (item.status === 'KOL TIKTOK') {
            statusBadgeHtml = `<span class="status-badge status-kol-tt">🎵 KOL TIKTOK</span>`;
        } else if (item.status === 'VERIFIED IG') {
            statusBadgeHtml = `<span class="status-badge status-success">✓ VERIFIED IG</span>`;
        } else {
            statusBadgeHtml = `<span class="status-badge status-no_ig">BELUM ADA IG</span>`;
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
        } else if (platform === 'tiktok.com') {
            creatorCellHtml = `
                <div class="user-cell">
                    <a href="${item.profileUrl}" target="_blank" rel="noopener noreferrer" class="user-handle">@${item.username}</a>
                    <span class="user-country">🎵 Akun TikTok</span>
                </div>
            `;
        } else {
            let igSubHtml = '';
            if (item.igHandle && isValidInstagramHandle(item.igHandle)) {
                igSubHtml = `
                    <a href="https://www.instagram.com/${item.igHandle}/" target="_blank" rel="noopener noreferrer" class="user-ig-sub" title="Akun Instagram Terverifikasi: @${item.igHandle}">
                        ↳ <i data-lucide="instagram" style="width:11px;height:11px"></i> IG: <strong>@${item.igHandle}</strong>
                    </a>
                `;
            } else {
                const platformName = platform === 'lynk.id' ? 'Lynk.id' : 'Linktree';
                igSubHtml = `<span class="user-country" style="color: #94a3b8;">⚠️ Belum Terhubung ke IG</span>`;
            }

            creatorCellHtml = `
                <div class="user-cell">
                    <a href="${item.profileUrl}" target="_blank" rel="noopener noreferrer" class="user-handle" title="Buka profil ${platform}">@${item.username}</a>
                    ${igSubHtml}
                </div>
            `;
        }

        // Action Button: HANYA berikan link "Visit IG" JIKA akun Instagram valid terverifikasi!
        // Kolom TikTok: link langsung jika akun ditemukan, jika tidak tombol cari di Google
        let tiktokCellHtml = '';
        if (item.tiktokHandle) {
            tiktokCellHtml = `
                <a href="https://www.tiktok.com/@${item.tiktokHandle}" target="_blank" rel="noopener noreferrer" class="btn-visit btn-tt" title="Kunjungi @${item.tiktokHandle} di TikTok">
                    <i data-lucide="music-2"></i> <span class="btn-label">@${item.tiktokHandle}</span>
                </a>
            `;
        } else {
            const ttSearchUrl = `https://www.google.com/search?q=${encodeURIComponent('site:tiktok.com "@' + item.username + '"')}`;
            tiktokCellHtml = `
                <a href="${ttSearchUrl}" target="_blank" rel="noopener noreferrer" class="btn-visit btn-no-ig" title="Akun TikTok belum ditemukan otomatis. Klik untuk cari di Google.">
                    <i data-lucide="search"></i> Cari TikTok
                </a>
            `;
        }

        let actionBtn = '';
        if (item.igHandle && isValidInstagramHandle(item.igHandle)) {
            actionBtn = `
                <a href="https://www.instagram.com/${item.igHandle}/" target="_blank" rel="noopener noreferrer" class="btn-visit btn-ig" title="Kunjungi @${item.igHandle} di Instagram">
                    <i data-lucide="instagram"></i> Visit IG (@${item.igHandle})
                </a>
            `;
        } else {
            // JIKA TIDAK ADA IG: Jangan arahkan ke link mati instagram.com/<username>!
            // Berikan tombol Cari di Google untuk akun tersebut agar tidak pernah kena 404
            const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent('site:instagram.com "' + item.username + '"')}`;
            actionBtn = `
                <a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer" class="btn-visit btn-no-ig" title="Akun IG belum terverifikasi otomatis. Klik untuk cari di Google.">
                    <i data-lucide="search"></i> Cari Akun IG
                </a>
            `;
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
            <td data-label="TikTok">${tiktokCellHtml}</td>
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
        let csvContent = 'Username Profil,Akun Instagram,Akun TikTok,Platform,Negara,Profile URL,Instagram URL,TikTok URL,Bio / Info,Status,Tanggal Scraped\n';
        currentResults.forEach(r => {
            const igHandle = r.igHandle || '-';
            const igUrl = r.igHandle ? `https://www.instagram.com/${r.igHandle}/` : '-';
            const ttHandle = r.tiktokHandle || '-';
            const ttUrl = r.tiktokHandle ? `https://www.tiktok.com/@${r.tiktokHandle}` : '-';
            const cleanBio = (r.description || r.title || '').replace(/"/g, '""').replace(/\n/g, ' ');
            csvContent += `"${r.username}","${igHandle}","${ttHandle}","${r.platform}","${r.country}","${r.profileUrl}","${igUrl}","${ttUrl}","${cleanBio}","${r.status}","${r.dateScraped}"\n`;
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
