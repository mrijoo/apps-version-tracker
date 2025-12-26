const SOFTWARE_LOGOS = {
    'php': 'https://cdn.simpleicons.org/php/777BB4',
    'node-js': 'https://cdn.simpleicons.org/nodedotjs/339933',
    'go': 'https://cdn.simpleicons.org/go/00ADD8',
    'python': 'https://cdn.simpleicons.org/python/3776AB',
    'ruby': 'https://cdn.simpleicons.org/ruby/CC342D',
    'rust': 'https://cdn.simpleicons.org/rust/DEA584',
    'java': 'https://cdn.simpleicons.org/openjdk/ED8B00',
    'java-eclipse-temurin': 'https://cdn.simpleicons.org/openjdk/ED8B00',
    'postgresql': 'https://cdn.simpleicons.org/postgresql/4169E1',
    'mysql': 'https://cdn.simpleicons.org/mysql/4479A1',
    'mariadb': 'https://cdn.simpleicons.org/mariadb/C0765A',
    'mongodb': 'https://cdn.simpleicons.org/mongodb/47A248',
    'redis': 'https://cdn.simpleicons.org/redis/DC382D',
    'nginx': 'https://cdn.simpleicons.org/nginx/009639',
    'apache': 'https://cdn.simpleicons.org/apache/D22128',
    'apache-http-server': 'https://cdn.simpleicons.org/apache/D22128',
    'docker': 'https://cdn.simpleicons.org/docker/2496ED',
    'git': 'https://cdn.simpleicons.org/git/F05032',
    'composer': 'https://cdn.simpleicons.org/composer/885630',
    'npm': 'https://cdn.simpleicons.org/npm/CB3837',
    'yarn': 'https://cdn.simpleicons.org/yarn/2C8EBB',
    'pnpm': 'https://cdn.simpleicons.org/pnpm/F69220',
    'bun': 'https://cdn.simpleicons.org/bun/F9F1E1',
    'laravel': 'https://cdn.simpleicons.org/laravel/FF2D20',
    'next-js': 'https://cdn.simpleicons.org/nextdotjs/FFFFFF',
    'nuxt': 'https://cdn.simpleicons.org/nuxt/00DC82',
    'vue-js': 'https://cdn.simpleicons.org/vuedotjs/4FC08D',
    'react': 'https://cdn.simpleicons.org/react/61DAFB',
    'svelte': 'https://cdn.simpleicons.org/svelte/FF3E00'
};

