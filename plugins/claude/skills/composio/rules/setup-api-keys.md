---
title: Setting Up API Keys for Your Project
impact: CRITICAL
description: Configure Composio, OpenAI, and Anthropic API keys to enable your AI agent projects
tags: [setup, api-keys, configuration, environment, composio, openai, anthropic]
---

# Setting Up API Keys for Your Project

Before building AI agents with Composio, you need to configure the necessary API keys. This includes Composio for tool access and your preferred LLM provider (OpenAI or Anthropic).

## Setting Up Composio API Key

### Step 1: Get Your Composio API Key

1. Visit [Composio Platform](https://platform.composio.dev)
2. Sign up or log in to your account
3. Select or create a project
4. Navigate to **Project Settings**
5. Switch to the **API Keys** tab
6. Copy your project-level API key

### Step 2: Add to Environment Variables

Create a `.env` file in your project root (if it doesn't exist) and add:

```bash
COMPOSIO_API_KEY=your_composio_api_key_here
```

## Setting Up LLM Provider API Keys

### OpenAI API Key

If you're using OpenAI models (GPT-4, GPT-4o, etc.):

1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Navigate to API Keys section
4. Create a new API key or copy an existing one
5. Add to your `.env` file:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### Anthropic API Key

If you're using Anthropic models (Claude, Claude Sonnet, etc.):

1. Visit [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Sign in or create an account
3. Navigate to API Keys section
4. Create a new API key or copy an existing one
5. Add to your `.env` file:

```bash
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

## ❌ Incorrect - Hardcoding API Keys

```typescript
// DON'T: Never hardcode API keys in your code
const composio = new Composio({
  apiKey: 'sk_composio_abc123xyz' // ❌ Security risk!
});

const openai = new OpenAI({
  apiKey: 'sk-proj-abc123' // ❌ Will be exposed in version control
});
```

```python
# DON'T: Never hardcode API keys
composio = Composio(api_key="sk_composio_abc123xyz")  # ❌ Security risk!

client = OpenAI(api_key="sk-proj-abc123")  # ❌ Will be exposed in version control
```

## ✅ Correct - Using Environment Variables

```typescript
// DO: Load API keys from environment variables
import { Composio } from '@composio/core';
import { OpenAI } from 'openai';

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY // ✅ Secure
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // ✅ Secure
});
```

```python
# DO: Load API keys from environment variables
import os
from composio import Composio
from openai import OpenAI

composio = Composio(api_key=os.environ["COMPOSIO_API_KEY"])  # ✅ Secure

openai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])  # ✅ Secure
```

## Complete .env File Example

```bash
# Composio Configuration
COMPOSIO_API_KEY=your_composio_api_key_here

# LLM Provider (choose one or both based on your needs)
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Optional: Other configurations
NODE_ENV=development
PORT=3000
```

## Loading Environment Variables

### Node.js / TypeScript

Install `dotenv`:

```bash
npm install dotenv
```

Load at the top of your entry file:

```typescript
import 'dotenv/config';
// Or
require('dotenv').config();
```

### Python

Install `python-dotenv`:

```bash
pip install python-dotenv
```

Load in your code:

```python
from dotenv import load_dotenv
load_dotenv()
```

## Security Best Practices

1. **Never commit `.env` files** - Add `.env` to your `.gitignore`:
   ```
   # .gitignore
   .env
   .env.local
   .env.*.local
   ```

2. **Use different keys for different environments** - Create separate API keys for development, staging, and production

3. **Rotate keys regularly** - Periodically regenerate API keys for security

4. **Restrict key permissions** - Use the minimum required permissions for each API key

5. **Use secret management in production** - Consider using services like:
   - AWS Secrets Manager
   - Google Cloud Secret Manager
   - HashiCorp Vault
   - Vercel Environment Variables
   - Railway Environment Variables

## Verifying Your Setup

After setting up your API keys, verify they work:

```typescript
import { Composio } from '@composio/core';

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY
});

// Test the connection
const apps = await composio.apps.list();
console.log('✅ Composio API key is working!');
```

```python
from composio import Composio

composio = Composio(api_key=os.environ["COMPOSIO_API_KEY"])

# Test the connection
apps = composio.apps.list()
print("✅ Composio API key is working!")
```

## Troubleshooting

### "API key not found" error

- Ensure your `.env` file is in the project root
- Verify you're loading environment variables before using them
- Check for typos in variable names (`COMPOSIO_API_KEY`, not `COMPOSIO_KEY`)

### "Invalid API key" error

- Verify you copied the complete API key
- Check that you're using a project-level API key from Composio
- Ensure the key hasn't been revoked or expired

### Environment variables not loading

- Restart your development server after modifying `.env`
- Ensure `dotenv` is installed and configured correctly
- Check that `.env` is in the correct directory

## Reference

- [Composio Platform](https://platform.composio.dev)
- [OpenAI API Keys](https://platform.openai.com/api-keys)
- [Anthropic Console](https://console.anthropic.com/settings/keys)
- [Composio Documentation](https://docs.composio.dev)
