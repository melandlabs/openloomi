---
title: Direct Tool Execution for Applications
impact: HIGH
description: Core patterns for manually executing Composio tools in applications without agent frameworks
tags: [tools, execute, execution, apps, manual]
---

# Direct Tool Execution for Applications

When building applications without agent frameworks, use `composio.tools.execute()` to manually execute tools.

## Basic Execution

```typescript
// Execute with a specific version (REQUIRED)
const result = await composio.tools.execute('GITHUB_GET_ISSUES', {
  userId: 'default',
  arguments: { owner: 'composio', repo: 'sdk' },
  version: '12082025_00', // Specific version required
});
```

## Discovering Available Tools

> **⚠️ IMPORTANT:** Do NOT make up or guess tool or toolkit names/versions. Always verify slugs before using them:
> - Use `composio manage tools list --toolkits "..."` to discover and `composio manage tools info "..."` to view tool schema (CLI)
> - Use `composio.tools.get()` to discover available tools programmatically (SDK)
>
> See [Composio CLI Reference](./composio-cli.md) for discovery commands.

```typescript
// Get all available tools in a toolkit
const githubTools = await composio.tools.get('default', {
  toolkits: ['github'],
  limit: 100 // Set appropriate limit
});

console.log('Available GitHub tools:', githubTools.map(t => t.name));
```

```python
# Get all available tools in a toolkit
github_tools = composio.tools.get(
    user_id="default",
    toolkits=["github"],
    limit=100  # Set appropriate limit
)

print("Available GitHub tools:", [t.name for t in github_tools])
```

## Version Management

**CRITICAL**: When manually executing tools (especially in workflows), a **specific version is required**. Using `'latest'` will throw an error.

**How to discover available versions:**
Use `composio.toolkits.get()` to see available versions for a toolkit:

```typescript
// Get toolkit information to see available versions
const githubToolkit = await composio.toolkits.get('github');
console.log('Available versions:', githubToolkit.versions);
// e.g., ["12082025_00", "10082025_01", "08082025_00"]
console.log('Current version:', githubToolkit.version); // e.g., "12082025_00"

// ✅ DO: Pin to a specific version string for stability
const result = await composio.tools.execute('GITHUB_GET_ISSUES', {
  userId: 'user_123',
  arguments: { owner: 'composio', repo: 'sdk' },
  version: '12082025_00', // Pinned version string
});
```

```python
# Get toolkit information to see available versions
github_toolkit = composio.toolkits.get("github")
print(f"Available versions: {github_toolkit.versions}")
# e.g., ["12082025_00", "10082025_01", "08082025_00"]
print(f"Current version: {github_toolkit.version}")  # e.g., "12082025_00"

# ✅ DO: Pin to a specific version string for stability
result = composio.tools.execute(
    tool="GITHUB_GET_ISSUES",
    user_id="user_123",
    arguments={"owner": "composio", "repo": "sdk"},
    version="12082025_00"  # Pinned version string
)
```

**Why version pinning is required:**
- Tool argument schemas can change between versions
- Using `'latest'` in workflows can cause runtime errors when tools are updated
- Pinned versions ensure workflow stability and predictability
- Version validation prevents production issues from schema mismatches
- **Don't use `githubToolkit.version` dynamically** - this always returns the latest version, defeating the purpose of pinning

See [Tool Version Management](app-tool-versions.md) for detailed version strategies.

## Parameters

### ExecuteParams Object

```typescript
{
  userId: string,           // User ID for connected account lookup
  arguments: object,        // Tool-specific input parameters
  version?: string,         // Toolkit version (required for manual execution)
  dangerouslySkipVersionCheck?: boolean  // Bypass version validation (NOT recommended)
}
```

### Execution Modifiers

Transform requests and responses with modifiers:

```typescript
const result = await composio.tools.execute(
  'GITHUB_GET_ISSUES',
  {
    userId: 'default',
    arguments: { owner: 'composio', repo: 'sdk' },
    version: '12082025_00',
  },
  {
    beforeExecute: ({ toolSlug, toolkitSlug, params }) => {
      // Modify params before execution
      console.log('Executing:', toolSlug);
      return {
        ...params,
        arguments: {
          ...params.arguments,
          per_page: 100 // Add default parameter
        }
      };
    },
    afterExecute: ({ toolSlug, toolkitSlug, result }) => {
      // Transform result after execution
      console.log('Completed:', toolSlug);
      return {
        ...result,
        timestamp: new Date().toISOString()
      };
    },
  }
);
```

## Response Format

```typescript
interface ToolExecuteResponse {
  data: any;           // Tool-specific response data
  error: string | null;  // Error message if execution failed
  successful: boolean;   // Whether execution succeeded
}
```

## Error Handling

```typescript
try {
  const result = await composio.tools.execute('GITHUB_GET_ISSUES', {
    userId: 'user_123',
    arguments: { owner: 'composio', repo: 'sdk' },
    version: '12082025_00',
  });

  if (!result.successful) {
    console.error('Tool execution failed:', result.error);
    // Handle error case
    return;
  }

  // Process successful result
  console.log('Issues:', result.data);
} catch (error) {
  if (error.name === 'ComposioToolNotFoundError') {
    console.error('Tool not found');
  } else if (error.name === 'ComposioToolExecutionError') {
    console.error('Execution error:', error.message);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Common Error Types

- `ComposioCustomToolsNotInitializedError`: Custom tools instance not initialized
- `ComposioToolNotFoundError`: Tool with the given slug not found
- `ComposioToolExecutionError`: Error during tool execution
- Version validation errors: Thrown when version is missing or `'latest'` is used

## Best Practices

1. **Always specify versions**: Use explicit versions or configure at initialization
2. **Handle errors gracefully**: Check `successful` flag and handle `error` field
3. **Validate arguments**: Ensure all required parameters are provided
4. **Use modifiers sparingly**: Only add modifiers when necessary for transformation
5. **Log execution details**: Track which tools are executed for debugging
6. **Test with real data**: Validate execution with actual connected accounts
7. **Handle authentication errors**: User may not have connected account for toolkit