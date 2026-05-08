#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const API_BASE = 'http://localhost:3415';
const TOKEN_PATH = path.join(os.homedir(), '.alloomi', 'token');

// Platform definitions matching connector-target.ts
const PLATFORMS = [
  { id: 'telegram', name: 'Telegram', aliases: ['tg'] },
  { id: 'whatsapp', name: 'WhatsApp', aliases: [] },
  { id: 'slack', name: 'Slack', aliases: [] },
  { id: 'discord', name: 'Discord', aliases: [] },
  { id: 'gmail', name: 'Gmail', aliases: ['google_mail'] },
  { id: 'outlook', name: 'Outlook', aliases: ['outlook_mail'] },
  { id: 'linkedin', name: 'LinkedIn', aliases: [] },
  { id: 'instagram', name: 'Instagram', aliases: [] },
  { id: 'twitter', name: 'X/Twitter', aliases: ['x', 'tweet', 'tweets', '推特', 'x_twitter', 'xtwitter'] },
  { id: 'google_calendar', name: 'Google Calendar', aliases: ['gcal'] },
  { id: 'outlook_calendar', name: 'Outlook Calendar', aliases: [] },
  { id: 'teams', name: 'Microsoft Teams', aliases: ['microsoft_teams'] },
  { id: 'facebook_messenger', name: 'Facebook Messenger', aliases: ['messenger'] },
  { id: 'google_drive', name: 'Google Drive', aliases: ['gdrive'] },
  { id: 'google_docs', name: 'Google Docs', aliases: ['gdocs'] },
  { id: 'hubspot', name: 'HubSpot', aliases: [] },
  { id: 'notion', name: 'Notion', aliases: [] },
  { id: 'github', name: 'GitHub', aliases: ['gh'] },
  { id: 'asana', name: 'Asana', aliases: [] },
  { id: 'jira', name: 'Jira', aliases: [] },
  { id: 'linear', name: 'Linear', aliases: [] },
  { id: 'imessage', name: 'iMessage', aliases: [] },
  { id: 'feishu', name: 'Lark/Feishu', aliases: ['lark', '飞书'] },
  { id: 'dingtalk', name: 'DingTalk', aliases: ['钉钉'] },
  { id: 'qqbot', name: 'QQ', aliases: ['qq', 'qq_bot'] },
  { id: 'weixin', name: 'WeChat', aliases: ['wechat', '微信', 'wechat_work', 'wecom', '企业微信'] },
];

// Build alias lookup map (case-insensitive)
const ALIAS_TO_PLATFORM = {};
for (const p of PLATFORMS) {
  ALIAS_TO_PLATFORM[p.id] = p.id;
  for (const alias of p.aliases) {
    ALIAS_TO_PLATFORM[alias.toLowerCase()] = p.id;
  }
}

// OAuth start endpoints by platform
const OAUTH_ENDPOINTS = {
  slack: '/api/integrations/slack/oauth/start',
  discord: '/api/integrations/discord/oauth/start',
  x: '/api/integrations/x/oauth/start',
};

function getAuthToken() {
  try {
    const encoded = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
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

function openUrl(url) {
  const cmd = os.platform() === 'darwin' ? 'open' : os.platform() === 'win32' ? 'start' : 'xdg-open';
  execSync(`${cmd} "${url}"`, { stdio: 'ignore' });
}

function resolvePlatform(input) {
  if (!input) return null;
  const normalized = input.toLowerCase().trim();
  return ALIAS_TO_PLATFORM[normalized] || null;
}

async function listPlatforms() {
  return {
    platforms: PLATFORMS.map(p => ({
      id: p.id,
      name: p.name,
      aliases: p.aliases
    })),
    total: PLATFORMS.length
  };
}

async function listAccounts() {
  return apiRequest('/api/integrations/accounts');
}

async function getStatus(platform) {
  const platformId = resolvePlatform(platform);
  if (!platformId) {
    throw new Error(`Unknown platform: ${platform}. Use list-platforms to see available platforms.`);
  }

  const data = await apiRequest('/api/integrations/accounts');
  const accounts = data.accounts || [];
  const matching = accounts.filter(a => a.platform === platformId);

  if (matching.length === 0) {
    return {
      platform: platformId,
      connected: false,
      accounts: []
    };
  }

  return {
    platform: platformId,
    connected: true,
    accounts: matching.map(a => ({
      id: a.id,
      displayName: a.displayName,
      status: a.status,
      connectedAt: a.createdAt
    }))
  };
}

async function getOAuthUrl(platform) {
  const platformId = resolvePlatform(platform);
  if (!platformId) {
    throw new Error(`Unknown platform: ${platform}. Use list-platforms to see available platforms.`);
  }

  const endpoint = OAUTH_ENDPOINTS[platformId];
  if (!endpoint) {
    throw new Error(`OAuth not supported for ${platformId} via CLI. Use the web UI to connect.`);
  }

  // Get userId from token for OAuth start
  const token = getAuthToken();
  if (!token) {
    throw new Error('Not authenticated. Please log in to Alloomi first.');
  }

  // Decode JWT to get userId (payload is base64 of JSON)
  let userId = 'local';
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      userId = payload.sub || payload.userId || 'local';
    }
  } catch {
    // Use default
  }

  const data = await apiRequest(`${endpoint}?userId=${encodeURIComponent(userId)}`);
  return {
    platform: platformId,
    authorizationUrl: data.authorizationUrl,
    state: data.state,
    instructions: 'Open the URL in your browser to authorize. The CLI will attempt to open it automatically.'
  };
}

