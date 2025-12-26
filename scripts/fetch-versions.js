const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com';
const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Apps-Version-Tracker' };
if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
const axiosInstance = axios.create({ headers, timeout: 30000 });

const VERSIONS_DIR = path.join(__dirname, '..', 'versions');
const EXISTING_DATA_PATH = path.join(VERSIONS_DIR, 'all-versions.json');
const MAX_NEW_VERSIONS_PER_SCAN = Infinity;

function loadExistingData() {
  try {
    if (fs.existsSync(EXISTING_DATA_PATH)) return JSON.parse(fs.readFileSync(EXISTING_DATA_PATH, 'utf-8'));
  } catch (error) { console.log('No existing data found, starting fresh.'); }
  return null;
}

function mergeVersions(existingVersions = [], newVersions = []) {
  const versionMap = new Map();
  for (const v of existingVersions) versionMap.set(v.version, v);
  for (const v of newVersions) {
    const existing = versionMap.get(v.version);
    if (existing) {
      versionMap.set(v.version, { ...existing, ...v, downloads: v.downloads || existing.downloads });
    } else {
      versionMap.set(v.version, v);
    }
  }
  const merged = Array.from(versionMap.values());
  merged.sort((a, b) => {
    const aParts = (a.version || '0').split('.').map(p => parseInt(p) || 0);
    const bParts = (b.version || '0').split('.').map(p => parseInt(p) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      if ((bParts[i] || 0) !== (aParts[i] || 0)) return (bParts[i] || 0) - (aParts[i] || 0);
    }
    return 0;
  });
  return merged;
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return null;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

async function fetchFileSize(url) {
  try {
    const response = await axios.head(url, { timeout: 5000, maxRedirects: 5 });
    const contentLength = response.headers['content-length'];
    return contentLength ? parseInt(contentLength, 10) : null;
  } catch { return null; }
}

async function fetchFileSizesParallel(downloads, concurrency = 5) {
  const results = [];
  for (let i = 0; i < downloads.length; i += concurrency) {
    const batch = downloads.slice(i, i + concurrency);
    const sizes = await Promise.all(batch.map(d => fetchFileSize(d.download_url || d.url)));
    for (let j = 0; j < batch.length; j++) {
      const size = sizes[j];
      if (size) {
        batch[j].size_bytes = size;
        batch[j].size = formatFileSize(size);
      }
    }
    results.push(...batch);
  }
  return results;
}

async function fetchTagCommitDate(owner, repo, sha) {
  try {
    const response = await axiosInstance.get(`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`);
    return response.data?.commit?.committer?.date || null;
  } catch { return null; }
}

function extractDownloads(assets) {
  if (!assets || assets.length === 0) return [];
  return assets.map(asset => ({
    name: asset.name,
    download_url: asset.browser_download_url,
    size_bytes: asset.size,
    size: formatFileSize(asset.size),
    download_count: asset.download_count
  }));
}

function categorizeDownloads(downloads) {
  const categorized = { windows: [], linux: [], macos: [], other: [] };
  for (const download of downloads) {
    const name = download.name.toLowerCase();
    if (name.includes('win') || name.includes('windows') || name.endsWith('.exe') || name.endsWith('.msi')) categorized.windows.push(download);
    else if (name.includes('linux') || name.includes('ubuntu') || name.includes('debian') || name.endsWith('.deb') || name.endsWith('.rpm') || (name.endsWith('.tar.gz') && !name.includes('darwin'))) categorized.linux.push(download);
    else if (name.includes('darwin') || name.includes('macos') || name.includes('mac') || name.includes('apple') || name.endsWith('.pkg') || name.endsWith('.dmg')) categorized.macos.push(download);
    else categorized.other.push(download);
  }
  for (const key of Object.keys(categorized)) { if (categorized[key].length === 0) delete categorized[key]; }
  return Object.keys(categorized).length > 0 ? categorized : null;
}

async function fetchAllGitHubReleases(owner, repo, options = {}) {
  try {
    const existingVersions = new Set((options.existingVersions || []).map(v => v.version));
    let allReleases = [], page = 1, consecutiveExisting = 0, newVersionsFound = 0;
    const perPage = 100, MAX_CONSECUTIVE_EXISTING = 20;
    console.log(`    📊 Existing versions: ${existingVersions.size}`);
    while (true) {
      const url = `${GITHUB_API}/repos/${owner}/${repo}/releases?per_page=${perPage}&page=${page}`;
      const response = await axiosInstance.get(url);
      if (!response.data || response.data.length === 0) break;
      const releases = options.includePrerelease ? response.data : response.data.filter(r => !r.prerelease);
      for (const release of releases) {
        const version = release.tag_name.replace(/^v/, '');
        if (existingVersions.has(version)) {
          consecutiveExisting++;
          if (consecutiveExisting >= MAX_CONSECUTIVE_EXISTING) { console.log(`    ⏭️  Stopping: ${MAX_CONSECUTIVE_EXISTING} consecutive existing versions found`); break; }
          continue;
        }
        consecutiveExisting = 0;
        newVersionsFound++;
        const allDownloads = extractDownloads(release.assets);
        allReleases.push({
          version, tag: release.tag_name, published_at: release.published_at, prerelease: release.prerelease,
          release_url: release.html_url, downloads: categorizeDownloads(allDownloads),
          total_downloads: allDownloads.reduce((sum, d) => sum + (d.download_count || 0), 0)
        });
      }
      if (consecutiveExisting >= MAX_CONSECUTIVE_EXISTING) break;
      if (response.data.length < perPage) break;
      page++;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.log(`    ✨ New versions found: ${newVersionsFound}`);
    return { latest: allReleases[0] || null, versions: allReleases, total_versions: allReleases.length, new_versions_count: newVersionsFound };
  } catch (error) { console.error(`Error fetching ${owner}/${repo}:`, error.message); return null; }
}

async function fetchAllGitHubTags(owner, repo, options = {}) {
  try {
    const existingVersions = new Set((options.existingVersions || []).map(v => v.version));
    let allTags = [], page = 1, consecutiveExisting = 0, newVersionsFound = 0;
    const perPage = 100, MAX_CONSECUTIVE_EXISTING = 20;
    const fetchDates = options.fetchDates !== false;
    console.log(`    📊 Existing versions: ${existingVersions.size}`);
    while (true) {
      const url = `${GITHUB_API}/repos/${owner}/${repo}/tags?per_page=${perPage}&page=${page}`;
      const response = await axiosInstance.get(url);
      if (!response.data || response.data.length === 0) break;
      for (const tag of response.data) {
        if (options.versionFilter && !options.versionFilter(tag.name)) continue;
        let version = tag.name.replace(/^v/, '');
        if (options.versionTransform) version = options.versionTransform(version);
        if (existingVersions.has(version)) {
          consecutiveExisting++;
          if (consecutiveExisting >= MAX_CONSECUTIVE_EXISTING) { console.log(`    ⏭️  Stopping: ${MAX_CONSECUTIVE_EXISTING} consecutive existing versions found`); break; }
          continue;
        }
        consecutiveExisting = 0;
        newVersionsFound++;
        let published_at = null;
        if (fetchDates && tag.commit?.sha) {
          published_at = await fetchTagCommitDate(owner, repo, tag.commit.sha);
        }
        allTags.push({
          version, tag: tag.name, published_at,
          release_url: `https://github.com/${owner}/${repo}/releases/tag/${tag.name}`,
          source_download: { tarball: `https://github.com/${owner}/${repo}/archive/refs/tags/${tag.name}.tar.gz`, zipball: `https://github.com/${owner}/${repo}/archive/refs/tags/${tag.name}.zip` }
        });
      }
      if (consecutiveExisting >= MAX_CONSECUTIVE_EXISTING) break;
      if (response.data.length < perPage) break;
      page++;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.log(`    ✨ New versions found: ${newVersionsFound}`);
    return { latest: allTags[0] || null, versions: allTags, total_versions: allTags.length, new_versions_count: newVersionsFound };
  } catch (error) { console.error(`Error fetching tags for ${owner}/${repo}:`, error.message); return null; }
}

const SOFTWARE_LIST = [
  {
    name: 'PHP', category: 'Languages', website: 'https://www.php.net',
    fetch: async (existingVersions = []) => {
      const getVsVersion = (version) => { const [major, minor] = version.split('.').map(Number); if (major >= 8 && minor >= 4) return 'vs17'; if (major >= 8) return 'vs16'; if (major === 7 && minor === 4) return 'vc15'; return 'vs16'; };
      const result = await fetchAllGitHubTags('php', 'php-src', { versionFilter: (tag) => /^php-\d+\.\d+\.\d+$/.test(tag), versionTransform: (v) => v.replace('php-', ''), existingVersions });
      if (result && result.versions.length > 0) {
        const allDownloads = [];
        for (const v of result.versions) {
          const version = v.version, vs = getVsVersion(version);
          v.downloads = {
            windows: [
              { name: `php-${version}-Win32-${vs}-x64.zip`, download_url: `https://windows.php.net/downloads/releases/php-${version}-Win32-${vs}-x64.zip`, type: 'Thread Safe (TS)', arch: 'x64' },
              { name: `php-${version}-nts-Win32-${vs}-x64.zip`, download_url: `https://windows.php.net/downloads/releases/php-${version}-nts-Win32-${vs}-x64.zip`, type: 'Non-Thread Safe (NTS)', arch: 'x64' }
            ],
            source: [{ name: `php-${version}.tar.gz`, download_url: `https://www.php.net/distributions/php-${version}.tar.gz`, type: 'source' }]
          };
          allDownloads.push(...v.downloads.windows, ...v.downloads.source);
        }
        console.log(`📦 Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  {
    name: 'Node.js', category: 'Languages', website: 'https://nodejs.org',
    fetch: async (existingVersions = []) => {
      try {
        const response = await axiosInstance.get('https://nodejs.org/dist/index.json');
        const versions = response.data.slice(0, MAX_NEW_VERSIONS_PER_SCAN).map(v => {
          const ver = v.version;
          return {
            version: ver.replace(/^v/, ''),
            tag: ver,
            lts: v.lts || false,
            published_at: v.date,
            downloads: {
              windows: [
                { name: `node-${ver}-win-x64.zip`, download_url: `https://nodejs.org/dist/${ver}/node-${ver}-win-x64.zip`, type: 'binaries', arch: 'x64' },
                { name: `node-${ver}-x64.msi`, download_url: `https://nodejs.org/dist/${ver}/node-${ver}-x64.msi`, type: 'installer', arch: 'x64' }
              ],
              linux: [
                { name: `node-${ver}-linux-x64.tar.xz`, download_url: `https://nodejs.org/dist/${ver}/node-${ver}-linux-x64.tar.xz`, type: 'binaries', arch: 'x64' },
                { name: `node-${ver}-linux-arm64.tar.xz`, download_url: `https://nodejs.org/dist/${ver}/node-${ver}-linux-arm64.tar.xz`, type: 'binaries', arch: 'arm64' }
              ],
              macos: [
                { name: `node-${ver}-darwin-arm64.tar.gz`, download_url: `https://nodejs.org/dist/${ver}/node-${ver}-darwin-arm64.tar.gz`, type: 'binaries', arch: 'arm64' },
                { name: `node-${ver}.pkg`, download_url: `https://nodejs.org/dist/${ver}/node-${ver}.pkg`, type: 'installer' }
              ],
              source: [{ name: `node-${ver}.tar.gz`, download_url: `https://nodejs.org/dist/${ver}/node-${ver}.tar.gz`, type: 'source' }]
            }
          };
        });
        return { latest_lts: versions.find(v => v.lts), latest_current: versions[0], versions, total_versions: versions.length };
      } catch (error) { console.error('Error fetching Node.js:', error.message); return null; }
    }
  },
  {
    name: 'Go', category: 'Languages', website: 'https://go.dev',
    fetch: async (existingVersions = []) => {
      try {
        const response = await axiosInstance.get('https://go.dev/dl/?mode=json&include=all');
        const versions = response.data.slice(0, MAX_NEW_VERSIONS_PER_SCAN).map(release => {
          const downloads = { windows: [], linux: [], macos: [], source: [] };
          for (const file of release.files) {
            const download = { name: file.filename, download_url: `https://go.dev/dl/${file.filename}`, size_bytes: file.size, size: formatFileSize(file.size), sha256: file.sha256, arch: file.arch };
            if (file.os === 'windows') downloads.windows.push(download);
            else if (file.os === 'linux') downloads.linux.push(download);
            else if (file.os === 'darwin') downloads.macos.push(download);
            else if (file.kind === 'source') downloads.source.push(download);
          }
          return { version: release.version.replace('go', ''), tag: release.version, stable: release.stable, downloads };
        });
        return { latest: versions.find(v => v.stable) || versions[0], versions, total_versions: versions.length };
      } catch (error) { console.error('Error fetching Go:', error.message); return null; }
    }
  },
  {
    name: 'Python', category: 'Languages', website: 'https://www.python.org',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubTags('python', 'cpython', { versionFilter: (tag) => /^v?\d+\.\d+\.\d+$/.test(tag), existingVersions });
      if (result && result.versions.length > 0) {
        const allDownloads = [];
        for (const v of result.versions) {
          v.downloads = {
            windows: [{ name: `python-${v.version}-amd64.exe`, download_url: `https://www.python.org/ftp/python/${v.version}/python-${v.version}-amd64.exe`, type: 'installer', arch: 'x64' }],
            macos: [{ name: `python-${v.version}-macos11.pkg`, download_url: `https://www.python.org/ftp/python/${v.version}/python-${v.version}-macos11.pkg`, type: 'installer' }],
            source: [{ name: `Python-${v.version}.tar.xz`, download_url: `https://www.python.org/ftp/python/${v.version}/Python-${v.version}.tar.xz`, type: 'source' }]
          };
          allDownloads.push(...v.downloads.windows, ...v.downloads.source);
        }
        console.log(`📦 Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  {
    name: 'Ruby', category: 'Languages', website: 'https://www.ruby-lang.org',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubTags('ruby', 'ruby', { versionFilter: (tag) => /^v\d+_\d+_\d+$/.test(tag), versionTransform: (v) => v.replace(/_/g, '.'), existingVersions });
      if (result && result.versions.length > 0) {
        const allDownloads = [];
        for (const v of result.versions) {
          const majorMinor = v.version.split('.').slice(0, 2).join('.');
          v.downloads = {
            windows: [{ name: `rubyinstaller-${v.version}-x64.exe`, download_url: `https://github.com/oneclick/rubyinstaller2/releases/download/RubyInstaller-${v.version}-1/rubyinstaller-${v.version}-1-x64.exe`, type: 'installer', arch: 'x64' }],
            source: [{ name: `ruby-${v.version}.tar.gz`, download_url: `https://cache.ruby-lang.org/pub/ruby/${majorMinor}/ruby-${v.version}.tar.gz`, type: 'source' }]
          };
          allDownloads.push(...v.downloads.source);
        }
        console.log(`📦 Ruby: Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  {
    name: 'Rust', category: 'Languages', website: 'https://www.rust-lang.org',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubReleases('rust-lang', 'rust', { existingVersions });
      if (result && result.versions.length > 0) {
        const allDownloads = [];
        for (const v of result.versions) {
          v.downloads = {
            windows: [{ name: `rust-${v.version}-x86_64-pc-windows-msvc.msi`, download_url: `https://static.rust-lang.org/dist/rust-${v.version}-x86_64-pc-windows-msvc.msi`, type: 'installer', arch: 'x64' }],
            linux: [{ name: `rust-${v.version}-x86_64-unknown-linux-gnu.tar.gz`, download_url: `https://static.rust-lang.org/dist/rust-${v.version}-x86_64-unknown-linux-gnu.tar.gz`, type: 'binaries', arch: 'x64' }],
            macos: [{ name: `rust-${v.version}-x86_64-apple-darwin.tar.gz`, download_url: `https://static.rust-lang.org/dist/rust-${v.version}-x86_64-apple-darwin.tar.gz`, type: 'binaries', arch: 'x64' }]
          };
          v.install_command = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh";
          allDownloads.push(...v.downloads.windows, ...v.downloads.linux);
        }
        console.log(`📦 Rust: Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  {
    name: 'Java (Eclipse Temurin)', category: 'Languages', website: 'https://adoptium.net',
    fetch: async (existingVersions = []) => {
      try {
        console.log('    🔍 Discovering available Java major versions...');
        let majorVersions = [], page = 1;
        while (true) {
          const reposResponse = await axiosInstance.get(`${GITHUB_API}/orgs/adoptium/repos?per_page=100&page=${page}`);
          if (!reposResponse.data || reposResponse.data.length === 0) break;
          for (const repo of reposResponse.data) { const match = repo.name.match(/^temurin(\d+)-binaries$/); if (match) majorVersions.push(parseInt(match[1], 10)); }
          if (reposResponse.data.length < 100) break;
          page++;
        }
        majorVersions.sort((a, b) => b - a);
        console.log(`    📦 Found Java versions: ${majorVersions.join(', ')}`);
        const allVersions = [];
        for (const major of majorVersions) {
          const result = await fetchAllGitHubReleases('adoptium', `temurin${major}-binaries`, { existingVersions });
          if (result && result.versions) allVersions.push(...result.versions.map(v => ({ ...v, major_version: major })));
        }
        const LTS_VERSIONS = [8, 11, 17, 21, 25, 29, 33];
        const parseJavaVersion = (v) => {
          const tag = v.tag || v.version;
          let match = tag.match(/jdk-?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\+(\d+))?/);
          if (match) return { major: parseInt(match[1]) || 0, minor: parseInt(match[2]) || 0, patch: parseInt(match[3]) || 0, build: parseInt(match[4]) || 0 };
          match = tag.match(/jdk(\d+)u(\d+)-b(\d+)/);
          if (match) return { major: parseInt(match[1]) || 0, minor: parseInt(match[2]) || 0, patch: 0, build: parseInt(match[3]) || 0 };
          return { major: v.major_version || 0, minor: 0, patch: 0, build: 0 };
        };
        const enrichedVersions = allVersions.map(v => { const parsed = parseJavaVersion(v); return { ...v, lts: LTS_VERSIONS.includes(parsed.major), stable: !v.prerelease, release_date: v.published_at || null }; });
        enrichedVersions.sort((a, b) => { const vA = parseJavaVersion(a), vB = parseJavaVersion(b); if (vB.major !== vA.major) return vB.major - vA.major; if (vB.minor !== vA.minor) return vB.minor - vA.minor; if (vB.patch !== vA.patch) return vB.patch - vA.patch; return vB.build - vA.build; });
        return { latest: enrichedVersions[0], latest_stable: enrichedVersions.find(v => v.stable) || enrichedVersions[0], latest_lts: enrichedVersions.find(v => v.lts && v.stable), versions: enrichedVersions.slice(0, MAX_NEW_VERSIONS_PER_SCAN), total_versions: enrichedVersions.length, download_page: 'https://adoptium.net/temurin/releases/' };
      } catch (error) { console.error('Error fetching Java Temurin:', error.message); return null; }
    }
  },
  {
    name: 'PostgreSQL', category: 'Databases', website: 'https://www.postgresql.org',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubTags('postgres', 'postgres', { versionFilter: (tag) => /^REL_\d+_\d+$/.test(tag), versionTransform: (v) => v.replace('REL_', '').replace(/_/g, '.'), existingVersions });
      if (result && result.versions.length > 0) {
        result.download_page = 'https://www.postgresql.org/download/';
        const allDownloads = [];
        for (const v of result.versions) {
          allDownloads.push(
            { version: v.version, platform: 'windows', name: `postgresql-${v.version}-1-windows-x64.exe`, download_url: `https://get.enterprisedb.com/postgresql/postgresql-${v.version}-1-windows-x64.exe`, type: 'installer', arch: 'x64' },
            { version: v.version, platform: 'windows_zip', name: `postgresql-${v.version}-1-windows-x64-binaries.zip`, download_url: `https://get.enterprisedb.com/postgresql/postgresql-${v.version}-1-windows-x64-binaries.zip`, type: 'binaries', arch: 'x64' },
            { version: v.version, platform: 'source', name: `postgresql-${v.version}.tar.gz`, download_url: `https://ftp.postgresql.org/pub/source/v${v.version}/postgresql-${v.version}.tar.gz`, type: 'source' }
          );
        }
        console.log(`📦 PostgreSQL: Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
        for (const v of result.versions) {
          const winExe = allDownloads.find(d => d.version === v.version && d.platform === 'windows');
          const winZip = allDownloads.find(d => d.version === v.version && d.platform === 'windows_zip');
          const srcDl = allDownloads.find(d => d.version === v.version && d.platform === 'source');
          v.downloads = { windows: [winExe, winZip].filter(d => d), source: [srcDl].filter(d => d) };
        }
      }
      return result;
    }
  },
  {
    name: 'MySQL', category: 'Databases', website: 'https://www.mysql.com',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubTags('mysql', 'mysql-server', { versionFilter: (tag) => /^mysql-\d+\.\d+\.\d+$/.test(tag), versionTransform: (v) => v.replace('mysql-', ''), existingVersions });
      if (result && result.versions.length > 0) {
        result.download_page = 'https://dev.mysql.com/downloads/mysql/';
        const allDownloads = [];
        for (const v of result.versions) {
          v.downloads = {
            windows: [{ name: `mysql-${v.version}-winx64.zip`, download_url: `https://cdn.mysql.com/Downloads/MySQL-${v.version.split('.').slice(0, 2).join('.')}/mysql-${v.version}-winx64.zip`, type: 'binaries' }],
            source: [{ name: `mysql-${v.version}.tar.gz`, download_url: `https://cdn.mysql.com/Downloads/MySQL-${v.version.split('.').slice(0, 2).join('.')}/mysql-${v.version}.tar.gz`, type: 'source' }]
          };
          allDownloads.push(...v.downloads.windows, ...v.downloads.source);
        }
        console.log(`📦 MySQL: Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  {
    name: 'MariaDB', category: 'Databases', website: 'https://mariadb.org',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubTags('MariaDB', 'server', { versionFilter: (tag) => /^mariadb-\d+\.\d+\.\d+$/.test(tag), versionTransform: (v) => v.replace('mariadb-', ''), existingVersions });
      if (result && result.versions.length > 0) {
        result.download_page = 'https://mariadb.org/download/';
        const allDownloads = [];
        for (const v of result.versions) {
          v.downloads = {
            windows: [{ name: `mariadb-${v.version}-winx64.zip`, download_url: `https://downloads.mariadb.org/rest-api/mariadb/${v.version}/mariadb-${v.version}-winx64.zip`, type: 'binaries' }],
            source: [{ name: `mariadb-${v.version}.tar.gz`, download_url: `https://downloads.mariadb.org/rest-api/mariadb/${v.version}/mariadb-${v.version}.tar.gz`, type: 'source' }]
          };
          allDownloads.push(...v.downloads.source);
        }
        console.log(`📦 MariaDB: Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  {
    name: 'MongoDB', category: 'Databases', website: 'https://www.mongodb.com',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubTags('mongodb', 'mongo', { versionFilter: (tag) => /^r\d+\.\d+\.\d+$/.test(tag), versionTransform: (v) => v.replace('r', ''), existingVersions });
      if (result && result.versions.length > 0) {
        result.download_page = 'https://www.mongodb.com/try/download/community';
        for (const v of result.versions) {
          v.downloads = {
            windows: [{ name: `mongodb-windows-x86_64-${v.version}.zip`, download_url: `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${v.version}.zip`, type: 'binaries' }],
            linux: [{ name: `mongodb-linux-x86_64-ubuntu2204-${v.version}.tgz`, download_url: `https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-${v.version}.tgz`, type: 'binaries' }],
            macos: [{ name: `mongodb-macos-arm64-${v.version}.tgz`, download_url: `https://fastdl.mongodb.org/osx/mongodb-macos-arm64-${v.version}.tgz`, type: 'binaries' }]
          };
        }
      }
      return result;
    }
  },
  {
    name: 'Redis', category: 'Databases', website: 'https://redis.io',
    fetch: async (existingVersions = []) => {
      const [officialResult, windowsResult] = await Promise.all([fetchAllGitHubReleases('redis', 'redis', { existingVersions }), fetchAllGitHubReleases('redis-windows', 'redis-windows', { existingVersions })]);
      if (!officialResult) return null;
      const windowsVersionMap = new Map();
      if (windowsResult && windowsResult.versions) { for (const wv of windowsResult.versions) { const versionMatch = wv.version.match(/(\d+\.\d+\.\d+)/); if (versionMatch) windowsVersionMap.set(versionMatch[1], wv); } }
      officialResult.versions = officialResult.versions.map(v => { const windowsBuild = windowsVersionMap.get(v.version); const downloads = v.downloads || {}; if (windowsBuild && windowsBuild.downloads) downloads.windows = windowsBuild.downloads.windows || windowsBuild.downloads.other || []; return { ...v, downloads }; });
      officialResult.download_page = 'https://redis.io/download/';
      officialResult.windows_builds_source = 'https://github.com/redis-windows/redis-windows';
      return officialResult;
    }
  },
  {
    name: 'Nginx', category: 'Web Servers', website: 'https://nginx.org',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubTags('nginx', 'nginx', { versionFilter: (tag) => tag.startsWith('release-'), versionTransform: (v) => v.replace('release-', ''), existingVersions });
      if (result && result.versions.length > 0) {
        result.download_page = 'https://nginx.org/en/download.html';
        const allDownloads = [];
        for (const v of result.versions) {
          v.downloads = {
            windows: [{ name: `nginx-${v.version}.zip`, download_url: `https://nginx.org/download/nginx-${v.version}.zip`, type: 'binaries' }],
            source: [{ name: `nginx-${v.version}.tar.gz`, download_url: `https://nginx.org/download/nginx-${v.version}.tar.gz`, type: 'source' }]
          };
          allDownloads.push(...v.downloads.windows, ...v.downloads.source);
        }
        console.log(`📦 Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  {
    name: 'Apache HTTP Server', category: 'Web Servers', website: 'https://httpd.apache.org',
    fetch: async (existingVersions = []) => {
      try {
        const loungeResponse = await axiosInstance.get('https://www.apachelounge.com/download/');
        const html = loungeResponse.data;
        const windowsBinaries = new Map();
        const regex = /href="(\/download\/[^"]+\/binaries\/(httpd-(\d+\.\d+\.\d+)[^"]*-win64[^"]*\.zip))"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
          const [, path, filename, version] = match;
          if (!windowsBinaries.has(version)) {
            windowsBinaries.set(version, { name: filename, download_url: `https://www.apachelounge.com${path}`, type: 'binaries', arch: 'x64' });
          }
        }
        console.log(`🔍 Found ${windowsBinaries.size} Apache Windows binaries from ApacheLounge`);

        const result = await fetchAllGitHubTags('apache', 'httpd', { versionFilter: (tag) => /^\d+\.\d+\.\d+$/.test(tag), existingVersions });
        if (result && result.versions.length > 0) {
          result.download_page = 'https://httpd.apache.org/download.cgi';
          result.windows_builds = 'https://www.apachelounge.com/download/';
          const allDownloads = [];
          for (const v of result.versions) {
            const winBinary = windowsBinaries.get(v.version);
            v.downloads = {
              windows: winBinary ? [winBinary] : [],
              source: [{ name: `httpd-${v.version}.tar.gz`, download_url: `https://archive.apache.org/dist/httpd/httpd-${v.version}.tar.gz`, type: 'source' }]
            };
            if (winBinary) allDownloads.push(winBinary);
            allDownloads.push(...v.downloads.source);
          }
          console.log(`📦 Apache: Fetching sizes for ${allDownloads.length} files...`);
          await fetchFileSizesParallel(allDownloads, 10);
        }
        return result;
      } catch (error) { console.error('Error fetching Apache:', error.message); return null; }
    }
  },
  {
    name: 'Composer', category: 'Package Managers', website: 'https://getcomposer.org',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubReleases('composer', 'composer', { existingVersions });
      if (result && result.versions.length > 0) {
        const allDownloads = [];
        for (const v of result.versions) {
          v.downloads = {
            other: [
              { name: `composer.phar`, download_url: `https://getcomposer.org/download/${v.version}/composer.phar`, type: 'phar' },
              { name: `composer-setup.php`, download_url: `https://getcomposer.org/download/${v.version}/composer-setup.php`, type: 'installer' }
            ]
          };
          allDownloads.push(...v.downloads.other);
        }
        console.log(`📦 Composer: Fetching sizes for ${allDownloads.length} files...`);
        await fetchFileSizesParallel(allDownloads, 10);
      }
      return result;
    }
  },
  { name: 'npm', category: 'Package Managers', website: 'https://www.npmjs.com', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('npm', 'cli', { existingVersions }); if (result) result.install_command = 'npm install -g npm@latest'; return result; } },
  { name: 'Yarn', category: 'Package Managers', website: 'https://yarnpkg.com', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('yarnpkg', 'berry', { existingVersions }); if (result) result.install_command = 'corepack enable && yarn set version stable'; return result; } },
  { name: 'pnpm', category: 'Package Managers', website: 'https://pnpm.io', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('pnpm', 'pnpm', { existingVersions }); if (result) result.install_command = 'npm install -g pnpm'; return result; } },
  { name: 'Bun', category: 'Package Managers', website: 'https://bun.sh', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('oven-sh', 'bun', { existingVersions }); if (result) result.install_command = 'curl -fsSL https://bun.sh/install | bash'; return result; } },
  { name: 'Laravel', category: 'Frameworks', website: 'https://laravel.com', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('laravel', 'framework', { existingVersions }); if (result) result.install_command = 'composer create-project laravel/laravel example-app'; return result; } },
  { name: 'Next.js', category: 'Frameworks', website: 'https://nextjs.org', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('vercel', 'next.js', { existingVersions }); if (result) result.install_command = 'npx create-next-app@latest'; return result; } },
  { name: 'Nuxt', category: 'Frameworks', website: 'https://nuxt.com', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('nuxt', 'nuxt', { existingVersions }); if (result) result.install_command = 'npx nuxi@latest init <project-name>'; return result; } },
  { name: 'Vue.js', category: 'Frameworks', website: 'https://vuejs.org', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('vuejs', 'core', { existingVersions }); if (result) result.install_command = 'npm create vue@latest'; return result; } },
  { name: 'React', category: 'Frameworks', website: 'https://react.dev', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('facebook', 'react', { existingVersions }); if (result) result.install_command = 'npm install react react-dom'; return result; } },
  { name: 'Svelte', category: 'Frameworks', website: 'https://svelte.dev', fetch: async (existingVersions = []) => { const result = await fetchAllGitHubReleases('sveltejs', 'svelte', { existingVersions }); if (result) result.install_command = 'npx sv create my-app'; return result; } },
  {
    name: 'Docker', category: 'DevOps', website: 'https://www.docker.com',
    fetch: async (existingVersions = []) => {
      const result = await fetchAllGitHubReleases('moby', 'moby', { existingVersions });
      if (result && result.versions.length > 0) {
        result.download_page = 'https://www.docker.com/products/docker-desktop/';
        const latestDownloads = [
          { name: 'Docker Desktop Installer.exe', download_url: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe', platform: 'windows', type: 'installer' },
          { name: 'Docker.dmg (Intel)', download_url: 'https://desktop.docker.com/mac/main/amd64/Docker.dmg', platform: 'macos', type: 'installer', arch: 'x64' },
          { name: 'Docker.dmg (ARM)', download_url: 'https://desktop.docker.com/mac/main/arm64/Docker.dmg', platform: 'macos', type: 'installer', arch: 'arm64' }
        ];
        console.log(`📦 Docker: Fetching sizes for ${latestDownloads.length} files...`);
        await fetchFileSizesParallel(latestDownloads, 5);
        for (const v of result.versions) {
          v.downloads = {
            windows: [latestDownloads[0]],
            macos: [latestDownloads[1], latestDownloads[2]]
          };
        }
      }
      return result;
    }
  },
  {
    name: 'Git', category: 'DevOps', website: 'https://git-scm.com',
    fetch: async (existingVersions = []) => {
      const [officialResult, windowsResult] = await Promise.all([fetchAllGitHubTags('git', 'git', { versionFilter: (tag) => /^v\d+\.\d+\.\d+$/.test(tag), existingVersions }), fetchAllGitHubReleases('git-for-windows', 'git', { existingVersions })]);
      if (!officialResult && !windowsResult) return null;
      const versions = officialResult?.versions || [];
      const windowsVersionMap = new Map();
      if (windowsResult && windowsResult.versions) { for (const wv of windowsResult.versions) { const versionMatch = wv.version.match(/^(\d+\.\d+\.\d+)/); if (versionMatch && !windowsVersionMap.has(versionMatch[1])) windowsVersionMap.set(versionMatch[1], wv); } }
      const mergedVersions = versions.map(v => ({ ...v, downloads: { windows: windowsVersionMap.get(v.version)?.downloads?.windows || [], source: [{ name: `git-${v.version}.tar.gz`, download_url: `https://github.com/git/git/archive/refs/tags/v${v.version}.tar.gz`, type: 'tarball' }, { name: `git-${v.version}.zip`, download_url: `https://github.com/git/git/archive/refs/tags/v${v.version}.zip`, type: 'zipball' }] } }));
      for (const [version, wv] of windowsVersionMap) { if (!versions.find(v => v.version === version)) mergedVersions.push({ version, tag: `v${version}`, downloads: { windows: wv.downloads?.windows || [], source: [] } }); }
      mergedVersions.sort((a, b) => { const aParts = a.version.split('.').map(Number), bParts = b.version.split('.').map(Number); for (let i = 0; i < 3; i++) { if (bParts[i] !== aParts[i]) return bParts[i] - aParts[i]; } return 0; });
      return { latest: mergedVersions[0], versions: mergedVersions, total_versions: mergedVersions.length, download_page: 'https://git-scm.com/downloads', windows_builds_source: 'https://github.com/git-for-windows/git' };
    }
  }
];

