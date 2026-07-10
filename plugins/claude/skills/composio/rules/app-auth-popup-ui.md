---
title: Building Popup Connection UI
impact: MEDIUM
description: Build a popup-based Composio auth-link UI with dedicated callback page handling and parent-window polling
tags: [connected-accounts, auth-link, popup, callback-page, ui]
---

# Building Popup Connection UI

Use this pattern when you want to open Composio auth links in a popup window and handle completion in the parent window.

> This is a **general Composio auth link handler**, not an OAuth-only pattern. It works for any Composio hosted auth link that redirects back with URL params.

## Flow Overview

1. Parent app requests a Composio auth link (`redirectUrl`)
2. Parent opens popup with that `redirectUrl`
3. Popup completes auth and lands on a dedicated callback page in your app
4. Parent polls popup URL, detects success/error params, closes popup, resolves state

## Why Use a Dedicated Callback Page

Always route popup completion to a dedicated page like `/auth/composio/callback` to:
- show clear success/failure states
- provide a stable URL shape for parameter parsing
- prevent exposing auth-link query params in unrelated pages
- keep popup close/cleanup logic predictable

## Parent Window Handler

Use a helper that opens the popup, polls URL params, and closes automatically when done:

```typescript
export const initiateComposioAuthFlow = (
  url: string,
  successParam: string = 'status'
): Promise<Record<string, string>> => {
  const width = 600;
  const height = 840;
  const leftPosition = (window.innerWidth - width) / 2;
  const topPosition = (window.innerHeight - height) / 2;

  return new Promise((resolve, reject) => {
    const popup = window.open(
      url,
      'composio-auth-popup',
      `width=${width},height=${height},left=${leftPosition},top=${topPosition}`
    );

    if (!popup) {
      reject(new Error('Popup blocked by browser'));
      return;
    }

    popup.focus();

    const popupChecker = setInterval(() => {
      if (popup.closed) {
        clearInterval(popupChecker);
        reject(new Error('Popup closed before completion'));
        return;
      }

      let popupUrl: URL | null = null;
      try {
        popupUrl = new URL(popup.location.href);
      } catch {
        // Cross-origin while Composio page is open; ignore until redirected back to your domain.
      }

      if (!popupUrl) {
        return;
      }

      const successValue = popupUrl.searchParams.get(successParam);
      const errorValue = popupUrl.searchParams.get('error');

      if (errorValue) {
        clearInterval(popupChecker);
        popup.close();
        reject(new Error(String(errorValue)));
        return;
      }

      if (successValue !== null) {
        const allParams: Record<string, string> = {};
        popupUrl.searchParams.forEach((value, key) => {
          allParams[key] = value;
        });

        clearInterval(popupChecker);
        popup.close();
        resolve(allParams);
      }
    }, 500);
  });
};
```

## Dedicated Callback Page

Create a small callback page in your app to handle the end state:
- show "Connection successful" or "Connection failed"
- optionally show a "You can close this window" fallback
- keep query params intact so parent polling can read them

Example route path:
- `https://your-app.com/auth/composio/callback`

## Example Integration with `connectedAccounts.link()` or `session.authorize()`

```typescript
// in the backend
const connectionRequest = await composio.connectedAccounts.link(
  userId,
  authConfigId,
  { callbackUrl: 'https://your-app.com/auth/composio/callback' }
);

// in the frontend
const params = await initiateComposioAuthFlow(
  connectionRequest.redirectUrl,
  'status'
);
```

You can also destructure all returned query params directly:

```typescript
const { status, connected_account_id } = await initiateComposioAuthFlow(
  authLink,
  'status'
);
```

## Best Practices

- Use popup only on user gesture (`onClick`) to avoid popup blockers
- Keep polling interval small (`300-700ms`) for responsive close
- Capture both success and error query params
- Always clear interval on every exit path
- Reject immediately if popup cannot be opened
- Use a stable callback URL path across environments

