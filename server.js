const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const app = express();
const PORT = process.env.PORT || 7860;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper delay
const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
const cleanIgUrl = (rawUrl) => {
    try {
        const urlObj = new URL(rawUrl);
        return urlObj.origin + urlObj.pathname;
    } catch (e) { return rawUrl; }
};

// SSE Endpoint
app.get('/api/scrape', async (req, res) => {
    const keyword = req.query.keyword || 'fashion';
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendMsg = (type, message, data = null) => {
        res.write(`data: ${JSON.stringify({ type, message, data })}\n\n`);
    };

    sendMsg('info', `🚀 Memulai pencarian dengan keyword: "${keyword}"`);

    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Penting untuk Docker agar tidak memory leak
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
        const searchPage = await browser.newPage();
        
        let usersMap = new Map(); // username -> platform
        const totalPages = 3; 
        const platformsToSearch = ['lynk.id', 'linktr.ee'];

        // TAHAP 1: DISCOVERY (Berurutan per platform)
        sendMsg('info', '🔍 TAHAP 1: Mencari akun di internet...');
        
        for (const platform of platformsToSearch) {
            sendMsg('info', `Mencari profil ${platform}...`);
            
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                const bParam = (pageNum - 1) * 10 + 1;
                const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(`site:${platform} ${keyword}`.trim())}&b=${bParam}`;
                
                sendMsg('info', `Mengumpulkan dari ${platform} halaman ${pageNum}...`);
                try {
                    await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (err) {}
                await searchPage.waitForTimeout(3000); 
                
                const htmlContent = await searchPage.content();
                
                // Dinamis regex sesuai platform
                let regex;
                if (platform === 'lynk.id') regex = /lynk\.id\/([a-zA-Z0-9_.-]+)/g;
                if (platform === 'linktr.ee') regex = /linktr\.ee\/([a-zA-Z0-9_.-]+)/g;
                
                let match;
                while ((match = regex.exec(htmlContent)) !== null) {
                    const username = match[1].toLowerCase().trim();
                    const blacklist = ['login', 'register', 'home', 'terms', 'privacy', 'tentang', 'pricing', 'contact', 'affiliate', 'faq', 'explore', 'undefined', 'blog', 'help', 'about'];
                    if (username && !blacklist.includes(username)) {
                        if (!usersMap.has(username)) {
                            usersMap.set(username, platform);
                        }
                    }
                }
                
                if (pageNum < totalPages) await searchPage.waitForTimeout(2000);
            }
        }

        await searchPage.close();

        // Convert map to array of objects [{username, platform}, ...]
        const targetUsers = Array.from(usersMap, ([username, platform]) => ({ username, platform }));

        if (targetUsers.length === 0) {
            sendMsg('error', '❌ Tidak menemukan satupun username dari hasil pencarian.');
            res.end();
            if (browser) await browser.close();
            return;
        }

        sendMsg('info', `✅ Berhasil menemukan total ${targetUsers.length} profil unik.`);
        
        // TAHAP 2: SCRAPING
        sendMsg('info', `🚀 TAHAP 2: Mengekstrak profil satu per satu (menunggu delay random anti-banned)...`);
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        });

        const resultsFile = 'final_results.json';
        const csvFile = 'final_results.csv';
        let results = [];
        if (fs.existsSync(resultsFile)) {
            try { results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8')); } catch(e){}
        }

        for (let i = 0; i < targetUsers.length; i++) {
            const { username, platform } = targetUsers[i];
            const currentIndexInfo = `[${i + 1}/${targetUsers.length}]`;
            
            if (results.some(r => r.username === username && r.platform === platform && r.status === "SUCCESS")) {
                sendMsg('skip', `${currentIndexInfo} Skip ${username} (${platform} sudah tersimpan)`);
                continue;
            }

            sendMsg('progress', `${currentIndexInfo} Membuka profil ${platform}: ${username}...`);
            
            const page = await context.newPage();
            const url = `https://${platform}/${username}`;
            let status = "FAILED";
            let igLinksClean = [];

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(3000);

                const title = await page.title();
                // Ada platform yang mungkin merender error unik
                if (title.includes('Attention Required') || title.includes('Just a moment')) {
                    status = "BLOCKED";
                } else if (title.includes('Not Found') || title.includes('Page Not Found') || title.includes('404')) {
                    status = "NOT_FOUND";
                } else {
                    const igLinks = await page.$$eval('a[href*="instagram.com"]', (els) => els.map(el => el.href));
                    if (igLinks.length > 0) {
                        igLinksClean = [...new Set(igLinks.map(cleanIgUrl))];
                        status = "SUCCESS";
                    } else {
                        status = "NO_IG_LINK";
                    }
                }
            } catch (err) {
                status = `ERROR: ${err.message}`;
            } finally {
                await page.close();
            }

            const existingIndex = results.findIndex(r => r.username === username && r.platform === platform);
            const dataToSave = { username, platform, status, igLinks: igLinksClean, dateScraped: new Date().toISOString() };
            if (existingIndex > -1) results[existingIndex] = dataToSave;
            else results.push(dataToSave);
            
            // Save JSON & CSV
            fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
            let csvContent = 'Username,Platform,Status,Instagram Links,Date Scraped\n';
            results.forEach(r => {
                const linksStr = r.igLinks && r.igLinks.length > 0 ? r.igLinks.join(' | ') : '';
                csvContent += `"${r.username}","${r.platform || 'lynk.id'}","${r.status}","${linksStr}","${r.dateScraped}"\n`;
            });
            fs.writeFileSync(csvFile, csvContent);

            // Send Result to Frontend
            sendMsg('result', `${currentIndexInfo} Selesai scrape ${username}`, dataToSave);

            if (i < targetUsers.length - 1) {
                const waitTime = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
                sendMsg('progress', `⏳ Jeda anti-banned: ${waitTime / 1000} detik...`);
                await delay(waitTime, waitTime);
            }
        }

        sendMsg('done', `🎉 Proses Selesai! Semua data tersimpan.`, {
            total: targetUsers.length,
            results: results.slice(-targetUsers.length)
        });
        res.end();

    } catch (error) {
        sendMsg('error', `Terjadi kesalahan fatal: ${error.message}`);
        res.end();
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
