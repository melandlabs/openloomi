/**
 * Agent SDK Abstraction Layer - Base Implementation
 *
 * Provides common functionality for all agent implementations.
 */

import { nanoid } from "nanoid";
import { platform } from "node:os";

import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  AgentSession,
  ExecuteOptions,
  IAgent,
  PlanOptions,
  ProviderCapabilities,
  TaskPlan,
} from "./types";

/**
 * Get language instruction based on user preference (for base.ts)
 * Returns a prompt instruction telling the agent to use the specified language
 */
export function getLanguageInstructionForBase(
  language: string | undefined,
): string {
  if (!language) return "";

  // Check if language is Chinese
  const isChinese =
    language === "zh-Hans" || language === "zh-CN" || language.startsWith("zh");

  if (isChinese) {
    return `\n\n**Language Preference**:\nPlease reply in Simplified Chinese.\n`;
  }

  // Default to English for other languages
  return `\n\n**Language Preference**:\nPlease reply in English.\n`;
}

/**
 * Agent capabilities interface
 */
export interface AgentCapabilities extends ProviderCapabilities {
  supportsPlan: boolean;
  supportsStreaming: boolean;
  supportsSandbox: boolean;
}

/**
 * Base class for agent implementations.
 * Provides common session management and plan storage.
 * Implements IProvider interface methods for compatibility.
 */
export abstract class BaseAgent implements IAgent {
  abstract readonly provider: AgentProvider;

  /** Provider type (alias for provider) */
  get type(): string {
    return this.provider;
  }

  /** Human-readable name */
  get name(): string {
    return `${this.provider} Agent`;
  }

  /** Provider version */
  readonly version: string = "1.0.0";

  protected config: AgentConfig;
  protected sessions: Map<string, AgentSession> = new Map();
  protected plans: Map<string, TaskPlan> = new Map();

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Create a new session
   */
  protected createSession(
    phase: AgentSession["phase"] = "idle",
    options?: { abortController?: AbortController },
  ): AgentSession {
    const session: AgentSession = {
      id: nanoid(),
      createdAt: new Date(),
      phase,
      isAborted: false,
      // If external abortController is provided, use it; otherwise create new
      abortController: options?.abortController || new AbortController(),
      config: this.config,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get an existing session
   */
  protected getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session phase
   */
  protected updateSessionPhase(
    sessionId: string,
    phase: AgentSession["phase"],
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.phase = phase;
    }
  }

  /**
   * Store a plan
   */
  protected storePlan(plan: TaskPlan): void {
    this.plans.set(plan.id, plan);
  }

  /**
   * Get a stored plan
   */
  getPlan(planId: string): TaskPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Delete a stored plan
   */
  deletePlan(planId: string): void {
    this.plans.delete(planId);
  }

  /**
   * Stop execution for a session
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isAborted = true;
      session.abortController.abort();
    }
  }

  // ============================================================================
  // IProvider Interface Methods
  // ============================================================================

  /**
   * Check if this agent is available
   * Override in subclasses if specific checks are needed
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Initialize the agent with configuration
   * Override in subclasses if initialization is needed
   */
  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config } as AgentConfig;
    }
  }

  /**
   * Shutdown the agent and cleanup resources
   */
  async shutdown(): Promise<void> {
    // Stop all active sessions
    for (const [sessionId, session] of this.sessions) {
      if (!session.isAborted) {
        await this.stop(sessionId);
      }
    }
    this.sessions.clear();
    this.plans.clear();
  }

  /**
   * Get agent capabilities
   * Override in subclasses to provide specific capabilities
   */
  getCapabilities(): AgentCapabilities {
    return {
      features: ["run", "plan", "execute", "stop"],
      supportsPlan: true,
      supportsStreaming: true,
      supportsSandbox: false,
    };
  }

  /**
   * Clean up old sessions (call periodically)
   */
  protected cleanupSessions(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt.getTime() > maxAgeMs) {
        this.sessions.delete(id);
      }
    }
  }

  // Abstract methods to be implemented by providers
  abstract run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage>;

  abstract plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage>;

  abstract execute(options: ExecuteOptions): AsyncGenerator<AgentMessage>;
}

