const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

// Fungsi untuk delay random
const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));

// Fungsi membersihkan URL IG
const cleanIgUrl = (rawUrl) => {
    try {
        const urlObj = new URL(rawUrl);
        return urlObj.origin + urlObj.pathname;
    } catch (e) {
        return rawUrl;
    }
};

// Fungsi menyimpan data ke CSV agar gampang dibuka di Excel
const saveToCSV = (results, filename = 'final_results.csv') => {
    let csvContent = 'Username,Status,Instagram Links,Date Scraped\n';
    results.forEach(r => {
        // Gabungkan array link menjadi satu string dipisahkan " | ", escape kutip
        const linksStr = r.igLinks && r.igLinks.length > 0 ? r.igLinks.join(' | ') : '';
        csvContent += `"${r.username}","${r.status}","${linksStr}","${r.dateScraped}"\n`;
    });
    fs.writeFileSync(filename, csvContent);
};

async function runEndToEndScraper(keyword = "") {
    const browser = await chromium.launch({ headless: true });
    
    // ==========================================
    // TAHAP 1: CARI USERNAME (AUTO DISCOVERY Paging)
    // ==========================================
    const searchPage = await browser.newPage();
    console.log(`\n========================================================`);
    console.log(`🔍 [TAHAP 1] MENCARI AKUN LYNK.ID (Keyword: ${keyword || 'Acak'})`);
    console.log(`========================================================\n`);
    
    let usernames = [];
    
    // Kita scrape 3 halaman pertama Yahoo (bisa ditambah jadi 5 atau 10 sesuai kebutuhan)
    const totalPages = 3; 

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        // Parameter halaman Yahoo: b = 1 (Hal 1), b = 11 (Hal 2), b = 21 (Hal 3)...
        const bParam = (pageNum - 1) * 10 + 1;
        const searchQuery = encodeURIComponent(`site:lynk.id ${keyword}`.trim());
        const searchUrl = `https://search.yahoo.com/search?p=${searchQuery}&b=${bParam}`;
        
        console.log(`  -> Mengumpulkan link dari halaman pencarian ke-${pageNum}...`);
        try {
            // Pakai domcontentloaded agar script nggak nunggu iklan/tracker Yahoo kelamaan
            await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err) {
            console.log(`  ⚠️ Halaman agak lambat (Timeout), tapi kita coba paksa ambil data yang udah muncul...`);
        }
        await searchPage.waitForTimeout(3000); 
        
        const htmlContent = await searchPage.content();
        const regex = /lynk\.id\/([a-zA-Z0-9_.-]+)/g;
        
        let match;
        while ((match = regex.exec(htmlContent)) !== null) {
            const username = match[1].toLowerCase().trim();
            const blacklist = ['login', 'register', 'home', 'terms', 'privacy', 'tentang', 'pricing', 'contact', 'affiliate', 'faq', 'explore', 'undefined'];
            if (username && !blacklist.includes(username)) {
                usernames.push(username);
            }
        }
        
        // Jeda kecil biar Yahoo nggak nge-banned
        if (pageNum < totalPages) {
            await searchPage.waitForTimeout(2000);
        }
    }

    usernames = [...new Set(usernames)]; // Hapus duplikat yang mungkin muncul di 2 halaman
    await searchPage.close();

    if (usernames.length === 0) {
        console.log('❌ Tidak menemukan username lynk.id dari hasil pencarian.');
        await browser.close();
        return;
    }

    console.log(`\n✅ Berhasil menemukan total ${usernames.length} username unik untuk diproses:\n` + usernames.map(u => `  - ${u}`).join('\n') + '\n');

    // ==========================================
    // TAHAP 2: SCRAPE INSTAGRAM DARI PROFIL
    // ==========================================
    console.log(`\n========================================================`);
    console.log(`🚀 [TAHAP 2] MULAI EXTRACT INSTAGRAM LINK`);
    console.log(`========================================================\n`);

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const resultsFile = 'final_results.json';
    const csvFile = 'final_results.csv';
    
    let results = [];
    if (fs.existsSync(resultsFile)) {
        try { results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8')); } catch(e){}
    }

    for (let i = 0; i < usernames.length; i++) {
        const username = usernames[i];
        
        // Fitur auto-resume: Cek apakah udah pernah discrape sebelumnya & sukses
        if (results.some(r => r.username === username && r.status === "SUCCESS")) {
            console.log(`⏭️  [${i + 1}/${usernames.length}] Skip ${username} (Sudah ada di hasil sebelumnya)`);
            continue;
        }

        console.log(`[${i + 1}/${usernames.length}] Membuka: https://lynk.id/${username}`);
        const page = await context.newPage();
        const url = `https://lynk.id/${username}`;
        
        let status = "FAILED";
        let igLinksClean = [];

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000); // Kasih waktu Cloudflare render

            const title = await page.title();
            
            if (title.includes('Attention Required') || title.includes('Just a moment')) {
                console.log('  ❌ KEBLOK Cloudflare.');
                status = "BLOCKED";
            } else if (title.includes('Not Found')) {
                console.log('  ⚠️ Akun tidak ditemukan di Lynk.id');
                status = "NOT_FOUND";
            } else {
                const igLinks = await page.$$eval('a[href*="instagram.com"]', (els) => els.map(el => el.href));
                if (igLinks.length > 0) {
                    igLinksClean = [...new Set(igLinks.map(cleanIgUrl))];
                    console.log(`  ✅ IG Ditemukan: ${igLinksClean.join(', ')}`);
                    status = "SUCCESS";
                } else {
                    console.log('  ⚠️ Tidak ada link Instagram di profil ini.');
                    status = "NO_IG_LINK";
                }
            }
        } catch (err) {
            console.error('  ❌ Error:', err.message);
            status = `ERROR: ${err.message}`;
        } finally {
            await page.close();
        }

        // Update hasil
        const existingIndex = results.findIndex(r => r.username === username);
        const dataToSave = { username, status, igLinks: igLinksClean, dateScraped: new Date().toISOString() };
        
        if (existingIndex > -1) results[existingIndex] = dataToSave;
        else results.push(dataToSave);
        
        // Auto-save per iterasi ke dua format (Biar anti gagal)
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        saveToCSV(results, csvFile);

        // Delay Random (5 - 15 detik) meniru perilaku manusia, cuma jalan kalau bukan urutan terakhir
        if (i < usernames.length - 1) {
            const waitTime = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
            console.log(`  ⏳ Jeda ${waitTime / 1000} detik...\n`);
            await delay(waitTime, waitTime);
        }
    }

    await browser.close();
    console.log(`\n🎉 Proses Selesai! Data Instagram tersimpan di:`);
    console.log(`   - 📄 ${resultsFile} (Buat diolah sistem/developer)`);
    console.log(`   - 📊 ${csvFile} (Bisa dibuka langsung di Excel)`);
}

const keywordArg = process.argv.slice(2).join(" ");
runEndToEndScraper(keywordArg);
