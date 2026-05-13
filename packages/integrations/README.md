# @openloomi/integrations

Unified package for openloomi integration packages.

## Packages

This umbrella package exports the following integration packages:

- `@openloomi/integrations/asana` - Asana task integration
- `@openloomi/integrations/calendar` - Google Calendar and Outlook Calendar adapters
- `@openloomi/integrations/channels` - Message platform adapters (Slack, Discord, Telegram, etc.)
- `@openloomi/integrations/hubspot` - HubSpot CRM integration
- `@openloomi/integrations/imessage` - macOS iMessage adapter

## Usage

```typescript
// Import from umbrella package
import { AsanaClient } from "@openloomi/integrations/asana";
import { GoogleCalendarAdapter } from "@openloomi/integrations/calendar";
import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import { HubspotClient } from "@openloomi/integrations/hubspot";
import { IMessageAdapter } from "@openloomi/integrations/imessage";

// Or import specific sub-paths
import type { Platform } from "@openloomi/integrations/channels/sources/types";
```

## Architecture

Each integration package is self-contained with its own `package.json` and `tsconfig.json`. The umbrella package (`@openloomi/integrations`) re-exports all packages through sub-path exports, allowing consumers to import from a single package while maintaining package separation.