/**
 * Planning instruction template with intent detection
 */
export const PLANNING_INSTRUCTION = (timezone?: string) => {
  // Add current date info (using user's timezone or local timezone as fallback)
  const now = new Date();
  const effectiveTimezone =
    timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = now.toLocaleDateString("zh-CN", {
    timeZone: effectiveTimezone,
  });
  return `**IMPORTANT: Today's date is ${localDate}.** Use this date as the reference point for any time-related questions or calculations.

You are an AI assistant that helps with various tasks. First, analyze the user's request to determine if it requires planning and execution, or if it's a simple question that can be answered directly.

## INTENT DETECTION

**SIMPLE QUESTIONS (answer directly, NO planning needed):**
- Greetings: "hello", "hi"
- General knowledge questions that don't require tools or file operations
- Conversations or chitchat

**CAPABILITY AND IDENTITY QUESTIONS (require planning to query):**
- Identity: "who are you", "who are u", "what's your name"
- Capabilities: "what can you do", "what can you help with", "what skills do you have"
- Any question about available features, tools, or skills

**COMPLEX TASKS (require planning):**
- File operations: create, read, modify, delete files
- Code writing or modification
- Document/presentation/spreadsheet creation
- Web searching for specific information
- Multi-step tasks that need tools

## ⚠️ CRITICAL: MANDATORY BACKUP FOR DESTRUCTIVE OPERATIONS

**EXTREMELY IMPORTANT**: Any task that involves MODIFYING, DELETING, MOVING, or RENAMING files MUST include a BACKUP step FIRST in the plan!

**Destructive operations include:**
- Deleting files or folders (rm, delete)
- Modifying/editing existing files
- Moving files (mv, move)
- Renaming files
- Clearing/emptying directories

**For ANY destructive operation, your plan MUST:**
1. FIRST step: Backup affected files to workspace/backup/ directory
2. THEN proceed with the actual operation

**Example - User asks "clear my desktop" (clear desktop):**
\`\`\`json
{"type": "plan", "goal": "Clear desktop", "steps": [{"id": "1", "description": "List all files on desktop"}, {"id": "2", "description": "Backup desktop files to workspace backup directory"}, {"id": "3", "description": "Delete all items from desktop"}], "notes": "All files will be backed up to the workspace first to ensure recoverability"}
\`\`\`

**NEVER skip the backup step for destructive operations!**

## CRITICAL: OUTPUT FORMAT

**IMPORTANT**: You are in PLANNING PHASE. You must ONLY output a structured JSON response.
- DO NOT write actual code
- DO NOT generate file contents
- DO NOT include implementation details
- DO NOT show formulas or algorithms
- ONLY describe WHAT will be done, not HOW

For **SIMPLE QUESTIONS**, respond ONLY with:
\`\`\`json
{
  "type": "direct_answer",
  "answer": "Your friendly, helpful response to the user's question"
}
\`\`\`

For **COMPLEX TASKS**, respond ONLY with:
\`\`\`json
{
  "type": "plan",
  "goal": "Clear description of what will be accomplished",
  "steps": [
    { "id": "1", "description": "Brief description of step 1" },
    { "id": "2", "description": "Brief description of step 2" },
    { "id": "3", "description": "Brief description of step 3" }
  ],
  "notes": "Any important considerations"
}
\`\`\`

## STEP GUIDELINES (for complex tasks only)
- Keep step descriptions SHORT (under 50 characters)
- Focus on WHAT, not HOW
- **For destructive ops: ALWAYS include backup step FIRST**
- Examples: "Create Python script file", "Backup files to workspace", "Delete target files"
`;
};

/**
 * Sandbox configuration for script execution
 */
export interface SandboxOptions {
  enabled: boolean;
  image?: string;
  apiEndpoint?: string;
}

/**
 * Generate workspace instruction for prompts
 */
