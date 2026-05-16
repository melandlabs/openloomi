// vite.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: [
      // Specific paths first (higher priority)
      {
        find: "@openloomi/shared/errors",
        replacement: alias("../../packages/shared/src/errors.ts"),
      },
      {
        find: "@openloomi/security/token-encryption",
        replacement: alias("../../packages/security/src/token-encryption.ts"),
      },
      {
        find: "@openloomi/security/url-validator",
        replacement: alias("../../packages/security/src/url-validator.ts"),
      },
      // agent subpaths - must be before the shorter @openloomi/agent alias
      {
        find: "@openloomi/agent/types",
        replacement: alias("../../packages/ai/src/agent/types.ts"),
      },
      {
        find: "@openloomi/agent/registry",
        replacement: alias("../../packages/ai/src/agent/registry.ts"),
      },
      {
        find: "@openloomi/agent/sandbox",
        replacement: alias("../../packages/ai/src/agent/sandbox/index.ts"),
      },
      {
        find: "@openloomi/agent/plugin",
        replacement: alias("../../packages/ai/src/agent/plugin.ts"),
      },
      {
        find: "@openloomi/agent/base",
        replacement: alias("../../packages/ai/src/agent/base.ts"),
      },
      // agent/ai subpaths - must be before the shorter @openloomi/agent/ai alias
      {
        find: "@openloomi/agent/ai/request-context",
        replacement: alias("../../packages/ai/src/agent/ai/request-context.ts"),
      },
      {
        find: "@openloomi/agent/ai/providers",
        replacement: alias("../../packages/ai/src/agent/ai/providers.ts"),
      },
      {
        find: "@openloomi/agent/ai/router",
        replacement: alias("../../packages/ai/src/agent/ai/router.ts"),
      },
      {
        find: "@openloomi/agent/ai/tokens",
        replacement: alias("../../packages/ai/src/agent/ai/tokens.ts"),
      },
      {
        find: "@openloomi/agent/ai/*",
        replacement: alias("../../packages/ai/src/agent/ai/*"),
      },
      {
        find: "@openloomi/agent/ai",
        replacement: alias("../../packages/ai/src/agent/ai/index.ts"),
      },
      // @openloomi/ai/agent subpaths - must be before @openloomi/ai/*
      {
        find: "@openloomi/ai/agent/context",
        replacement: alias("../../packages/ai/src/agent/context"),
      },
      {
        find: "@openloomi/ai/agent/compaction",
        replacement: alias("../../packages/ai/src/agent/compaction"),
      },
      {
        find: "@openloomi/ai/agent/registry",
        replacement: alias("../../packages/ai/src/agent/registry"),
      },
      {
        find: "@openloomi/ai/agent/billing",
        replacement: alias("../../packages/ai/src/agent/billing"),
      },
      {
        find: "@openloomi/ai/agent/model",
        replacement: alias("../../packages/ai/src/agent/model"),
      },
      {
        find: "@openloomi/ai/agent/routing",
        replacement: alias("../../packages/ai/src/agent/routing"),
      },
      {
        find: "@openloomi/ai/agent/sandbox",
        replacement: alias("../../packages/ai/src/agent/sandbox"),
      },
      {
        find: "@openloomi/ai/agent/plugin",
        replacement: alias("../../packages/ai/src/agent/plugin.ts"),
      },
      {
        find: "@openloomi/ai/agent/types",
        replacement: alias("../../packages/ai/src/agent/types.ts"),
      },
      {
        find: "@openloomi/ai/agent/*",
        replacement: alias("../../packages/ai/src/agent/*"),
      },
      {
        find: "@openloomi/ai/agent",
        replacement: alias("../../packages/ai/src/agent/index.ts"),
      },
      // @openloomi/ai subpaths - store and memory
      {
        find: "@openloomi/ai/store",
        replacement: alias("../../packages/ai/src/store/index.ts"),
      },
      {
        find: "@openloomi/ai/memory",
        replacement: alias("../../packages/ai/src/memory/index.ts"),
      },
      // @openloomi/ai/* wildcard - matches single segment subpaths
      {
        find: "@openloomi/ai/*",
        replacement: alias("../../packages/ai/src/*"),
      },
      {
        find: "@openloomi/ai",
        replacement: alias("../../packages/ai/src/index.ts"),
      },
      {
        find: "@openloomi/audit",
        replacement: alias("../../packages/audit/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/channels/sources/types",
        replacement: alias(
          "../../packages/integrations/channels/src/sources/types.ts",
        ),
      },
      // Package roots
      {
        find: "@openloomi/mcp",
        replacement: alias("../../packages/ai/mcp/src/index.ts"),
      },
      // rag subpaths - must be before the shorter @openloomi/rag alias
      {
        find: "@openloomi/rag/universal-embeddings",
        replacement: alias("../../packages/ai/rag/src/universal-embeddings.ts"),
      },
      {
        find: "@openloomi/rag/*",
        replacement: alias("../../packages/ai/rag/src/*"),
      },
      {
        find: "@openloomi/rag",
        replacement: alias("../../packages/ai/rag/src/index.ts"),
      },
      // i18n subpaths - must be before the shorter @openloomi/i18n alias
      {
        find: "@openloomi/i18n/locales",
        replacement: alias("../../packages/i18n/src/locales"),
      },
      {
        find: "@openloomi/i18n/*",
        replacement: alias("../../packages/i18n/src/*"),
      },
      {
        find: "@openloomi/i18n",
        replacement: alias("../../packages/i18n/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/calendar",
        replacement: alias("../../packages/integrations/calendar/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/calendar/*",
        replacement: alias("../../packages/integrations/calendar/src/*"),
      },
      {
        find: "@openloomi/integrations/hubspot",
        replacement: alias("../../packages/integrations/hubspot/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/hubspot/*",
        replacement: alias("../../packages/integrations/hubspot/src/*"),
      },
      {
        find: "@openloomi/indexeddb/extractor",
        replacement: alias("../../packages/indexeddb/src/extractor.ts"),
      },
      {
        find: "@openloomi/indexeddb/*",
        replacement: alias("../../packages/indexeddb/src/*"),
      },
      {
        find: "@openloomi/indexeddb",
        replacement: alias("../../packages/indexeddb/src/index.ts"),
      },
      {
        find: "@openloomi/sqlite/*",
        replacement: alias("../../packages/sqlite/src/*"),
      },
      {
        find: "@openloomi/sqlite",
        replacement: alias("../../packages/sqlite/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/imessage",
        replacement: alias("../../packages/integrations/imessage/src/index.ts"),
      },
      {
        find: "@openloomi/shared/errors",
        replacement: alias("../../packages/shared/src/errors.ts"),
      },
      {
        find: "@openloomi/shared/ref",
        replacement: alias("../../packages/shared/src/ref.ts"),
      },
      {
        find: "@openloomi/shared/utils",
        replacement: alias("../../packages/shared/src/utils.ts"),
      },
      {
        find: "@openloomi/shared/soul",
        replacement: alias("../../packages/shared/src/soul.ts"),
      },
      {
        find: "@openloomi/shared/*",
        replacement: alias("../../packages/shared/src/*"),
      },
      {
        find: "@openloomi/shared",
        replacement: alias("../../packages/shared/src/index.ts"),
      },
      {
        find: "@openloomi/security/key-manager",
        replacement: alias("../../packages/security/src/key-manager.ts"),
      },
      {
        find: "@openloomi/security",
        replacement: alias("../../packages/security/src/index.ts"),
      },
      {
        find: "@openloomi/storage/adapters",
        replacement: alias("../../packages/storage/src/adapters"),
      },
      {
        find: "@openloomi/storage/adapters/local-fs",
        replacement: alias("../../packages/storage/src/adapters/local-fs.ts"),
      },
      {
        find: "@openloomi/storage/adapters/vercel-blob",
        replacement: alias(
          "../../packages/storage/src/adapters/vercel-blob.ts",
        ),
      },
      {
        find: "@openloomi/storage/*",
        replacement: alias("../../packages/storage/src/*"),
      },
      {
        find: "@openloomi/storage",
        replacement: alias("../../packages/storage/src/local.ts"),
      },
      {
        find: "@openloomi/integrations/channels",
        replacement: alias("../../packages/integrations/channels/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/contacts",
        replacement: alias("../../packages/integrations/src/contacts.ts"),
      },
      // Telegram integrations (specific paths first, then general)
      {
        find: "@openloomi/integrations/telegram/adapter",
        replacement: alias(
          "../../packages/integrations/telegram/src/adapter.ts",
        ),
      },
      {
        find: "@openloomi/integrations/telegram/markdown",
        replacement: alias(
          "../../packages/integrations/telegram/src/markdown.ts",
        ),
      },
      {
        find: "@openloomi/integrations/telegram/conversation-store",
        replacement: alias(
          "../../packages/integrations/telegram/src/conversation-store.ts",
        ),
      },
      {
        find: "@openloomi/integrations/telegram/tdata-decrypter",
        replacement: alias(
          "../../packages/integrations/telegram/src/tdata-decrypter/index.ts",
        ),
      },
      {
        find: "@openloomi/integrations/telegram/tdata-converter",
        replacement: alias(
          "../../packages/integrations/telegram/src/tdata-converter.ts",
        ),
      },
      {
        find: "@openloomi/integrations/telegram",
        replacement: alias("../../packages/integrations/telegram/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/whatsapp/adapter",
        replacement: alias(
          "../../packages/integrations/whatsapp/src/adapter.ts",
        ),
      },
      {
        find: "@openloomi/integrations/whatsapp/client-registry",
        replacement: alias(
          "../../packages/integrations/whatsapp/src/client-registry.ts",
        ),
      },
      {
        find: "@openloomi/integrations/whatsapp/conversation-store",
        replacement: alias(
          "../../packages/integrations/whatsapp/src/conversation-store.ts",
        ),
      },
      {
        find: "@openloomi/integrations/whatsapp/markdown",
        replacement: alias(
          "../../packages/integrations/whatsapp/src/markdown.ts",
        ),
      },
      {
        find: "@openloomi/integrations/whatsapp",
        replacement: alias("../../packages/integrations/whatsapp/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/asana",
        replacement: alias("../../packages/integrations/asana/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/dingtalk",
        replacement: alias("../../packages/integrations/dingtalk/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/facebook-messenger",
        replacement: alias(
          "../../packages/integrations/facebook-messenger/src/index.ts",
        ),
      },
      {
        find: "@openloomi/integrations/feishu",
        replacement: alias("../../packages/integrations/feishu/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/gmail",
        replacement: alias("../../packages/integrations/gmail/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/google-docs",
        replacement: alias(
          "../../packages/integrations/google-docs/src/index.ts",
        ),
      },
      {
        find: "@openloomi/integrations/instagram",
        replacement: alias(
          "../../packages/integrations/instagram/src/index.ts",
        ),
      },
      {
        find: "@openloomi/integrations/jira",
        replacement: alias("../../packages/integrations/jira/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/linkedin",
        replacement: alias("../../packages/integrations/linkedin/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/qqbot",
        replacement: alias("../../packages/integrations/qqbot/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/weixin/ilink-client",
        replacement: alias(
          "../../packages/integrations/weixin/src/ilink-client.ts",
        ),
      },
      {
        find: "@openloomi/integrations/weixin/conversation-store",
        replacement: alias(
          "../../packages/integrations/weixin/src/conversation-store.ts",
        ),
      },
      {
        find: "@openloomi/integrations/weixin/qr-login",
        replacement: alias(
          "../../packages/integrations/weixin/src/qr-login.ts",
        ),
      },
      {
        find: "@openloomi/integrations/weixin/ws-listener",
        replacement: alias(
          "../../packages/integrations/weixin/src/ws-listener.ts",
        ),
      },
      {
        find: "@openloomi/integrations/weixin",
        replacement: alias("../../packages/integrations/weixin/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/x",
        replacement: alias("../../packages/integrations/x/src/index.ts"),
      },
      {
        find: "@openloomi/integrations/utils",
        replacement: alias("../../packages/integrations/src/utils"),
      },
      {
        find: "@openloomi/integrations/core",
        replacement: alias("../../packages/integrations/src/core"),
      },
      {
        find: "@openloomi/integrations/*",
        replacement: alias("../../packages/integrations/src/*"),
      },
      {
        find: "@openloomi/integrations",
        replacement: alias("../../packages/integrations/src/index.ts"),
      },
      {
        find: "@openloomi/agent",
        replacement: alias("../../packages/ai/src/agent/index.ts"),
      },
      {
        find: "@openloomi/insights",
        replacement: alias("../../packages/insights/src/index.ts"),
      },
      {
        find: "@openloomi/rss",
        replacement: alias("../../packages/integrations/rss/src/index.ts"),
      },
      { find: "@", replacement: alias(".") },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    include: [
      "tests/unit/*.test.ts",
      "tests/api/*.test.ts",
      "tests/api/*.smoke.ts",
      "tests/benchmark/*.test.ts",
    ],
    exclude: ["node_modules", ".next", "out"],
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage/unit",
    },
  },
});
