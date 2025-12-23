class AppsVersionAPI {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl || this.detectBaseUrl();
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000;
    }

    detectBaseUrl() {
        const path = window.location.pathname;
        const basePath = path.substring(0, path.lastIndexOf('/'));
        return `${window.location.origin}${basePath}`;
    }

    async fetchJSON(endpoint) {
        const url = `${this.baseUrl}/api/v1/${endpoint}`;
        const cached = this.cache.get(url);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.cache.set(url, { data, timestamp: Date.now() });
            return data;
        } catch (error) {
            console.error(`Error fetching ${url}:`, error);
            throw error;
        }
    }

    async getMeta() { return this.fetchJSON('meta.json'); }
    async getAll() { return this.fetchJSON('all.json'); }
    async getAllLatest() { return this.fetchJSON('latest-all.json'); }
    async getLatest(slug) { return this.fetchJSON(`latest/${slug}.json`); }
    async getSoftware(slug) { return this.fetchJSON(`software/${slug}.json`); }
    async getCategory(slug) { return this.fetchJSON(`categories/${slug}.json`); }

    async prefetch(slugs = []) {
        return Promise.all(slugs.map(slug => this.getLatest(slug).catch(() => null)));
    }

    filterVersions(versions, filters = {}) {
        let result = [...versions];
        if (filters.version) {
            const pattern = filters.version.toLowerCase();
            result = result.filter(v => v.version?.toLowerCase().includes(pattern) || v.tag?.toLowerCase().includes(pattern));
        }
        if (filters.platform) {
            const platform = filters.platform.toLowerCase();
            result = result.filter(v => v.downloads && v.downloads[platform]?.length > 0);
        }
        if (filters.stable) {
            result = result.filter(v => v.stable === true);
        }
        if (!filters.includePrerelease) {
            result = result.filter(v => !v.prerelease);
        }
        if (filters.latest) {
            result = result.slice(0, 1);
        }
        if (filters.limit && filters.limit > 0) {
            result = result.slice(0, filters.limit);
        }
        return result;
    }

    async search(query, filters = {}) {
        const all = await this.getAll();
        const pattern = query.toLowerCase();
        let results = all.software.filter(s =>
            s.name.toLowerCase().includes(pattern) ||
            s.slug.toLowerCase().includes(pattern) ||
            s.category.toLowerCase().includes(pattern)
        );
        if (filters.category) {
            results = results.filter(s => s.category_slug === filters.category || s.category.toLowerCase() === filters.category.toLowerCase());
        }
        if (filters.limit) {
            results = results.slice(0, filters.limit);
        }
        return results;
    }

    getDownloadLinks(versionData, platform = null) {
        const links = [];
        if (!versionData || !versionData.downloads) return links;
        const platforms = platform ? [platform] : Object.keys(versionData.downloads);
        for (const p of platforms) {
            const downloads = versionData.downloads[p];
            if (Array.isArray(downloads)) {
                for (const d of downloads) {
                    links.push({ platform: p, name: d.name, url: d.url, size: d.size, size_bytes: d.size_bytes });
                }
            }
        }
        return links;
    }

    clearCache() { this.cache.clear(); }
}

window.AppsVersionAPI = AppsVersionAPI;