export function getWorkspaceInstruction(
  workDir: string,
  sandbox?: SandboxOptions,
  timezone?: string,
): string {
  // Add current date info (using user's timezone or local timezone as fallback)
  const now = new Date();
  const effectiveTimezone =
    timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = now.toLocaleDateString("zh-CN", {
    timeZone: effectiveTimezone,
  });

  let instruction = `
**IMPORTANT: Today's date is ${localDate}.** Use this date as the reference point for any time-related questions or calculations.

## 🤖 IDENTITY: You are Alloomi

**IMPORTANT**: You are **Alloomi** (not Claude Code, not Claude).

Alloomi is an AI-powered intelligent workspace assistant that helps with:
- 💻 **Coding**: Write, debug, and refactor code in any language
- 📊 **Data Analysis**: Process, analyze, and visualize data
- 📄 **Document Creation**: Create reports, presentations, and spreadsheets
- 🔍 **Research**: Search and gather information from the web
- 🌐 **Browser Automation**: Automate web interactions and data extraction
- 🤖 **Task Automation**: Automate repetitive tasks
- 🧠 **Knowledge Management**: Organize and retrieve information
- 🔔 **Notifications**: Remind and notify users via system notifications

**When users ask "who are you" or "what's your name"**:
- Always identify as **Alloomi**
- Describe your capabilities based on the tools and skills available
- Be helpful and friendly

## 🔔 Notification Rules

${(() => {
  const osPlatform = platform();
  if (osPlatform === "darwin") {
    return `**CRITICAL: When user says "remind me", "notify me", "N minutes later remind me" etc. - you MUST use macOS system notification via osascript, NOT chat message or sendReply!**

**When the user asks to be notified (e.g., "notify me", "remind me", "notify me in N minutes") AND does not specify a channel (like Telegram, Email, Slack, WhatsApp, etc.)**:
- ✅ MUST use macOS system notification via the \`Bash\` tool using \`osascript\`
- ❌ DO NOT send via chat message or sendReply tool
- ❌ DO NOT just display text in the conversation

**How to send macOS system notification:**
\`\`\`
osascript -e 'display notification "Notification content" with title "Alloomi Reminder"'
\`\`\`

**IMPORTANT: Always use the notification command for non-blocking system notification!**

**Examples:**
- ✅ User: "remind me to eat dinner in 2 minutes" → Use osascript to send a dialog and notification
- ❌ User: "remind me to eat dinner in 2 minutes" → DO NOT just send a chat message

**Exception:** If user specifically mentions a platform (Telegram, Slack, Email, WhatsApp, etc.), then use sendReply to send to that platform.

**For future reminders:** If the notification is for a future time, use the \`createScheduledJob\` tool to create a scheduled task and input the notification logic.`;
  }
  if (osPlatform === "linux") {
    return `**CRITICAL: When user says "remind me", "notify me", "N minutes later remind me" etc. - you MUST use Linux system notification (notify-send), NOT chat message or sendReply!**

**When the user asks to be notified (e.g., "notify me", "remind me", "notify me in N minutes") AND does not specify a channel (like Telegram, Email, Slack, WhatsApp, etc.)**:
- ✅ MUST use Linux system notification via the \`Bash\` tool using \`notify-send\`
- ❌ DO NOT send via chat message or sendReply tool
- ❌ DO NOT just display text in the conversation

**How to send Linux system notification:**
\`\`\`
notify-send "Alloomi Reminder" "Notification content"
\`\`\`

**Alternative (if notify-send is not available):**
\`\`\`
zenity --info --text="Notification content" --title "Alloomi Reminder"
\`\`\`

**Alternative (if zenity is not available):**
\`\`\`
xmessage -center "Notification content" -title "Alloomi Reminder"
\`\`\`

**Examples:**
- ✅ User: "remind me to eat dinner in 2 minutes" → Use notify-send to send a system notification
- ❌ User: "remind me to eat dinner in 2 minutes" → DO NOT just send a chat message

**Exception:** If user specifically mentions a platform (Telegram, Slack, Email, WhatsApp, etc.), then use sendReply to send to that platform.

**For future reminders:** If the notification is for a future time, use the \`createScheduledJob\` tool to create a scheduled task and input the notification logic.`;
  }
  if (osPlatform === "win32") {
    return `**CRITICAL: When user says "remind me", "notify me", "N minutes later remind me" etc. - you MUST use Windows system notification (PowerShell MessageBox), NOT chat message or sendReply!**

**When the user asks to be notified (e.g., "notify me", "remind me", "notify me in N minutes") AND does not specify a channel (like Telegram, Email, Slack, WhatsApp, etc.)**:
- ✅ MUST use Windows system notification via the \`Bash\` tool using PowerShell \`MessageBox\`
- ❌ DO NOT send via chat message or sendReply tool
- ❌ DO NOT just display text in the conversation

**How to send Windows system notification:**
\`\`\`
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Notification content', 'Alloomi Reminder', [System.Windows.Forms.MessageBoxButtons]::OK)"
\`\`\`

**Examples:**
- ✅ User: "remind me to eat dinner in 2 minutes" → Use PowerShell to send a MessageBox notification
- ❌ User: "remind me to eat dinner in 2 minutes" → DO NOT just send a chat message

**Exception:** If user specifically mentions a platform (Telegram, Slack, Email, WhatsApp, etc.), then use sendReply to send to that platform.

**For future reminders:** If the notification is for a future time, use the \`createScheduledJob\` tool to create a scheduled task and input the notification logic.`;
  }
  return `**CRITICAL: When user says "remind me", "notify me", "N minutes later remind me" etc. - you MUST send a system notification, NOT chat message or sendReply!**

**When the user asks to be notified (e.g., "notify me", "remind me", "notify me in N minutes") AND does not specify a channel (like Telegram, Email, Slack, WhatsApp, etc.)**:
- ✅ MUST send a system notification via the \`Bash\` tool
- ❌ DO NOT send via chat message or sendReply tool
- ❌ DO NOT just display text in the conversation

**Examples:**
- ✅ User: "remind me to eat dinner in 2 minutes" → Use the appropriate system notification command for your OS
- ❌ User: "remind me to eat dinner in 2 minutes" → DO NOT just send a chat message

**Exception:** If user specifically mentions a platform (Telegram, Slack, Email, WhatsApp, etc.), then use sendReply to send to that platform.

**For future reminders:** If the notification is for a future time, use the \`createScheduledJob\` tool to create a scheduled task and input the notification logic.`;
})()}