async function disconnectAccount(accountId) {
  if (!accountId) {
    throw new Error('Account ID required: disconnect <accountId>');
  }
  return apiRequest(`/api/integrations/${accountId}`, 'DELETE');
}

async function connectEmailPlatform(platformId, email, appPassword) {
  const validateEndpoint = platformId === 'gmail' ? '/api/google/validate' : '/api/outlook/validate';

  // Validate credentials first
  const validateResult = await apiRequest(validateEndpoint, 'POST', {
    email,
    appPassword
  });

  if (validateResult.error) {
    throw new Error(validateResult.error);
  }

  // Create the integration account
  const account = await apiRequest('/api/integrations', 'POST', {
    platform: platformId,
    externalId: email,
    displayName: validateResult.name || email.split('@')[0],
    credentials: {
      email,
      appPassword
    },
    metadata: {
      email,
      name: validateResult.name || email.split('@')[0]
    },
    bot: {
      name: `${platformId === 'gmail' ? 'Gmail' : 'Outlook'} · ${validateResult.name || email}`,
      description: `Automatically created through ${platformId} authorization`,
      adapter: platformId,
      enable: true
    }
  });

  return {
    platform: platformId,
    email,
    account,
    message: `${platformId === 'gmail' ? 'Gmail' : 'Outlook'} account connected successfully!`
  };
}

// Platforms that use appId/appSecret credentials (no validation API needed)
async function connectAppCredentialsPlatform(platformId, credentials, displayName) {
  const adapterMap = {
    dingtalk: 'dingtalk',
    qqbot: 'qqbot',
    feishu: 'feishu'
  };

  const adapter = adapterMap[platformId];
  if (!adapter) {
    throw new Error(`${platformId} does not support CLI connection with credentials`);
  }

  const account = await apiRequest('/api/integrations', 'POST', {
    platform: platformId,
    externalId: credentials.clientId || credentials.appId || displayName,
    displayName: displayName || platformId,
    credentials,
    metadata: {
      name: displayName || platformId
    },
    bot: {
      name: `${platformId} · ${displayName || 'Bot'}`,
      description: `Automatically created through ${platformId} authorization`,
      adapter,
      enable: true
    }
  });

  return {
    platform: platformId,
    account,
    message: `${platformId} connected successfully!`
  };
}

