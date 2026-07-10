import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenClawAgent } from "@/lib/ai/extensions/agent/openclaw";
import { buildOpenClawAcpCommand } from "@/lib/ai/extensions/agent/openclaw/command";
import type { AgentMessage } from "@openloomi/ai/agent/types";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("OpenClaw ACP runtime", () => {
  it("builds the documented openclaw acp bridge command", () => {
    expect(
      buildOpenClawAcpCommand({
        openclawPath: "openclaw-bin",
        gatewayUrl: "ws://127.0.0.1:18789",
        tokenFile: "/run/secrets/token",
        sessionLabel: "support inbox",
        resetSession: true,
        provenance: "meta",
      }),
    ).toEqual({
      command: "openclaw-bin",
      args: [
        "acp",
        "--url",
        "ws://127.0.0.1:18789",
        "--token-file",
        "/run/secrets/token",
        "--session-label",
        "support inbox",
        "--reset-session",
        "--provenance",
        "meta",
      ],
    });
  });

  it("runs initialize, session/new, and prompt through the shared ACP layer", async () => {
    const workDir = await createFakeOpenClawWorkDir();
    const agent = new OpenClawAgent({
      provider: "openclaw",
      workDir,
      providerConfig: {
        openclawPath: process.execPath,
        gatewayUrl: "ws://127.0.0.1:18789",
        session: "agent:main:main",
      },
    });

    const messages = await collectMessages(
      agent.run("hello gateway", {
        conversation: [
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
        ],
        images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
      }),
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session" }),
        expect.objectContaining({ type: "text", content: "from openclaw" }),
        expect.objectContaining({ type: "result", content: "end_turn" }),
        expect.objectContaining({ type: "done" }),
      ]),
    );
    expect(
      JSON.parse(await readFile(join(workDir, "args.json"), "utf8")),
    ).toEqual([
      "--url",
      "ws://127.0.0.1:18789",
      "--session",
      "agent:main:main",
    ]);
    const prompt = JSON.parse(
      await readFile(join(workDir, "prompt.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(prompt[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("earlier question"),
    });
    expect(prompt[0]?.text).toEqual(expect.stringContaining("hello gateway"));
    expect(prompt[1]).toEqual({
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
    });
  });

  it("reports an OpenClaw-specific executable error", async () => {
    const agent = new OpenClawAgent({
      provider: "openclaw",
      providerConfig: { openclawPath: "missing-openloomi-openclaw" },
    });

    const messages = await collectMessages(agent.run("hello"));

    expect(messages.find((message) => message.type === "error")).toMatchObject({
      message: expect.stringContaining("OpenClaw ACP executable not found"),
    });
  });
});

async function createFakeOpenClawWorkDir(): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "openloomi-openclaw-test-"));
  tempDirs.push(workDir);
  await writeFile(
    join(workDir, "acp"),
    `
const fs = require("node:fs");
const readline = require("node:readline");
fs.writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
function send(value) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion } });
  } else if (message.method === "session/new") {
    send({ id: message.id, result: { sessionId: "openclaw-session-1" } });
  } else if (message.method === "session/prompt") {
    fs.writeFileSync("prompt.json", JSON.stringify(message.params.prompt));
    send({
      method: "session/update",
      params: {
        sessionId: "openclaw-session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "from openclaw" }
        }
      }
    });
    send({ id: message.id, result: { stopReason: "end_turn" } });
  }
});
rl.on("close", () => process.exit(0));
`,
    "utf8",
  );
  return workDir;
}

async function collectMessages(
  generator: AsyncGenerator<AgentMessage>,
): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  for await (const message of generator) messages.push(message);
  return messages;
}