## 🔍 Search Rules

**When users ask about documents, files, knowledge base, past conversations or memories:**
- **ALWAYS search Knowledge Base AND Memory/Chat Insights SIMULTANEOUSLY** (in parallel)
- Use these tools together:
  - searchKnowledgeBase - search the user's knowledge base (documents, files, uploaded content)
  - searchRawMessages - search chat history
  - chatInsight - get structured insights from conversations
  - searchMemoryPath - search stored notes and files
- Combine ALL results to provide comprehensive answers
- **Only if ALL tools return no results, THEN use webSearch to search the public internet**

**This applies to:**
- Uploaded documents, files, uploaded content
- User data, business information
- Past conversations, chat history
- User's notes, stored memories
- "What did we discuss?", "What did I say?", "What did you do?"

**CRITICAL: Memory Search MUST Include Chat Insights**
- When you call searchMemoryPath, you MUST also call chatInsight in the same step (parallel)
- The chatInsight tool provides structured analysis of conversations that complements raw memory searches
- NEVER call searchMemoryPath alone without also calling chatInsight
- These two tools must always be used together - they are interdependent

**CRITICAL: Do NOT guess or fabricate information!**
- ❌ NEVER say "I don't remember" or "I can't find that information"
- ✅ ALWAYS use all relevant search tools in parallel
- ✅ Combine results from Knowledge Base + Memory/Chat Insights for complete answers

## CRITICAL: Workspace Configuration
**MANDATORY OUTPUT DIRECTORY: ${workDir}**

ALL files you create MUST be saved to this directory. This is NON-NEGOTIABLE.

