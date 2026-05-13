import fs from "node:fs/promises";
import path from "node:path";
import {
  appendInsightsByBotId,
  bulkUpsertContacts,
  createBot,
  deleteAllBotsByUserId,
  deleteAllUserContacts,
  deleteInsightsByIds,
  getBotsByUserId,
  getIntegrationAccountsByUserId,
  getStoredInsightsByBotIds,
  getUser,
  getUserContacts,
  upsertIntegrationAccount,
} from "./queries";
import type { Insight, UserContact } from "./schema";
import { config } from "dotenv";
import { timeBeforeHours } from "@openloomi/shared";
import type { DetailData } from "../ai/subagents/insights";

config({
  path: ".env",
});

const runDump = async () => {
  console.log("⏳ Running dump...");
  const start = Date.now();
  await cloneUserData("test123@test.io", "mock-data/user-mock-data.json");
  await cloneUserData("test123-en@test.io", "mock-data/user-mock-data-en.json");
  const end = Date.now();
  console.log("✅ Dump completed in", end - start, "ms");
  process.exit(0);
};

runDump().catch((err) => {
  console.error("❌ Dump failed");
  console.error(err);
  process.exit(1);
});

export async function dumpUserData(email: string, saveToFile = true) {
  try {
    const [user] = await getUser(email);
    const { bots } = await getBotsByUserId({
      id: user.id,
      limit: null,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: true,
    });
    const accounts = await getIntegrationAccountsByUserId({ userId: user.id });
    const insights = await getStoredInsightsByBotIds({
      ids: bots.map((b) => b.id),
    });
    const contacts = await getUserContacts(user.id);

    const dumpData = {
      user,
      bots,
      accounts,
      insights,
      contacts,
    };

    if (saveToFile) {
      const dumpDir = path.resolve(process.cwd(), "user-dumps");
      await fs.mkdir(dumpDir, { recursive: true });
      const dumpFilePath = path.join(
        dumpDir,
        `user-${email}-${Date.now()}.json`,
      );
      await fs.writeFile(dumpFilePath, JSON.stringify(dumpData, null, 2));
    }

    console.log(`Dump [${email}] finished`);
    return dumpData;
  } catch (error) {
    console.error(`Dump Error：`, error);
    throw error;
  }
}

export async function cloneUserData(email: string, file: string) {
  const [user] = await getUser(email);
  const content = await fs.readFile(file);
  const data = JSON.parse(content.toString());

  const bots = await getBotsByUserId({
    id: user.id,
    limit: null,
    endingBefore: null,
    startingAfter: null,
    onlyEnable: null,
  });
  console.log("Old bot count:", bots.bots.length);
  const oldInsights = await getStoredInsightsByBotIds({
    ids: bots.bots.map((b) => b.id),
    days: undefined,
  });
  console.log("Old insight count:", oldInsights.insights.length);
  await deleteAllBotsByUserId({ id: user.id });
  await deleteInsightsByIds({ ids: oldInsights.insights.map((i) => i.id) });
  await deleteAllUserContacts(user.id);

  // Bots
  let botId = "";
  for (const bot of data.bots) {
    botId = await createBot({
      name: bot.name,
      userId: user.id,
      description: bot.description,
      adapter: bot.adapter,
      adapterConfig: bot.adapterConfig,
      enable: true,
    });
  }
  console.log("Bots finished");
  // Accounts
  for (const account of data.accounts) {
    await upsertIntegrationAccount({
      userId: user.id,
      platform: account.platform,
      externalId: account.externalId,
      displayName: account.displayName,
      metadata: {
        userId: user.id,
        userName: "T",
        lastName: "T",
      },
      credentials: {},
    });
  }
  console.log("Accounts finished");
  // Insights
  await appendInsightsByBotId({
    id: botId,
    insights: data.insights.map((item: Insight) => {
      return {
        ...item,
        details: item.details?.map((d: DetailData) => {
          return {
            ...d,
            time: timeBeforeHours(getRandomInt()),
          };
        }),
      };
    }),
  });
  console.log("Insights finished");
  // Contacts
  const contactMap = new Map<string, UserContact>();
  for (const contact of data.contacts) {
    if (!contactMap.has(contact.contactName)) {
      contactMap.set(contact.contactName, contact);
    }
  }
  const dedupedContacts = Array.from(contactMap.values());

  await bulkUpsertContacts(
    dedupedContacts.map((c: UserContact) => {
      return {
        contactId: c.contactId,
        contactName: c.contactName,
        type: c.type,
        contactMeta: c.contactMeta,
        userId: user.id,
        botId,
      };
    }),
  );
  console.log("Contacts finished");
}

function getRandomInt(min = 0, max = 12): number {
  const floorMin = Math.floor(min);
  const floorMax = Math.floor(max);
  return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin;
}
