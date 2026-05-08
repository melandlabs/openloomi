#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const API_BASE = 'http://localhost:3415';
const MEMORY_DIR = path.join(os.homedir(), '.alloomi', 'data', 'memory');
const TOKEN_PATH = path.join(os.homedir(), '.alloomi', 'token');

function getAuthToken() {
  try {
    const encoded = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    // Token is stored as base64 encoded JWT, decode it
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    return decoded;
  } catch {
    return null;
  }
}

function apiRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_BASE);
    const token = getAuthToken();

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function searchMemory(query, directory = null) {
  const searchDir = directory
    ? path.join(MEMORY_DIR, directory)
    : MEMORY_DIR;

  if (!fs.existsSync(searchDir)) {
    return { results: [], message: `Directory not found: ${searchDir}` };
  }

  const queryLower = query.toLowerCase();
  const results = [];

  function searchDirRecursive(dir, depth = 0) {
    if (depth > 5) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        searchDirRecursive(fullPath, depth + 1);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              const relPath = path.relative(MEMORY_DIR, fullPath);
              results.push({
                file: relPath,
                line: i + 1,
                preview: lines[i].trim().substring(0, 200)
              });
              break;
            }
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    }
  }

  searchDirRecursive(searchDir);
  return { results, total: results.length };
}

async function searchKnowledge(query, limit = 5) {
  return apiRequest('/api/rag/search', 'POST', { query, limit });
}

async function listDocuments(limit = 50) {
  return apiRequest(`/api/rag/documents?limit=${limit}`);
}

async function getDocument(id) {
  return apiRequest(`/api/rag/documents/${id}`);
}

async function listInsights(days = 7, limit = 50) {
  return apiRequest(`/api/insights?days=${days}&limit=${limit}`);
}

async function getInsight(id) {
  return apiRequest(`/api/insights/${id}?fetch=true`);
}

async function deleteInsight(id) {
  return apiRequest(`/api/insights/${id}`, 'DELETE');
}

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  try {
    switch (command) {
      case 'search-memory': {
        const query = args[0];
        if (!query) throw new Error('Query required: search-memory <query>');

        let directory = null;
        const dirArg = args.find(a => a.startsWith('--directory='));
        if (dirArg) directory = dirArg.split('=')[1];

        const result = await searchMemory(query, directory);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'search-knowledge': {
        const query = args[0];
        if (!query) throw new Error('Query required: search-knowledge <query>');

        let limit = 5;
        const limitArg = args.find(a => a.startsWith('--limit='));
        if (limitArg) limit = Number.parseInt(limitArg.split('=')[1]);

        const result = await searchKnowledge(query, limit);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'list-documents': {
        let limit = 50;
        const limitArg = args.find(a => a.startsWith('--limit='));
        if (limitArg) limit = parseInt(limitArg.split('=')[1]);

        const result = await listDocuments(limit);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'get-document': {
        const id = args[0];
        if (!id) throw new Error('Document ID required: get-document <id>');
        const result = await getDocument(id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'list-insights': {
        let days = 7;
        let limit = 50;

        for (const arg of args) {
          if (arg.startsWith('--days=')) days = Number.parseInt(arg.split('=')[1]);
          if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=')[1]);
        }

        const result = await listInsights(days, limit);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'get-insight': {
        const id = args[0];
        if (!id) throw new Error('Insight ID required: get-insight <id>');
        const result = await getInsight(id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'delete-insight': {
        const id = args[0];
        if (!id) throw new Error('Insight ID required: delete-insight <id>');
        const result = await deleteInsight(id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.log(JSON.stringify({
          error: 'Unknown command',
          usage: `
Commands:
  search-memory <query> [--directory=<subdir>]    Search local memory files
  search-knowledge <query> [--limit=5]             Search knowledge base (RAG)
  list-documents [--limit=50]                      List knowledge base documents
  get-document <id>                                Get document content
  list-insights [--days=7] [--limit=50]           List recent insights
  get-insight <id>                                 Get single insight
  delete-insight <id>                              Delete an insight
          `.trim()
        }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

main();