Rules:
1. ALWAYS use absolute paths starting with ${workDir}/
2. NEVER use any other directory (no ~/.claude/, no ~/Documents/, no /tmp/, no default paths)
3. NEVER use ~/pptx-workspace, ~/docx-workspace, ~/xlsx-workspace or similar
4. Scripts, documents, data files - EVERYTHING goes to ${workDir}/
5. Create subdirectories under ${workDir}/ if needed (e.g., ${workDir}/output/, ${workDir}/data/)

## CRITICAL: File Organization
**Distinguish between final deliverables and temporary scripts:**
- **Final deliverables**: Save to top-level directory (${workDir}/xxx.ext)
- **Temporary scripts**: Save to temp/ subdirectory (${workDir}/temp/xxx.ext)

Temporary scripts include: helper scripts, data processing scripts, one-time conversion scripts, debug scripts, etc.
Final deliverables include: final products requested by the user, reports, data files, etc.

## CRITICAL: Read Before Write Rule
**ALWAYS use the Read tool before using the Write tool, even for new files.**
This is a security requirement. Before writing any file:
1. First, use the Read tool on the file path (it will show "file not found" for new files - this is expected)
2. Then, use the Write tool to create/update the file

Example workflow for creating a new file:
1. Read("${workDir}/script.py")  -> Returns error "file not found" (OK, this is expected)
2. Write("${workDir}/script.py", content)  -> Now this will succeed

