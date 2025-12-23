# 📦 Apps Version API

**API to track latest versions of popular development tools.**

🌐 **Live Demo**: [https://mrijoo.github.io/apps-version-tracker](https://mrijoo.github.io/apps-version-tracker)

### Base URL

```
https://mrijoo.github.io/apps-version-tracker/api/v1
```

### Example Usage

```bash
# Get PHP versions
curl https://mrijoo.github.io/apps-version-tracker/api/v1/software/php.json

# Get all databases
curl https://mrijoo.github.io/apps-version-tracker/api/v1/categories/databases.json
```

```javascript
// JavaScript
const response = await fetch('https://mrijoo.github.io/apps-version-tracker/api/v1/software/node-js.json');
const data = await response.json();
console.log('Latest Version:', data.latest.version);
```

---

## 📖 API Reference

### Endpoints Overview

| Endpoint | Description |
|----------|-------------|
| `GET /meta.json` | API metadata & available software list |
| `GET /all.json` | Summary of all software with latest versions |
| `GET /software/{slug}.json` | Complete version history for a software |
| `GET /categories/{slug}.json` | All software in a specific category |

---

### `GET /meta.json`

Returns API metadata and list of all available software and categories.

#### Response Schema

```json
{
  "name": "string",
  "version": "string",
  "description": "string",
  "last_updated": "ISO 8601 datetime",
  "endpoints": {
    "all": "string",
    "software": "string",
    "categories": "string",
    "meta": "string"
  },
  "available_software": [
    {
      "name": "string",
      "slug": "string",
      "category": "string",
      "endpoint": "string"
    }
  ],
  "available_categories": [
    {
      "name": "string",
      "slug": "string",
      "endpoint": "string"
    }
  ]
}
```

#### Example Response

```json
{
  "name": "Apps Version Tracker API",
  "version": "1.0.0",
  "description": "Static API for tracking software versions",
  "last_updated": "2025-12-20T08:14:32.577Z",
  "endpoints": {
    "all": "/api/v1/all.json",
    "software": "/api/v1/software/{name}.json",
    "categories": "/api/v1/categories/{category}.json",
    "meta": "/api/v1/meta.json"
  },
  "available_software": [
    {
      "name": "PHP",
      "slug": "php",
      "category": "Languages",
      "endpoint": "/api/v1/software/php.json"
    }
  ],
  "available_categories": [
    {
      "name": "Languages",
      "slug": "languages",
      "endpoint": "/api/v1/categories/languages.json"
    }
  ]
}
```

---

### `GET /all.json`

Returns a summary of all tracked software with their latest versions.

#### Response Schema

```json
{
  "last_updated": "ISO 8601 datetime",
  "total_software": "number",
  "software": [
    {
      "name": "string",
      "slug": "string",
      "category": "string",
      "category_slug": "string",
      "latest_version": "string | null",
      "total_versions": "number",
      "endpoint": "string"
    }
  ]
}
```

#### Example Response

```json
{
  "last_updated": "2025-12-20T08:14:32.577Z",
  "total_software": 28,
  "software": [
    {
      "name": "PHP",
      "slug": "php",
      "category": "Languages",
      "category_slug": "languages",
      "latest_version": "8.5.1",
      "total_versions": 100,
      "endpoint": "/api/v1/software/php.json"
    },
    {
      "name": "Node.js",
      "slug": "node-js",
      "category": "Languages",
      "category_slug": "languages",
      "latest_version": "25.2.1",
      "total_versions": 100,
      "endpoint": "/api/v1/software/node-js.json"
    }
  ]
}
```

---

### `GET /software/{slug}.json`

Returns complete version history for a specific software including download links.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `slug` | string | Software slug (e.g., `php`, `node-js`, `postgresql`) |

#### Response Schema

```json
{
  "name": "string",
  "slug": "string",
  "category": "string",
  "website": "string | null",
  "download_page": "string | null",
  "total_versions": "number",
  "fetched_at": "ISO 8601 datetime",
  "latest": {
    "version": "string",
    "tag": "string",
    "published_at": "ISO 8601 datetime | null",
    "prerelease": "boolean",
    "release_url": "string",
    "downloads": {
      "windows": [],
      "linux": [],
      "macos": [],
      "source": []
    }
  },
  "versions": []
}
```

#### Download Object Schema

```json
{
  "name": "string",
  "download_url": "string",
  "size": "string | null",
  "size_bytes": "number | null",
  "type": "string",
  "arch": "string"
}
```

#### Example Response

```json
{
  "name": "PHP",
  "slug": "php",
  "category": "Languages",
  "website": "https://www.php.net",
  "total_versions": 100,
  "fetched_at": "2025-12-20T08:14:33.323Z",
  "latest": {
    "version": "8.5.1",
    "tag": "php-8.5.1",
    "published_at": null,
    "prerelease": false,
    "release_url": "https://github.com/php/php-src/releases/tag/php-8.5.1",
    "downloads": {
      "windows": [
        {
          "name": "php-8.5.1-Win32-vs17-x64.zip",
          "download_url": "https://windows.php.net/downloads/releases/php-8.5.1-Win32-vs17-x64.zip",
          "type": "Thread Safe (TS)",
          "arch": "x64"
        }
      ],
      "linux": [],
      "macos": [],
      "source": [
        {
          "name": "Source (tar.gz)",
          "download_url": "https://github.com/php/php-src/archive/refs/tags/php-8.5.1.tar.gz",
          "type": "tarball"
        }
      ]
    }
  },
  "versions": [...]
}
```

---

### `GET /categories/{slug}.json`

Returns all software in a specific category.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `slug` | string | Category slug (e.g., `languages`, `databases`, `frameworks`) |

#### Available Categories

| Category | Slug |
|----------|------|
| Languages | `languages` |
| Databases | `databases` |
| Web Servers | `web-servers` |
| Package Managers | `package-managers` |
| Frameworks | `frameworks` |
| DevOps | `devops` |

---