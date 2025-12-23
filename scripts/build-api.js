const fs = require('fs');
const path = require('path');

const VERSIONS_DIR = path.join(__dirname, '..', 'versions');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const API_DIR = path.join(DOCS_DIR, 'api', 'v1');
const MINIFY_JSON = true;

function writeJSON(filepath, data) {
    const content = MINIFY_JSON ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    fs.writeFileSync(filepath, content);
    return content.length;
}

function isStableVersion(version) {
    if (version.stable !== undefined) return version.stable;
    if (version.prerelease === true) return false;
    const versionStr = (version.version || version.tag || '').toLowerCase();
    const unstablePatterns = [/alpha/i, /beta/i, /\brc\d*\b/i, /\-rc\./i, /preview/i, /dev/i, /snapshot/i, /nightly/i, /canary/i, /\bpre\b/i, /test/i];
    return !unstablePatterns.some(pattern => pattern.test(versionStr));
}

function normalizeVersion(version) {
    const normalized = {
        version: version.version || null,
        tag: version.tag || null,
        published_at: version.published_at || version.date || null,
        prerelease: version.prerelease || false,
        stable: isStableVersion(version),
        release_url: version.release_url || null,
        downloads: { windows: [], linux: [], macos: [], source: [] }
    };
    if (version.downloads) {
        for (const platform of ['windows', 'linux', 'macos', 'source']) {
            if (version.downloads[platform]) {
                if (Array.isArray(version.downloads[platform])) {
                    normalized.downloads[platform] = version.downloads[platform].map(d => ({
                        name: d.name || null, url: d.download_url || d.url || null, size: d.size || null, size_bytes: d.size_bytes || null, type: d.type || null, arch: d.arch || null
                    })).filter(d => d.url);
                } else if (typeof version.downloads[platform] === 'object') {
                    normalized.downloads[platform] = Object.entries(version.downloads[platform]).map(([key, url]) => ({ name: key, url: typeof url === 'string' ? url : null, type: key })).filter(d => d.url);
                } else if (typeof version.downloads[platform] === 'string') {
                    normalized.downloads[platform] = [{ name: platform, url: version.downloads[platform], type: platform }];
                }
            }
        }
        if (version.downloads.other && Array.isArray(version.downloads.other)) {
            normalized.downloads.source.push(...version.downloads.other.map(d => ({ name: d.name || null, url: d.download_url || d.url || null, size: d.size || null, type: d.type || 'other' })).filter(d => d.url));
        }
    }
    if (version.source_download) {
        normalized.downloads.source = [];
        if (version.source_download.tarball) normalized.downloads.source.push({ name: 'Source (tar.gz)', url: version.source_download.tarball, type: 'tarball' });
        if (version.source_download.zipball) normalized.downloads.source.push({ name: 'Source (zip)', url: version.source_download.zipball, type: 'zipball' });
    }
    if (version.official_downloads) {
        for (const [key, url] of Object.entries(version.official_downloads)) {
            const platform = key.includes('windows') ? 'windows' : key.includes('linux') ? 'linux' : key.includes('mac') || key.includes('darwin') ? 'macos' : 'source';
            normalized.downloads[platform].push({ name: key, url: typeof url === 'string' ? url : null, type: key });
        }
    }
    if (version.lts !== undefined) normalized.lts = version.lts;
    if (version.major_version !== undefined) normalized.major_version = version.major_version;
    for (const platform of ['windows', 'linux', 'macos', 'source']) { if (normalized.downloads[platform].length === 0) delete normalized.downloads[platform]; }
    if (Object.keys(normalized.downloads).length === 0) delete normalized.downloads;
    for (const key of Object.keys(normalized)) { if (normalized[key] === null) delete normalized[key]; }
    return normalized;
}