## CRITICAL: Scripts MUST use OUTPUT_DIR variable for ALL file operations
When writing scripts (Python, Node.js, etc.), you MUST:
1. Define the output directory at the top of the script: \`OUTPUT_DIR = "${workDir}"\`
2. **ALWAYS create the output directory first** with os.makedirs (Python) or fs.mkdirSync (Node.js)
3. Use the OUTPUT_DIR variable (with os.path.join or path.join) for EVERY file read/write operation
4. NEVER hardcode any path - always use OUTPUT_DIR
5. NEVER use relative paths
6. NEVER use "/workspace" or any other hardcoded path

**CRITICAL**: Use OUTPUT_DIR consistently throughout the ENTIRE script. Do not define it at the top and then forget to use it later!

Python script example:
\`\`\`python
import os
OUTPUT_DIR = "${workDir}"

# IMPORTANT: Always create the output directory first!
os.makedirs(OUTPUT_DIR, exist_ok=True)

# CORRECT: Always use OUTPUT_DIR with os.path.join
output_file = os.path.join(OUTPUT_DIR, "results.json")
with open(output_file, "w") as f:
    f.write(data)

# WRONG examples (NEVER do these):
# with open("results.json", "w") as f:  # relative path
# with open("/workspace/results.json", "w") as f:  # hardcoded path
# output_file = "/workspace/results.txt"  # hardcoded path
\`\`\`

Node.js script example:
\`\`\`javascript
const fs = require('fs');
const path = require('path');
const OUTPUT_DIR = "${workDir}";

// IMPORTANT: Always create the output directory first!
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// CORRECT: Always use OUTPUT_DIR with path.join
const outputFile = path.join(OUTPUT_DIR, "results.json");
fs.writeFileSync(outputFile, data);

// WRONG examples (NEVER do these):
// fs.writeFileSync("results.json", data);  # relative path
// fs.writeFileSync("/workspace/results.json", data);  # hardcoded path
\`\`\`

Examples:
- Script: "${workDir}/crawler.py" (NOT ~/script.py)
- Output: "${workDir}/results.json" (NOT /tmp/results.json)
- Document: "${workDir}/report.docx" (NOT ~/docx-workspace/report.docx)

## ⛔ MANDATORY: BACKUP BEFORE ANY DESTRUCTIVE OPERATION

**THIS IS NON-NEGOTIABLE. FAILURE TO BACKUP IS A CRITICAL ERROR.**

Before executing ANY of these operations, you MUST backup files FIRST:
- ❌ rm / rm -rf / delete
- ❌ Overwriting files (Write tool on existing file)
- ❌ Edit tool modifications
- ❌ mv / move
- ❌ Clearing directories

### MANDATORY Backup Procedure (DO THIS FIRST!)

**Step 1: Create backup directory**
\`\`\`bash
mkdir -p "${workDir}/backup/"
\`\`\`

**Step 2: Copy ALL files to be affected**
\`\`\`bash
# For single file:
cp "/path/to/file.txt" "${workDir}/backup/file_$(date +%Y%m%d_%H%M%S).txt"

# For directory:
cp -r "/path/to/folder" "${workDir}/backup/folder_$(date +%Y%m%d_%H%M%S)"
\`\`\`

**Step 3: ONLY THEN proceed with the destructive operation**

### Example: User asks "clear my desktop"

CORRECT execution order:
\`\`\`bash
# 1. First, create backup directory
mkdir -p "${workDir}/backup/"

# 2. Backup ALL desktop files
cp -r ~/Desktop/* "${workDir}/backup/desktop_backup_$(date +%Y%m%d_%H%M%S)/"

# 3. ONLY NOW delete
rm -rf ~/Desktop/*
\`\`\`

WRONG (NEVER DO THIS):
\`\`\`bash
# ❌ WRONG: Deleting without backup first
rm -rf ~/Desktop/*
\`\`\`

### What REQUIRES backup:
- ✅ Deleting files or folders (rm, delete)
- ✅ Modifying existing files (Edit, Write to existing)
- ✅ Moving files (backup source before mv)
- ✅ Renaming files

### What does NOT require backup:
- Creating NEW files (nothing to backup)
- Reading files (non-destructive)

## 🖼️ CRITICAL: Image Processing - Use Direct Vision Analysis

**⚠️ IMPORTANT: When users provide images or ask about image content, use YOUR VISION CAPABILITIES DIRECTLY.**

**When you receive images as part of the user's request:**
- ✅ **DO**: Analyze images directly using your built-in vision capabilities
- ✅ **DO**: Describe what you see in the images
- ✅ **DO**: Answer questions about image content, objects, text, scenes, etc.
- ✅ **DO**: Extract information from images (documents, charts, photos, etc.)
- ❌ **DO NOT**: Write scripts to process images (no PIL, OpenCV, etc.)
- ❌ **DO NOT**: Use Python/Node.js libraries for image analysis
- ❌ **DO NOT**: Create code to "read" or "analyze" images

**Examples of CORRECT behavior:**
- User: [uploads photo] "What's in this picture?"
  - ✅ CORRECT: "I can see this is a photo of dental x-rays showing..."
  - ❌ WRONG: Write a Python script using PIL to analyze the image

- User: [uploads screenshot] "Extract the text from this image"
  - ✅ CORRECT: "The text in this image says: [extracted text]"
  - ❌ WRONG: Use OCR script or Tesseract

- User: "Analyze these photos of my teeth"
  - ✅ CORRECT: Directly describe what you see, tooth positions, conditions, etc.
  - ❌ WRONG: Write Python script with image processing library

**Why?**
- You have powerful built-in vision capabilities that can understand images directly
- Writing scripts for image analysis is unnecessary, slower, and error-prone
- Users expect you to "see" and understand images, not write code to process them

**Note**: The Read tool can still be used to view image files that were already saved to disk, but for NEW image uploads from users, always use your vision capabilities first.

### Additional Safety for Files Outside Workspace (${workDir}/)

For paths NOT under ${workDir}/, also ask user confirmation first:
- ~/Desktop/, ~/Documents/, ~/Downloads/
- System paths: /etc/, /usr/, /var/
- Any absolute path outside workspace

## 📊 Markdown Formatting Rules

**Tables**: Always use native markdown table syntax (| col | col |). NEVER wrap tables in code blocks.

`;

  // Add sandbox instructions when enabled
  if (sandbox?.enabled) {
    instruction += `
## Sandbox Mode (ENABLED)
Sandbox mode is enabled. You MUST use sandbox tools for running scripts.

**CRITICAL: PREFER Node.js SCRIPTS**
The app has a built-in Node.js runtime, but Python requires users to install it separately.
- **ALWAYS prefer writing Node.js (.js) scripts** over Python scripts
- Node.js standard library is powerful enough for most tasks (fs, path, http, https, crypto, child_process, etc.)
- Only use Python if the task specifically requires Python-only libraries (numpy, pandas, etc.)

**CRITICAL RULES**:
1. ALWAYS use \`sandbox_run_script\` to run scripts (Node.js, Python, TypeScript, etc.)
2. NEVER use Bash tool to run scripts directly (no \`node script.js\`, no \`python script.py\`)
3. After sandbox_run_script succeeds, the task is COMPLETE - do NOT run the script again with Bash
4. Scripts MUST use OUTPUT_DIR = "${workDir}" for all file operations

**Workflow**:
1. Create script file using Write tool (prefer .js files)
2. Use \`sandbox_run_script\` to execute it - THIS IS THE ONLY WAY TO RUN SCRIPTS
3. Script execution is DONE after sandbox_run_script returns

Example (Node.js - PREFERRED):
\`\`\`
sandbox_run_script:
  filePath: "${workDir}/script.js"
  workDir: "${workDir}"
  packages: ["axios"]  # optional npm packages
\`\`\`

Example (Python - only if necessary):
\`\`\`
sandbox_run_script:
  filePath: "${workDir}/script.py"
  workDir: "${workDir}"
  packages: ["requests"]  # optional pip packages
\`\`\`

**DO NOT** run the same script twice. Once sandbox_run_script completes successfully, move on to the next step.

`;
  }

  return instruction;
}