function getSoftwareLogo(slug, name) {
    if (SOFTWARE_LOGOS[slug]) return SOFTWARE_LOGOS[slug];
    const lowerName = (name || slug).toLowerCase();
    for (const [key, url] of Object.entries(SOFTWARE_LOGOS)) {
        if (lowerName.includes(key.replace(/-/g, ''))) return url;
    }
    return 'https://cdn.simpleicons.org/github/6e7681';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMessage').textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!');
        return true;
    } catch (err) {
        return false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const api = new AppsVersionAPI();
    let allSoftwareData = [];

    const themeToggle = document.getElementById('themeToggle');
    const darkIcon = themeToggle.querySelector('.theme-icon-dark');
    const lightIcon = themeToggle.querySelector('.theme-icon-light');

    const updateThemeIcons = (theme) => {
        darkIcon.style.display = theme === 'dark' ? 'block' : 'none';
        lightIcon.style.display = theme === 'dark' ? 'none' : 'block';
    };

    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);

    themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcons(next);
    });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');
        });
    });

    document.getElementById('copyUrl').addEventListener('click', async () => {
        const url = document.getElementById('requestUrl').textContent;
        await copyToClipboard(url);
    });

    document.querySelectorAll('.btn-copy').forEach(btn => {
        btn.addEventListener('click', async () => {
            const code = document.getElementById(btn.dataset.target)?.textContent || '';
            await copyToClipboard(code);
        });
    });

    const globalSearch = document.getElementById('globalSearch');
    const searchResults = document.getElementById('searchResults');

    globalSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query.length < 2) { searchResults.classList.remove('active'); return; }
        const filtered = allSoftwareData.filter(sw => sw.name.toLowerCase().includes(query) || sw.category.toLowerCase().includes(query)).slice(0, 8);
        if (filtered.length === 0) { searchResults.classList.remove('active'); return; }
        searchResults.innerHTML = filtered.map(sw => `<div class="search-result-item" data-slug="${sw.slug}"><div><img src="${getSoftwareLogo(sw.slug, sw.name)}" alt="" class="search-result-logo"><span class="name">${sw.name}</span><span class="meta">${sw.category}</span></div><span class="version">${sw.latest_version || 'N/A'}</span></div>`).join('');
        searchResults.classList.add('active');
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('softwareFilter').value = item.dataset.slug;
                updateExplorer();
                document.getElementById('explorer').scrollIntoView({ behavior: 'smooth' });
                searchResults.classList.remove('active');
                globalSearch.value = '';
            });
        });
    });

    document.addEventListener('click', (e) => { if (!e.target.closest('.search-container')) searchResults.classList.remove('active'); });
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); globalSearch.focus(); }
        if (e.key === 'Escape') { searchResults.classList.remove('active'); globalSearch.blur(); }
    });

    document.querySelectorAll('.btn-try').forEach(btn => {
        btn.addEventListener('click', () => {
            const endpoint = btn.dataset.endpoint;
            const parts = endpoint.split('/');
            if (parts[0] === 'software') {
                document.getElementById('softwareFilter').value = parts[1].replace('.json', '');
                document.getElementById('categoryFilter').value = '';
            } else if (parts[0] === 'categories') {
                document.getElementById('categoryFilter').value = parts[1].replace('.json', '');
                document.getElementById('softwareFilter').value = '';
            } else {
                document.getElementById('categoryFilter').value = '';
                document.getElementById('softwareFilter').value = '';
            }
            updateExplorer();
            document.getElementById('explorer').scrollIntoView({ behavior: 'smooth' });
        });
    });

    try {
        const [meta, all] = await Promise.all([api.getMeta(), api.getAll()]);
        allSoftwareData = all.software;
        const totalVersions = all.software.reduce((sum, sw) => sum + (sw.total_versions || 0), 0);
        animateValue('totalSoftware', 0, meta.available_software.length, 500);
        animateValue('totalCategories', 0, meta.available_categories.length, 500);
        animateValue('totalVersions', 0, totalVersions, 800);

        const categoryFilter = document.getElementById('categoryFilter');
        for (const cat of meta.available_categories) {
            const option = document.createElement('option');
            option.value = cat.slug;
            option.textContent = cat.name;
            categoryFilter.appendChild(option);
        }

        const softwareFilter = document.getElementById('softwareFilter');
        for (const sw of meta.available_software) {
            const option = document.createElement('option');
            option.value = sw.slug;
            option.textContent = sw.name;
            softwareFilter.appendChild(option);
        }

        const categoryTabs = document.getElementById('categoryTabs');
        for (const cat of meta.available_categories) {
            const tab = document.createElement('button');
            tab.className = 'category-tab';
            tab.dataset.category = cat.slug;
            tab.textContent = cat.name;
            categoryTabs.appendChild(tab);
        }

        categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderSoftwareGrid(tab.dataset.category);
            });
        });

        renderSoftwareGrid('');
        updateExplorer();
    } catch (error) {
        console.error('Failed to load API data:', error);
        document.getElementById('resultsJson').textContent = JSON.stringify({ error: 'Failed to load API data', message: error.message }, null, 2);
    }

    function animateValue(elementId, start, end, duration) {
        const element = document.getElementById(elementId);
        const range = end - start;
        const increment = range / (duration / 16);
        let current = start;
        const timer = setInterval(() => {
            current += increment;
            if (current >= end) { current = end; clearInterval(timer); }
            element.textContent = Math.floor(current).toLocaleString();
        }, 16);
    }

    function renderSoftwareGrid(categoryFilter = '') {
        const softwareGrid = document.getElementById('softwareGrid');
        let filtered = categoryFilter ? allSoftwareData.filter(sw => sw.category_slug === categoryFilter) : allSoftwareData;
        softwareGrid.innerHTML = filtered.map(sw => `<div class="software-card" data-slug="${sw.slug}"><div class="software-info"><img src="${getSoftwareLogo(sw.slug, sw.name)}" alt="${sw.name}" class="software-logo"><div><h3>${sw.name}</h3><span class="software-meta">${sw.category} • ${sw.total_versions} versions</span></div></div><span class="software-version">${sw.latest_version || 'N/A'}</span></div>`).join('');
        softwareGrid.querySelectorAll('.software-card').forEach(card => {
            card.addEventListener('click', () => {
                document.getElementById('softwareFilter').value = card.dataset.slug;
                updateExplorer();
                document.getElementById('explorer').scrollIntoView({ behavior: 'smooth' });
            });
        });
    }

    async function updateExplorer() {
        const category = document.getElementById('categoryFilter').value;
        const software = document.getElementById('softwareFilter').value;

        let endpoint = 'all.json';
        let displayData;

        try {
            if (software) {
                endpoint = `software/${software}.json`;
                const data = await api.getSoftware(software);
                displayData = { name: data.name, category: data.category, website: data.website, latest: data.latest, total_versions: data.total_versions, versions: data.versions };
            } else if (category) {
                endpoint = `categories/${category}.json`;
                const data = await api.getCategory(category);
                displayData = { category: data.name, total_software: data.software.length, software: data.software };
            } else {
                const data = await api.getAll();
                displayData = { last_updated: data.last_updated, total_software: data.total_software, software: data.software };
            }

            const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
            document.getElementById('requestUrl').textContent = `${baseUrl}/api/v1/${endpoint}`;

            const resultsCount = displayData.versions?.length || displayData.software?.length || 0;
            document.getElementById('resultsCount').textContent = `${resultsCount} results`;
            document.getElementById('resultsJson').textContent = JSON.stringify(displayData, null, 2);
        } catch (error) {
            document.getElementById('resultsJson').textContent = JSON.stringify({ error: error.message }, null, 2);
        }
    }

    ['categoryFilter', 'softwareFilter'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateExplorer);
    });

    document.getElementById('refreshBtn').addEventListener('click', updateExplorer);
    window.updateExplorer = updateExplorer;
});