function buildAPI() {
    console.log('🔨 Building API...\n');
    const allVersionsPath = path.join(VERSIONS_DIR, 'all-versions.json');
    if (!fs.existsSync(allVersionsPath)) { console.error('❌ all-versions.json not found'); process.exit(1); }
    const allData = JSON.parse(fs.readFileSync(allVersionsPath, 'utf-8'));
    const dirs = [API_DIR, path.join(API_DIR, 'software'), path.join(API_DIR, 'categories'), path.join(API_DIR, 'latest')];
    for (const dir of dirs) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
    let totalBytes = 0;
    const meta = {
        name: 'Apps Version Tracker API', version: '2.0.0', last_updated: allData.last_updated,
        endpoints: { all: '/api/v1/all.json', latest: '/api/v1/latest/{name}.json', software: '/api/v1/software/{name}.json', categories: '/api/v1/categories/{category}.json', meta: '/api/v1/meta.json' },
        available_software: [], available_categories: []
    };
    const categories = {};
    const softwareList = [];
    const latestList = {};
    const processedCategories = new Set();
    for (const [category, software] of Object.entries(allData.software || {})) {
        const categorySlug = category.toLowerCase().replace(/\s+/g, '-');
        if (!categories[categorySlug]) categories[categorySlug] = { name: category, slug: categorySlug, software: [] };
        if (!processedCategories.has(categorySlug)) {
            meta.available_categories.push({ name: category, slug: categorySlug, endpoint: `/api/v1/categories/${categorySlug}.json` });
            processedCategories.add(categorySlug);
        }
        for (const [name, data] of Object.entries(software)) {
            const softwareSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
            const versions = (data.versions || []).map(normalizeVersion);
            const latest = versions[0] || (data.latest ? normalizeVersion(data.latest) : null);
            const latestStable = versions.find(v => v.stable) || latest;
            softwareList.push({ name, slug: softwareSlug, category, category_slug: categorySlug, latest_version: latest?.version || null, latest_stable: latestStable?.version || null, total_versions: versions.length, endpoint: `/api/v1/software/${softwareSlug}.json` });
            meta.available_software.push({ name, slug: softwareSlug, category, endpoint: `/api/v1/software/${softwareSlug}.json`, latest_endpoint: `/api/v1/latest/${softwareSlug}.json` });
            const latestData = { name, slug: softwareSlug, website: data.website || null, latest, download_page: data.download_page || null };
            if (latestStable !== latest) latestData.latest_stable = latestStable;
            Object.keys(latestData).forEach(k => latestData[k] === null && delete latestData[k]);
            totalBytes += writeJSON(path.join(API_DIR, 'latest', `${softwareSlug}.json`), latestData);
            const softwareData = { name, slug: softwareSlug, category, website: data.website || null, download_page: data.download_page || null, total_versions: versions.length, latest, versions };
            if (latestStable !== latest) softwareData.latest_stable = latestStable;
            Object.keys(softwareData).forEach(k => softwareData[k] === null && delete softwareData[k]);
            totalBytes += writeJSON(path.join(API_DIR, 'software', `${softwareSlug}.json`), softwareData);
            categories[categorySlug].software.push({ name, slug: softwareSlug, latest_version: latest?.version || null, latest_stable: latestStable?.version || null, total_versions: versions.length });
            latestList[softwareSlug] = { v: latest?.version || null, s: latestStable?.version || null };
        }
    }
    for (const [slug, categoryData] of Object.entries(categories)) { totalBytes += writeJSON(path.join(API_DIR, 'categories', `${slug}.json`), categoryData); }
    totalBytes += writeJSON(path.join(API_DIR, 'all.json'), { last_updated: allData.last_updated, total_software: softwareList.length, software: softwareList });
    totalBytes += writeJSON(path.join(API_DIR, 'latest-all.json'), { last_updated: allData.last_updated, software: latestList });
    totalBytes += writeJSON(path.join(API_DIR, 'meta.json'), meta);
    console.log(`✅ API built: ${meta.available_software.length} software, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

buildAPI();
