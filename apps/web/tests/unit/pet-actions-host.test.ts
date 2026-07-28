import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("pet actions host wiring (#444)", () => {
  const root = path.resolve(__dirname, "../..");
  const mainRs = readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
  const petModRs = readFileSync(
    path.join(root, "src-tauri/src/pet/mod.rs"),
    "utf8",
  );
  const configWatcherRs = readFileSync(
    path.join(root, "src-tauri/src/pet/config_watcher.rs"),
    "utf8",
  );
  const capabilityJson = readFileSync(
    path.join(root, "src-tauri/capabilities/loomi-pet.json"),
    "utf8",
  );
  const commandsToml = readFileSync(
    path.join(root, "src-tauri/permissions/commands.toml"),
    "utf8",
  );

  it("registers get_pet_context_actions as a Tauri command", () => {
    expect(petModRs).toMatch(/#\[tauri::command\]/);
    expect(petModRs).toMatch(/pub fn get_pet_context_actions\(/);
    expect(mainRs).toMatch(/pet::get_pet_context_actions/);
  });

  it("allows the Pet window to invoke get_pet_context_actions", () => {
    expect(capabilityJson).toMatch(/allow-get-pet-context-actions/);
    expect(commandsToml).toMatch(
      /commands\.allow = \["get_pet_context_actions"\]/,
    );
  });

  it("emits pet:actions-changed when the actions config changes", () => {
    expect(configWatcherRs).toMatch(/actions::actions_config_path/);
    expect(configWatcherRs).toMatch(/emit_actions_changed\(app\)/);
    expect(configWatcherRs).toMatch(/pet:actions-changed/);
  });

  it("routes selected context actions through the agent prompt bridge", () => {
    expect(mainRs).toMatch(/listen\(\s*["']pet:context-action["']/);
    expect(mainRs).not.toMatch(/listen\(\s*["']pet:agent-action["']/);
    expect(mainRs).toMatch(/parse_pet_context_action_id\(event\.payload\(\)\)/);
    expect(mainRs).toMatch(/pet::actions::read_config\(/);
    expect(mainRs).toMatch(/pet::actions::resolve_action_prompt\(/);
    expect(mainRs).toMatch(/pet::actions::build_agent_prompt\(/);
    expect(mainRs).toMatch(
      /send_pet_prompt_to_chat\(app,\s*["']pet:context-action["']/,
    );
    expect(mainRs).not.toMatch(/reqwest::/);
  });
});