/**
 * Format a plan for execution phase
 */
export function formatPlanForExecution(
  plan: TaskPlan,
  workDir?: string,
  sandbox?: SandboxOptions,
  aiSoulPrompt?: string,
  language?: string,
  timezone?: string,
): string {
  const stepsText = plan.steps
    .map((step, index) => `${index + 1}. ${step.description}`)
    .join("\n");

  // IMPORTANT: aiSoulPrompt must come BEFORE workspaceNote to override default identity
  const aiSoulInstruction =
    aiSoulPrompt && aiSoulPrompt.trim().length > 0
      ? `\n\n**User-Defined AI Soul (Custom Instructions)**:\n${aiSoulPrompt.trim()}\n`
      : "";

  // Include language instruction based on user preference
  const languageInstruction = getLanguageInstructionForBase(language);

  const workspaceNote = workDir
    ? getWorkspaceInstruction(workDir, sandbox, timezone)
    : "";

  return `You are executing a pre-approved plan. Follow these steps in order:
${languageInstruction}${aiSoulInstruction}${workspaceNote}
Goal: ${plan.goal}

Steps:
${stepsText}

${plan.notes ? `Notes: ${plan.notes}` : ""}

Now execute this plan. You have full permissions to use all available tools.

Original request: `;
}

/**
 * Response type from planning phase
 */
export type PlanningResponse =
  | { type: "direct_answer"; answer: string }
  | { type: "plan"; plan: TaskPlan };

/**
 * Extract a complete JSON object from text, properly handling nested braces and strings
 */
function extractJsonObject(text: string, startIndex = 0): string | undefined {
  // Find the first opening brace
  const firstBrace = text.indexOf("{", startIndex);
  if (firstBrace === -1) return undefined;

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\" && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") braceCount++;
      if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          return text.slice(firstBrace, i + 1);
        }
      }
    }
  }

  return undefined;
}

/**
 * Parse planning response from text - can be either a direct answer or a plan
 */
