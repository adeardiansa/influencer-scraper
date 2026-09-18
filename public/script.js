document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('search-form');
    const input = document.getElementById('keyword-input');
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
    let eventSource = null;
    let currentResults = [];

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const keyword = input.value.trim();
        if (!keyword) return;

        startScraping(keyword);
    });

    function startScraping(keyword) {
        // Reset UI
        resultsBody.innerHTML = '';
        totalFound = 0;
        currentResults = [];
        countSuccess.textContent = '0 Found';
        btnExportCsv.classList.add('hide');
        btnExportJson.classList.add('hide');
        
        searchBtn.disabled = true;
        btnText.classList.add('hide');
        spinner.classList.remove('hide');
        
        statusContainer.classList.remove('hide');
        resultsSection.classList.remove('hide');
        progressBar.classList.add('pulsing');
        
        statusText.innerHTML = 'Connecting to local server...';

        // Close previous connection if exists
        if (eventSource) eventSource.close();

        // Start SSE Connection
        eventSource = new EventSource(`/api/scrape?keyword=${encodeURIComponent(keyword)}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'info' || data.type === 'progress') {
                statusText.innerHTML = data.message;
            } 
            else if (data.type === 'skip') {
                statusText.innerHTML = data.message;
            }
            else if (data.type === 'result') {
                statusText.innerHTML = data.message;
                // Simpan ke array
                currentResults.push(data.data);
                
                // HANYA TAMPILKAN DI TABEL JIKA STATUS SUCCESS (ADA IG)
                if (data.data.status === 'SUCCESS') {
                    addResultRow(data.data);
                    totalFound++;
                    countSuccess.textContent = `${totalFound} Found`;
                }
            }
            else if (data.type === 'done') {
                statusText.innerHTML = `<span style="color: var(--success)">${data.message}</span>`;
                // Jika data sudah ada, tampilkan tombol download
                if (currentResults.length > 0) {
                    btnExportCsv.classList.remove('hide');
                    btnExportJson.classList.remove('hide');
                }
                finishScraping();
            }
            else if (data.type === 'error') {
                statusText.innerHTML = `<span style="color: var(--danger)">${data.message}</span>`;
                finishScraping();
            }
        };

        eventSource.onerror = () => {
            statusText.innerHTML = `<span style="color: var(--danger)">Connection to server lost.</span>`;
            finishScraping();
        };
    }

    function finishScraping() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
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
