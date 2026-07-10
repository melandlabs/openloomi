---
title: Fetching Tools for Applications
impact: HIGH
description: Essential patterns for discovering and retrieving tools from Composio for direct execution in applications
tags: [tools, fetch, discovery, apps, providers]
---

# Fetching Tools for Applications

When building applications (non-agent workflows), use direct tool fetching methods to discover and retrieve tools from Composio.

> **⚠️ IMPORTANT:** Do NOT make up or guess tool or toolkit names. Always verify slugs before using them:
> - Use `composio manage toolkits list` / `composio manage toolkits info "..."` and `composio manage tools list --toolkits "..."` / `composio manage tools info "..."` (CLI)
> - Use `composio.tools.get()` to discover available tools programmatically (SDK)
>
> See [Composio CLI Reference](./composio-cli.md) for discovery commands.

## Methods Overview

- **`tools.get()`** - Use when working with a provider (OpenAI, Vercel, etc.). Returns tools wrapped in provider-specific format.
- **`tools.getRawComposioTools()`** - Use for standalone applications and building UIs. Returns raw tool metadata without provider wrapping.

### 1. tools.get() - For Provider-Based Applications

Use `tools.get()` when you're using Composio with a provider like OpenAI, Vercel AI SDK, or LangChain. This method wraps tools in the format expected by your provider.

**Get tools from a toolkit:**
```typescript
// Get important tools only (auto-applies important filter)
const importantGithubTools = await composio.tools.get('default', {
  toolkits: ['github']
});

// Get a limited number of tools (does NOT auto-apply important filter)
const githubTools = await composio.tools.get('default', {
  toolkits: ['github'],
  limit: 10
});
```

**Get a specific tool by slug:**
```typescript
const tool = await composio.tools.get('default', 'GITHUB_GET_REPO');
```

### 2. tools.getRawComposioTools() - For Standalone Applications & UIs

Use `getRawComposioTools()` for standalone applications and building UIs. This method returns raw tool metadata without provider-specific wrapping, making it ideal for:
- Building tool selection UIs
- Creating tool catalogs or documentation
- Direct tool execution workflows (without providers)
- Custom tool management interfaces

```typescript
// Get important tools (auto-applies important filter)
const importantTools = await composio.tools.getRawComposioTools({
  toolkits: ['github']
});

// Get specific tools by slug
const specificTools = await composio.tools.getRawComposioTools({
  tools: ['GITHUB_GET_REPOS', 'SLACK_SEND_MESSAGE']
});

// Get limited tools (does NOT auto-apply important)
const limitedTools = await composio.tools.getRawComposioTools({
  toolkits: ['slack'],
  limit: 5
});
```

## Important Filter Behavior

The `important` filter auto-applies to show only the most commonly used tools.

**Auto-applies when:**
- Only `toolkits` filter is provided (no other filters)

**Does NOT auto-apply when:**
- `limit` is specified
- `search` is used
- `tools` (specific slugs) are provided
- `tags` are specified
- `important` is explicitly set to `false`

```typescript
// Auto-applies important=true
await composio.tools.get('default', { toolkits: ['github'] });

// Does NOT auto-apply important (limit specified)
await composio.tools.get('default', { toolkits: ['github'], limit: 10 });

// Does NOT auto-apply important (search used)
await composio.tools.get('default', { search: 'repo' });

// Explicitly disable important filter
await composio.tools.get('default', { toolkits: ['github'], important: false });
```

## Filter Parameters

Available filters for both `tools.get()` and `tools.getRawComposioTools()`:

- `toolkits`: Array of toolkit names (e.g., `['github', 'slack']`)
- `tools`: Array of specific tool slugs (e.g., `['GITHUB_GET_REPO']`)
- `search`: Search string for tool names/descriptions
- `limit`: Maximum number of tools to return
- `tags`: Array of tags to filter by
- `scopes`: Array of scopes to filter by
- `authConfigIds`: Array of auth config IDs to filter tools by specific auth configs
- `important`: Boolean to explicitly control important filter (auto-applies in some cases)

**Note:** You cannot use `tools` and `toolkits` filters together.

## Schema Modification

Customize tool schemas at fetch time:

```typescript
const customizedTools = await composio.tools.get('default', {
  toolkits: ['github']
}, {
  modifySchema: ({ toolSlug, toolkitSlug, schema }) => {
    return { ...schema, description: 'Custom description' };
  }
});
```

## Best Practices

1. **Choose the right method:**
   - Use `tools.get()` when working with providers (OpenAI, Vercel, LangChain)
   - Use `tools.getRawComposioTools()` for standalone apps, UIs, and catalogs

2. **Use important filter for UIs**: Show important tools first, then allow users to discover all tools

3. **Cache tool metadata**: Tools don't change frequently, cache the results

4. **Filter by toolkit**: Group tools by toolkit for better organization