async function fetchAllVersions() {
  console.log('🚀 Starting version fetch (INCREMENTAL mode)...\n');
  console.log(`📊 Max new versions per scan: ${MAX_NEW_VERSIONS_PER_SCAN}`);
  console.log(`💾 Existing versions will be preserved\n`);
  const existingData = loadExistingData();
  const existingCategories = existingData?.software || {};
  const results = { last_updated: new Date().toISOString(), incremental_mode: true, software: {} };
  const categories = {};
  for (const software of SOFTWARE_LIST) {
    console.log(`📦 Fetching ${software.name}...`);
    try {
      const existingSwData = existingCategories[software.category]?.[software.name];
      const existingVersions = existingSwData?.versions || [];
      const newData = await software.fetch(existingVersions);
      if (!categories[software.category]) categories[software.category] = {};
      let mergedVersions = [];
      if (newData && newData.versions) mergedVersions = mergeVersions(existingVersions, newData.versions);
      else if (existingVersions.length > 0) mergedVersions = existingVersions;
      const addedCount = mergedVersions.length - existingVersions.length;
      categories[software.category][software.name] = { website: software.website, ...newData, versions: mergedVersions, latest: mergedVersions[0] || newData?.latest || null, total_versions: mergedVersions.length, fetched_at: new Date().toISOString() };
      if (addedCount > 0) console.log(`   ✅ ${software.name}: ${mergedVersions.length} total (${addedCount} new added)`);
      else if (mergedVersions.length > 0) console.log(`   ✅ ${software.name}: ${mergedVersions.length} versions (no new)`);
      else console.log(`   ⚠️ ${software.name}: No data found`);
    } catch (error) {
      console.error(`   ❌ ${software.name}: ${error.message}`);
      const existingSwData = existingCategories[software.category]?.[software.name];
      if (!categories[software.category]) categories[software.category] = {};
      if (existingSwData) { categories[software.category][software.name] = { ...existingSwData, last_error: error.message, fetched_at: new Date().toISOString() }; console.log(`   ℹ️  Preserved ${existingSwData.total_versions || 0} existing versions`); }
      else categories[software.category][software.name] = { website: software.website, error: error.message, fetched_at: new Date().toISOString() };
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  results.software = categories;
  const outputDir = path.join(__dirname, '..', 'versions');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'all-versions.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✨ Done! Results saved to ${outputPath}`);
  const summaryPath = path.join(outputDir, 'VERSIONS.md');
  fs.writeFileSync(summaryPath, generateMarkdownSummary(results));
  console.log(`📄 Summary saved to ${summaryPath}`);
  console.log(`\n💡 Run 'npm run build-api' to generate API files in docs/api/v1/`);
  return results;
}

function generateMarkdownSummary(results) {
  let md = `# Software Versions\n\n> Last updated: ${results.last_updated}\n> Max versions tracked per software: ${results.max_versions_per_software}\n\n`;
  for (const [category, software] of Object.entries(results.software)) {
    md += `## ${category}\n\n| Software | Latest Version | Total Versions | Downloads |\n|----------|----------------|----------------|----------|\n`;
    for (const [name, data] of Object.entries(software)) {
      if (data.error) md += `| ${name} | ⚠️ Error | - | - |\n`;
      else {
        const latest = data.latest || data.latest_lts || (data.versions && data.versions[0]);
        md += `| ${name} | ${latest?.version || 'N/A'} | ${data.total_versions || data.versions?.length || 0} | ${data.website ? `[Website](${data.website})` : '-'} |\n`;
      }
    }
    md += `\n`;
  }
  md += `---\n\n*For full version history with downloads, see individual JSON files or [all-versions.json](./all-versions.json)*\n`;
  return md;
}

fetchAllVersions().catch(console.error);