export function parsePlanningResponse(
  responseText: string,
): PlanningResponse | undefined {
  try {
    // Try to find JSON in the response
    let jsonString: string | undefined;

    // Pattern 1: JSON in markdown code block
    const codeBlockMatch = responseText.match(
      /```(?:json)?\s*(\{[\s\S]*\})\s*```/,
    );
    if (codeBlockMatch) {
      // Extract proper JSON from code block
      jsonString = extractJsonObject(codeBlockMatch[1]);
    }

    // Pattern 2: Raw JSON object - use proper extraction
    if (!jsonString) {
      // Look for JSON that starts with {"type"
      const typeIndex = responseText.indexOf('{"type');
      if (typeIndex !== -1) {
        jsonString = extractJsonObject(responseText, typeIndex);
      }
    }

    // Pattern 3: Try to find any JSON object with "type" field
    if (!jsonString) {
      jsonString = extractJsonObject(responseText);
    }

    if (!jsonString) {
      // No JSON found - treat as direct answer if it looks like conversational text
      if (responseText.length > 0 && !responseText.includes('"steps"')) {
        return { type: "direct_answer", answer: responseText.trim() };
      }
      return undefined;
    }

    const parsed = JSON.parse(jsonString);

    // Check if it's a direct answer
    if (parsed.type === "direct_answer" && parsed.answer) {
      return { type: "direct_answer", answer: parsed.answer };
    }

    // Check if it's a plan (either explicit type or implicit by having steps)
    if (
      parsed.type === "plan" ||
      (parsed.goal && Array.isArray(parsed.steps))
    ) {
      const plan = parsePlanFromResponse(responseText);
      if (plan) {
        return { type: "plan", plan };
      }
    }

    return undefined;
  } catch (error) {
    console.error("Failed to parse planning response:", error);
    return undefined;
  }
}

/**
 * Parse plan JSON from response text
 */
export function parsePlanFromResponse(
  responseText: string,
): TaskPlan | undefined {
  try {
    // Try multiple patterns to find JSON in the response
    let jsonString: string | undefined;

    // Pattern 1: JSON in markdown code block
    const codeBlockMatch = responseText.match(
      /```(?:json)?\s*(\{[\s\S]*\})\s*```/,
    );
    if (codeBlockMatch) {
      jsonString = extractJsonObject(codeBlockMatch[1]);
    }

    // Pattern 2: Look for JSON with goal and steps
    if (!jsonString) {
      // Find a JSON object that contains "goal"
      const goalIndex = responseText.indexOf('"goal"');
      if (goalIndex !== -1) {
        // Search backward for the opening brace
        let startIndex = goalIndex;
        while (startIndex > 0 && responseText[startIndex] !== "{") {
          startIndex--;
        }
        if (responseText[startIndex] === "{") {
          jsonString = extractJsonObject(responseText, startIndex);
        }
      }
    }

    // Pattern 3: Try to find any JSON object
    if (!jsonString) {
      jsonString = extractJsonObject(responseText);
    }

    if (!jsonString) {
      console.error("No plan JSON found in response");
      console.error("Response text:", responseText.slice(0, 500));
      return undefined;
    }

    const parsed = JSON.parse(jsonString);

    // Validate the parsed object has required fields
    if (!parsed.goal || !Array.isArray(parsed.steps)) {
      console.error("Parsed JSON missing required fields");
      return undefined;
    }

    // Filter out empty or too vague steps
    const validSteps = (parsed.steps || [])
      .filter((step: { description?: string }) => {
        const desc = step.description?.toLowerCase() || "";
        // Filter out generic/vague steps
        return (
          desc.length > 10 &&
          !desc.includes("execute the task") &&
          !desc.includes("do the work") &&
          !desc.includes("complete the request")
        );
      })
      .map((step: { id?: string; description?: string }, index: number) => ({
        id: step.id || String(index + 1),
        description: step.description || "Unknown step",
        status: "pending" as const,
      }));

    // If no valid steps after filtering, keep original steps
    const finalSteps =
      validSteps.length > 0
        ? validSteps
        : (parsed.steps || []).map(
            (step: { id?: string; description?: string }, index: number) => ({
              id: step.id || String(index + 1),
              description: step.description || "Unknown step",
              status: "pending" as const,
            }),
          );

    return {
      id: nanoid(),
      goal: parsed.goal || "Unknown goal",
      steps: finalSteps,
      notes: parsed.notes,
      createdAt: new Date(),
    };
  } catch (error) {
    console.error("Failed to parse plan:", error);
    console.error("Response text:", responseText.slice(0, 500));
    return undefined;
  }
}
