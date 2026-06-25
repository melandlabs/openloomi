/**
 * Utilities for detecting sudo password prompts in tool output.
 */

const SUDO_PASSWORD_PATTERNS = [
  /\[sudo\] password for .+:/,
  /^password:.*$/m,
  /sudo: \[sudo\] password for/,
  /sudo: a password is required/,
];

export function detectSudoPasswordPrompt(output: string): boolean {
  return SUDO_PASSWORD_PATTERNS.some((pattern) => pattern.test(output));
}

export function transformSudoCommand(command: string): string {
  // Match sudo at the beginning of a command segment and make it accept the
  // password from stdin for the password submission endpoint.
  return command.replace(
    /(\s*)sudo(\s+)/g,
    (_, leadingSpace, trailingSpace) => {
      return `${leadingSpace}sudo -S -p ''${trailingSpace}`;
    },
  );
}
