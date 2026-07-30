#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PORTS = [3414, 3515];
const TOKEN_PATH = path.join(os.homedir(), '.openloomi', 'token');
const OFFICIAL_SETUP_URL = 'https://openloomi.ai/docs/getting-started';
const OFFICIAL_RELEASES_URL = 'https://github.com/melandlabs/openloomi/releases';
const REQUEST_TIMEOUT_MS = 1500;

function fileExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fileExists(candidate)) || null;
}

function gatherInstallCandidates() {
  const candidates = new Set();
  const home = os.homedir();
  const add = (...items) => {
    for (const item of items.flat()) {
      if (item) candidates.add(path.normalize(item));
    }
  };

  add(process.env.OPENLOOMI_APP, process.env.OPENLOOMI_BIN);

  if (process.env.OPENLOOMI_INSTALL_DIR) {
    const installDir = path.normalize(process.env.OPENLOOMI_INSTALL_DIR);
    add(
      installDir,
      path.join(installDir, 'OpenLoomi.app'),
      path.join(installDir, 'openloomi.exe'),
      path.join(installDir, 'openloomi'),
      path.join(installDir, 'Contents', 'MacOS', 'OpenLoomi'),
    );
  }

  if (process.platform === 'darwin') {
    add(
      '/Applications/OpenLoomi.app',
      path.join(home, 'Applications', 'OpenLoomi.app'),
      path.join(home, 'Applications', 'OpenLoomi.app', 'Contents', 'MacOS', 'OpenLoomi'),
    );
  } else if (process.platform === 'win32') {
    add(
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'OpenLoomi', 'OpenLoomi.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'OpenLoomi', 'OpenLoomi.exe'),
      path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'OpenLoomi', 'OpenLoomi.exe'),
      path.join(home, 'AppData', 'Local', 'OpenLoomi', 'OpenLoomi.exe'),
    );
  } else {
    add(
      '/opt/OpenLoomi/openloomi',
      '/usr/bin/openloomi',
      '/usr/local/bin/openloomi',
      path.join(home, '.local', 'bin', 'openloomi'),
      path.join(home, '.local', 'share', 'OpenLoomi', 'openloomi'),
    );
  }

  return [...candidates];
}

function detectInstalled() {
  const candidates = gatherInstallCandidates();
  const installedPath = firstExisting(candidates);
  return {
    installed: Boolean(installedPath),
    installedPath,
    candidates,
  };
}

function readToken() {
  const envToken = (process.env.OPENLOOMI_AUTH_TOKEN || '').trim();
  if (envToken) {
    return { tokenPresent: true, tokenSource: 'env', tokenPath: null };
  }

  try {
    if (!fs.existsSync(TOKEN_PATH)) {
      return { tokenPresent: false, tokenSource: null, tokenPath: TOKEN_PATH };
    }
    const encoded = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    if (!encoded) {
      return { tokenPresent: false, tokenSource: 'file-empty', tokenPath: TOKEN_PATH };
    }
    const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
    return {
      tokenPresent: Boolean(decoded),
      tokenSource: decoded ? 'file' : 'file-invalid',
      tokenPath: TOKEN_PATH,
    };
  } catch {
    return { tokenPresent: false, tokenSource: 'file-error', tokenPath: TOKEN_PATH };
  }
}

function probeOnce(baseUrl, endpoint) {
  return new Promise((resolve) => {
    const url = new URL(endpoint, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'Accept': 'application/json, text/plain, */*' },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve({
            baseUrl,
            endpoint,
            reachable: true,
            status: res.statusCode,
            note: res.statusCode >= 200 && res.statusCode < 500 ? 'http-response' : 'unexpected-status',
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (error) => {
      resolve({
        baseUrl,
        endpoint,
        reachable: false,
        status: null,
        note: error.code || error.message || 'network-error',
      });
    });
    req.end();
  });
}

async function probeApi() {
  const bases = [];
  if (process.env.OPENLOOMI_API_URL) bases.push(process.env.OPENLOOMI_API_URL);
  bases.push(...PORTS.map((port) => `http://127.0.0.1:${port}`));

  const attempts = [];
  for (const baseUrl of bases) {
    for (const endpoint of ['/api/native/providers', '/api/remote-auth/user', '/']) {
      // Stop at the first reachable response for a given base.
      // Keep the individual attempts for debugging and UX hints.
      // eslint-disable-next-line no-await-in-loop
      const attempt = await probeOnce(baseUrl, endpoint);
      attempts.push(attempt);
      if (attempt.reachable) {
        return {
          apiReachable: true,
          apiBaseUrl: baseUrl,
          apiProbe: attempts,
        };
      }
    }
  }

  return {
    apiReachable: false,
    apiBaseUrl: null,
    apiProbe: attempts,
  };
}

function deriveNextAction({ installed, apiReachable, tokenPresent }) {
  if (apiReachable && tokenPresent) return null;
  if (!apiReachable && !installed) return 'install_openloomi';
  if (!apiReachable) return 'open_openloomi';
  if (!tokenPresent) return 'finish_session';
  return null;
}

function buildHints(state) {
  const hints = [];
  if (state.ready) {
    hints.push('OpenLoomi is ready. Continue with memory, connectors, Loop, or API skills.');
    return hints;
  }

  if (!state.installed) {
    hints.push(`Install OpenLoomi from ${OFFICIAL_SETUP_URL}`);
    hints.push(`Official releases: ${OFFICIAL_RELEASES_URL}`);
    return hints;
  }

  if (!state.apiReachable) {
    hints.push('Open OpenLoomi Desktop and wait for the local API to start.');
    hints.push('If the app is already open, retry after a short pause.');
  }

  if (!state.tokenPresent) {
    hints.push('Complete sign-in or guest session setup inside OpenLoomi Desktop.');
  }

  return hints;
}

async function status() {
  const installed = detectInstalled();
  const token = readToken();
  const api = await probeApi();

  const ready = api.apiReachable && token.tokenPresent;
  const nextAction = deriveNextAction({
    installed: installed.installed,
    apiReachable: api.apiReachable,
    tokenPresent: token.tokenPresent,
  });

  const result = {
    ready,
    installed: installed.installed,
    installedPath: installed.installedPath,
    tokenPresent: token.tokenPresent,
    tokenSource: token.tokenSource,
    tokenPath: token.tokenPath,
    apiReachable: api.apiReachable,
    apiBaseUrl: api.apiBaseUrl,
    apiProbe: api.apiProbe,
    nextAction,
    officialSetupUrl: OFFICIAL_SETUP_URL,
    officialReleasesUrl: OFFICIAL_RELEASES_URL,
  };

  result.hints = buildHints(result);
  return result;
}

async function main() {
  const [command = 'status'] = process.argv.slice(2);

  if (command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write([
      'Usage: openloomi-setup <status>',
      '',
      'Commands:',
      '  status   Print OpenLoomi readiness as JSON',
    ].join('\n'));
    return;
  }

  if (command !== 'status' && command !== 'setup-status' && command !== 'check') {
    throw new Error(`Unknown command: ${command}`);
  }

  const result = await status();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});
