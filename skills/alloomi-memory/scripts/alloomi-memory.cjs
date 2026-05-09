#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORTS = [3515, 3415, 3414]; // dev, local fallback, prod
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

function apiRequest(endpoint, method = 'GET', body = null, portIndex = 0) {
  return new Promise((resolve, reject) => {
    if (portIndex >= PORTS.length) {
      reject(new Error(`Alloomi server not running. Tried ports: ${PORTS.join(', ')}`));
      return;
    }

    const port = PORTS[portIndex];
    const url = new URL(endpoint, `http://localhost:${port}`);
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
        // Check for auth errors on RAG endpoints (401 in body or status)
        let authError = null;
        try {
          const json = JSON.parse(data);
          if (json.error?.message?.includes('401') || json.error?.code === 401) {
            authError = json.error.message;
          }
        } catch {}

        if ((res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 500) && authError) {
          if (endpoint.includes('/api/rag/') || endpoint.includes('/api/insights')) {
            const isRag = endpoint.includes('/api/rag/');
            const hint = isRag
              ? '\n\nHint: search-knowledge requires Embeddings API authentication.\nYou may need to:\n1. Login via web browser to get cookie auth\n2. Or configure EMBEDDINGS_API_KEY in your Alloomi settings'
              : '\n\nHint: This endpoint requires authentication. Ensure you are logged in.';
            reject(new Error(`${authError}${hint}`));
            return;
          }
        }
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', () => {
      // Try next port on connection error
      apiRequest(endpoint, method, body, portIndex + 1).then(resolve).catch(reject);
    });
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

  const queryLower = query ? query.toLowerCase() : null;
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

          if (queryLower === null) {
            // No query - list all files with their first line as preview
            const relPath = path.relative(MEMORY_DIR, fullPath);
            const firstLine = lines[0] ? lines[0].trim().substring(0, 200) : '(empty file)';
            results.push({
              file: relPath,
              line: 1,
              preview: firstLine
            });
          } else {
            // Search mode - find lines matching query
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

async function listInsights(days = 7, limit = 50, channel = null, keywords = null) {
  const data = await apiRequest(`/api/insights?days=${days}&limit=${limit}`);
  // Filter by channel if specified (check both groups array and platform field)
  if (channel && data.items) {
    data.items = data.items.filter(insight =>
      (insight.groups?.includes(channel)) ||
      insight.platform === channel
    );
    data.total = data.items.length;
  }
  // Filter by keywords if specified (OR logic - any keyword matches)
  if (keywords && keywords.length > 0 && data.items) {
    const kws = keywords.map(k => k.toLowerCase());
    data.items = data.items.filter(insight => {
      const str = JSON.stringify(insight).toLowerCase();
      return kws.some(kw => str.includes(kw));
    });
    data.total = data.items.length;
  }
  return data;
}

async function getInsight(id) {
  return apiRequest(`/api/insights/${id}?fetch=true`);
}

async function deleteInsight(id) {
  return apiRequest(`/api/insights/${id}`, 'DELETE');
}

async function addInsight(title, description, options = {}) {
  const {
    importance,
    urgency,
    platform,
    groups,
    categories,
    people,
    details,
    timeline,
    myTasks,
  } = options;

  const body = { title, description };
  if (importance) body.importance = importance;
  if (urgency) body.urgency = urgency;
  if (platform) body.platform = platform;
  if (groups) body.groups = groups;
  if (categories) body.categories = categories;
  if (people) body.people = people;
  if (details) body.details = details;
  if (timeline) body.timeline = timeline;
  if (myTasks) body.myTasks = myTasks;

  return apiRequest('/api/insights', 'POST', body);
}

async function updateInsight(id, updates) {
  return apiRequest(`/api/insights/${id}`, 'PUT', { updates });
}

async function addMemory(content, fileName, directory = null) {
  const filePath = directory
    ? path.join(MEMORY_DIR, directory, fileName)
    : path.join(MEMORY_DIR, fileName);

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return { success: true, path: filePath };
}

async function deleteMemory(fileName, directory = null) {
  const filePath = directory
    ? path.join(MEMORY_DIR, directory, fileName)
    : path.join(MEMORY_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  fs.unlinkSync(filePath);
  return { success: true, deleted: filePath };
}

async function searchAll(query) {
  const [memoryResult, knowledgeResult, insightsResult] = await Promise.allSettled([
    searchMemory(query),
    searchKnowledge(query, 5).catch(() => ({ results: [], error: 'Knowledge base unavailable' })),
    listInsights(30, 20).catch(() => ({ insights: [], error: 'Insights unavailable' }))
  ]);

  return {
    memory: {
      source: 'local files',
      ...(memoryResult.status === 'fulfilled' ? memoryResult.value : { results: [], error: memoryResult.reason?.message })
    },
    knowledge: {
      source: 'knowledge base (RAG)',
      ...(knowledgeResult.status === 'fulfilled' ? knowledgeResult.value : { results: [], error: 'Unavailable' })
    },
    insights: {
      source: 'extracted insights',
      ...(insightsResult.status === 'fulfilled' ? insightsResult.value : { insights: [], error: 'Unavailable' })
    }
  };
}

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  try {
    switch (command) {
      case 'search-all': {
        const query = args[0];
        if (!query) throw new Error('Query required: search-all <query>');
        const result = await searchAll(query);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'search-memory': {
        const query = args[0] || '';
        let directory = null;
        const dirArg = args.find(a => a.startsWith('--directory='));
        if (dirArg) directory = dirArg.split('=')[1];

        if (!query && !directory) {
          throw new Error('Query or --directory required: search-memory <query> [--directory=<subdir>]');
        }

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
        if (limitArg) limit = Number.parseInt(limitArg.split('=')[1]);

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
        let channel = null;
        let keywords = [];

        for (const arg of args) {
          if (arg.startsWith('--days=')) days = Number.parseInt(arg.split('=')[1]);
          if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=')[1]);
          if (arg.startsWith('--channel=')) channel = arg.split('=')[1];
          if (arg.startsWith('--keyword=')) keywords.push(arg.split('=')[1]);
        }

        const result = await listInsights(days, limit, channel, keywords);
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

      case 'add-insight': {
        let title = null;
        let description = null;
        let importance = null;
        let urgency = null;
        let groups = null;
        let categories = null;
        let people = null;

        for (const arg of args) {
          if (arg.startsWith('--title=')) title = arg.split('=')[1];
          if (arg.startsWith('--description=')) description = arg.split('=')[1];
          if (arg.startsWith('--importance=')) importance = arg.split('=')[1];
          if (arg.startsWith('--urgency=')) urgency = arg.split('=')[1];
          if (arg.startsWith('--groups=')) groups = arg.split('=')[1].split(',');
          if (arg.startsWith('--categories=')) categories = arg.split('=')[1].split(',');
          if (arg.startsWith('--people=')) people = arg.split('=')[1].split(',');
        }

        if (!title) throw new Error('--title=<title> required');
        if (!description) throw new Error('--description=<text> required');

        const result = await addInsight(title, description, {
          importance,
          urgency,
          groups,
          categories,
          people,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'update-insight': {
        const id = args[0];
        if (!id) throw new Error('Insight ID required: update-insight <id>');

        // Parse updates from remaining args
        const updates = {};
        for (const arg of args.slice(1)) {
          if (arg.startsWith('--title=')) updates.title = arg.split('=')[1];
          if (arg.startsWith('--description=')) updates.description = arg.split('=')[1];
          if (arg.startsWith('--importance=')) updates.importance = arg.split('=')[1];
          if (arg.startsWith('--urgency=')) updates.urgency = arg.split('=')[1];
          if (arg.startsWith('--groups=')) updates.groups = arg.split('=')[1].split(',');
          if (arg.startsWith('--categories=')) updates.categories = arg.split('=')[1].split(',');
          if (arg.startsWith('--people=')) updates.people = arg.split('=')[1].split(',');
          // For task update: --task-text=<text> --task-completed=<true|false>
          if (arg.startsWith('--task-text=')) {
            const taskText = arg.split('=')[1];
            updates.myTasks = updates.myTasks || [];
            updates.myTasks.push({ text: taskText, completed: false });
          }
          if (arg.startsWith('--task-completed=')) {
            const completed = arg.split('=')[1] === 'true';
            if (updates.myTasks && updates.myTasks.length > 0) {
              updates.myTasks[updates.myTasks.length - 1].completed = completed;
            }
          }
          // For detail: --detail=<content>
          if (arg.startsWith('--detail=')) {
            const content = arg.split('=')[1];
            updates.details = updates.details || [];
            updates.details.push({ content });
          }
          // For timeline: --timeline-summary=<text> --timeline-label=<label>
          if (arg.startsWith('--timeline-summary=')) {
            const summary = arg.split('=')[1];
            updates.timeline = updates.timeline || [];
            const idx = updates.timeline.length - 1 >= 0 ? updates.timeline.length - 1 : 0;
            if (!updates.timeline[idx]) {
              updates.timeline.push({ summary });
            } else {
              updates.timeline[idx].summary = summary;
            }
          }
          if (arg.startsWith('--timeline-label=')) {
            const label = arg.split('=')[1];
            updates.timeline = updates.timeline || [];
            const idx = updates.timeline.length - 1 >= 0 ? updates.timeline.length - 1 : 0;
            if (!updates.timeline[idx]) {
              updates.timeline.push({ label });
            } else {
              updates.timeline[idx].label = label;
            }
          }
        }

        if (Object.keys(updates).length === 0) {
          throw new Error('No updates provided. Use --title=, --description=, --detail=, etc.');
        }

        const result = await updateInsight(id, updates);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'add-memory': {
        const content = args[0];
        let fileName = null;
        let directory = null;

        for (const arg of args) {
          if (arg.startsWith('--file=')) fileName = arg.split('=')[1];
          if (arg.startsWith('--directory=')) directory = arg.split('=')[1];
        }

        if (!content) throw new Error('Content required: add-memory <content> [--file=<filename>] [--directory=<subdir>]');
        if (!fileName) {
          // Generate filename from first line of content
          const firstLine = content.split('\n')[0].trim().substring(0, 50).replace(/[^a-zA-Z0-9_-]/g, '_');
          fileName = `${firstLine}.md`;
        }

        const result = await addMemory(content, fileName, directory);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'delete-memory': {
        const fileName = args[0];
        let directory = null;
        const dirArg = args.find(a => a.startsWith('--directory='));
        if (dirArg) directory = dirArg.split('=')[1];

        if (!fileName) throw new Error('Filename required: delete-memory <filename> [--directory=<subdir>]');

        const result = await deleteMemory(fileName, directory);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.log(JSON.stringify({
          error: 'Unknown command',
          usage: `
Commands:
  search-all <query>                                              Search all memory sources at once
  search-memory <query> [--directory=<subdir>]                     Search local memory files
  search-knowledge <query> [--limit=5]                              Search knowledge base (RAG)
  list-documents [--limit=50]                                       List knowledge base documents
  get-document <id>                                                 Get document content
  list-insights [--days=7] [--limit=50] [--channel=<channel>]     List recent insights (optionally filtered by channel)
  get-insight <id>                                                  Get single insight
  delete-insight <id>                                               Delete an insight
  add-insight --title=<title> --description=<text>                  Create a new insight
  update-insight <id> [--title=<title>] [--description=<text>]     Update an insight
  add-memory <content> [--file=<filename>] [--directory=<subdir>]   Add a memory file
  delete-memory <filename> [--directory=<subdir>]                    Delete a memory file

Channels: gmail, outlook, telegram, whatsapp, slack, discord, linkedin, twitter, weixin, rss
Insight importance: Important, General, Not Important
Insight urgency: As soon as possible, Within 24 hours, Not urgent, General

Examples:
  add-insight --title="Coffee preference" --description="I prefer Americano" --importance=General
  update-insight insight_xxx --description="Updated description" --detail="User mentioned new preference"
  add-memory "My boss John likes Monday project discussions" --file=people/boss.md
  delete-memory people/boss.md --directory=people
  list-insights --days=7 --limit=50                    # Get recent insights
  list-insights --channel=gmail --days=7               # Get Gmail insights from last 7 days
  list-insights --channel=telegram --days=30           # Get Telegram insights from last 30 days
          `.trim()
        }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

main();