// WeChat iLink Token connection
async function connectWeChat(token) {
  const account = await apiRequest('/api/integrations', 'POST', {
    platform: 'weixin',
    externalId: 'wechat',
    displayName: 'WeChat',
    credentials: {
      ilinkToken: token
    },
    metadata: {
      type: 'wechat'
    },
    bot: {
      name: 'WeChat · Bot',
      description: 'Automatically created through iLink Token authorization',
      adapter: 'weixin',
      enable: true
    }
  });

  return {
    platform: 'weixin',
    account,
    message: 'WeChat connected successfully!'
  };
}

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  try {
    switch (command) {
      case 'list-platforms': {
        const result = await listPlatforms();
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'list-accounts': {
        const result = await listAccounts();
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'status': {
        const platform = args[0];
        if (!platform) throw new Error('Platform required: status <platform>');
        const result = await getStatus(platform);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'connect': {
        const platform = args[0];
        if (!platform) throw new Error('Platform required: connect <platform>');

        const platformId = resolvePlatform(platform);
        if (!platformId) {
          throw new Error(`Unknown platform: ${platform}. Use list-platforms to see available platforms.`);
        }

        // Email platforms (gmail, outlook) - require validation
        if (platformId === 'gmail' || platformId === 'outlook') {
          const emailArg = args.find(a => a.startsWith('--email='));
          const passwordArg = args.find(a => a.startsWith('--password='));

          if (!emailArg || !passwordArg) {
            throw new Error(`Missing credentials. For ${platformId}, provide:\n  connect ${platformId} --email=you@example.com --password=your_app_password`);
          }

          const email = emailArg.split('=')[1];
          const appPassword = passwordArg.split('=')[1];

          if (platformId === 'gmail' && appPassword.length !== 16) {
            throw new Error('Gmail app password must be exactly 16 characters');
          }

          const result = await connectEmailPlatform(platformId, email, appPassword);
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        // DingTalk (clientId + clientSecret)
        if (platformId === 'dingtalk') {
          const clientIdArg = args.find(a => a.startsWith('--clientId='));
          const clientSecretArg = args.find(a => a.startsWith('--clientSecret='));
          const nameArg = args.find(a => a.startsWith('--name='));

          if (!clientIdArg || !clientSecretArg) {
            throw new Error(`Missing credentials. For DingTalk, provide:\n  connect dingtalk --clientId=your_client_id --clientSecret=your_client_secret`);
          }

          const result = await connectAppCredentialsPlatform(platformId, {
            clientId: clientIdArg.split('=')[1],
            clientSecret: clientSecretArg.split('=')[1]
          }, nameArg ? nameArg.split('=')[1] : 'DingTalk');
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        // QQ Bot (appId + appSecret)
        if (platformId === 'qqbot') {
          const appIdArg = args.find(a => a.startsWith('--appId='));
          const appSecretArg = args.find(a => a.startsWith('--appSecret='));
          const nameArg = args.find(a => a.startsWith('--name='));

          if (!appIdArg || !appSecretArg) {
            throw new Error(`Missing credentials. For QQ Bot, provide:\n  connect qq --appId=your_app_id --appSecret=your_app_secret`);
          }

          const result = await connectAppCredentialsPlatform(platformId, {
            appId: appIdArg.split('=')[1],
            appSecret: appSecretArg.split('=')[1]
          }, nameArg ? nameArg.split('=')[1] : 'QQ Bot');
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        // Feishu (appId + appSecret)
        if (platformId === 'feishu') {
          const appIdArg = args.find(a => a.startsWith('--appId='));
          const appSecretArg = args.find(a => a.startsWith('--appSecret='));
          const nameArg = args.find(a => a.startsWith('--name='));

          if (!appIdArg || !appSecretArg) {
            throw new Error(`Missing credentials. For Feishu, provide:\n  connect feishu --appId=your_app_id --appSecret=your_app_secret`);
          }

          const result = await connectAppCredentialsPlatform(platformId, {
            appId: appIdArg.split('=')[1],
            appSecret: appSecretArg.split('=')[1]
          }, nameArg ? nameArg.split('=')[1] : 'Feishu');
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        // WeChat (iLink Token)
        if (platformId === 'weixin') {
          const tokenArg = args.find(a => a.startsWith('--token='));

          if (!tokenArg) {
            throw new Error(`Missing iLink token. For WeChat, provide:\n  connect wechat --token=your_ilink_token`);
          }

          const result = await connectWeChat(tokenArg.split('=')[1]);
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        // OAuth platforms (auto-opens browser)
        if (OAUTH_ENDPOINTS[platformId]) {
          const result = await getOAuthUrl(platform);
          console.log(JSON.stringify(result, null, 2));
          try {
            openUrl(result.authorizationUrl);
          } catch {
            // Silently ignore if open fails
          }
          break;
        }

        // Platforms requiring browser (WhatsApp, etc)
        throw new Error(`${platformId} requires browser interaction. Open in browser:\n  open "http://localhost:3415/connectors?addPlatform=true&platform=${platformId}"`);
      }

      case 'disconnect': {
        const accountId = args[0];
        const result = await disconnectAccount(accountId);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.log(JSON.stringify({
          error: 'Unknown command',
          usage: `
Commands:
  list-platforms                                List all supported platforms
  list-accounts                                List all connected accounts
  status <platform>                            Check connection status for a platform
  connect <platform> [options]                  Connect a platform
  disconnect <accountId>                        Disconnect an account by ID

Platform Connection Methods:
  OAuth (auto-opens browser):
    connect slack
    connect discord
    connect x

  Email (App Password):
    connect gmail --email=x@gmail.com --password=xxxx_xxxx_xxxx_xxxx
    connect outlook --email=x@outlook.com --password=xxxx

  App Credentials:
    connect dingtalk --clientId=x --clientSecret=x
    connect feishu --appId=x --appSecret=x
    connect qq --appId=x --appSecret=x

  iLink Token:
    connect wechat --token=x

  Browser Required (QR scan / interactive):
    connect whatsapp
    connect telegram (phone/qr/bot login)
    connect imessage

Examples:
  node alloomi-connectors.cjs list-platforms
  node alloomi-connectors.cjs list-accounts
  node alloomi-connectors.cjs status telegram
  node alloomi-connectors.cjs connect gmail --email=my@gmail.com --password=abcdefghijklnop
  node alloomi-connectors.cjs disconnect int_xxx
          `.trim()
        }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

main();