5. **Don't mix tools and toolkits filters**: Cannot use both filters together

## Complete Discovery Workflow

Here's the recommended workflow for discovering and using tools:

```typescript
// Step 1: Get toolkit information (to discover available versions)
const githubToolkit = await composio.toolkits.get('github');
console.log('Toolkit:', githubToolkit.name);
console.log('Available versions:', githubToolkit.versions);
console.log('Current version:', githubToolkit.version);
console.log('Description:', githubToolkit.description);

// Step 2: Discover all available tools in the toolkit
const allGithubTools = await composio.tools.get('default', {
  toolkits: ['github'],
  limit: 100 // Adjust based on your needs
});

console.log('\nAvailable tools:');
allGithubTools.forEach(tool => {
  console.log(`- ${tool.name}: ${tool.description}`);
});

// Step 3: Find the tool you need
const repoTool = allGithubTools.find(t => t.name === 'GITHUB_GET_REPO');
if (!repoTool) {
  throw new Error('Tool not found');
}

// Step 4: Execute the tool with a pinned version string
const result = await composio.tools.execute('GITHUB_GET_REPO', {
  userId: 'user_123',
  arguments: { owner: 'composio', repo: 'sdk' },
  version: '12082025_00' // ✅ Pinned version string for stability
});
```

```python
# Step 1: Get toolkit information (to discover available versions)
github_toolkit = composio.toolkits.get("github")
print(f"Toolkit: {github_toolkit.name}")
print(f"Available versions: {github_toolkit.versions}")
print(f"Current version: {github_toolkit.version}")
print(f"Description: {github_toolkit.description}")

# Step 2: Discover all available tools in the toolkit
all_github_tools = composio.tools.get(
    user_id="default",
    toolkits=["github"],
    limit=100  # Adjust based on your needs
)

print("\nAvailable tools:")
for tool in all_github_tools:
    print(f"- {tool.name}: {tool.description}")

# Step 3: Find the tool you need
repo_tool = next((t for t in all_github_tools if t.name == "GITHUB_GET_REPO"), None)
if not repo_tool:
    raise Exception("Tool not found")

# Step 4: Execute the tool with a pinned version string
result = composio.tools.execute(
    tool="GITHUB_GET_REPO",
    user_id="user_123",
    arguments={"owner": "composio", "repo": "sdk"},
    version="12082025_00"  # ✅ Pinned version string for stability
)
```

## ❌ Common Mistakes

```typescript
// DON'T: Guess or make up tool names
const result = await composio.tools.execute('GITHUB_GET_REPOSITORY', { // ❌ Wrong name
  userId: 'user_123',
  arguments: { repo: 'sdk' },
  version: '12082025_00'
});

// DON'T: Use hardcoded versions without checking
const result = await composio.tools.execute('GITHUB_GET_REPO', {
  userId: 'user_123',
  arguments: { owner: 'composio', repo: 'sdk' },
  version: '12082025_00' // ❌ This might be outdated, use `composio manage toolkits info "github"` to get the latest version
});
```

```python
# DON'T: Guess or make up tool names
result = composio.tools.execute(
    tool="GITHUB_GET_REPOSITORY",  # ❌ Wrong name
    user_id="user_123",
    arguments={"repo": "sdk"},
    version="12082025_00"
)

# DON'T: Use hardcoded versions without checking
result = composio.tools.execute(
    tool="GITHUB_GET_REPO",
    user_id="user_123",
    arguments={"owner": "composio", "repo": "sdk"},
    version="12082025_00"  # ❌ This might be outdated
)
```

## ✅ Best Practices

```typescript
// DO: Discover available versions and tools first
const toolkit = await composio.toolkits.get('github');
console.log('Available versions:', toolkit.versions);

const tools = await composio.tools.get('default', {
  toolkits: ['github'],
  limit: 100
});

// DO: Use discovered tool names and pin to a specific version string
const toolName = tools.find(t => t.description.includes('repository'))?.name;
if (toolName) {
  const result = await composio.tools.execute(toolName, {
    userId: 'user_123',
    arguments: { owner: 'composio', repo: 'sdk' },
    version: '12082025_00' // ✅ Pinned version string for stability
  });
}
```

```python
# DO: Discover available versions and tools first
toolkit = composio.toolkits.get("github")
print(f"Available versions: {toolkit.versions}")

tools = composio.tools.get(
    user_id="default",
    toolkits=["github"],
    limit=100
)

# DO: Use discovered tool names and pin to a specific version string
tool_name = next((t.name for t in tools if "repository" in t.description), None)
if tool_name:
    result = composio.tools.execute(
        tool=tool_name,
        user_id="user_123",
        arguments={"owner": "composio", "repo": "sdk"},
        version="12082025_00"  # ✅ Pinned version string for stability
    )
```
