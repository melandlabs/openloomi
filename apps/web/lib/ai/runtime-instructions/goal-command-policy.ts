import {
  canonicalJson,
  type GoalConstraint,
  type GoalSource,
  type RuntimeInstructionSource,
} from "@openloomi/ai/agent/runtime-instructions";

export function findUnsupportedRuntimeConstraint(
  constraints: readonly GoalConstraint[],
): GoalConstraint | undefined {
  return constraints.find(
    (constraint) => constraint.enforcement === "runtime_enforced",
  );
}

export function goalSourceMatchesCommand(
  goalSource: GoalSource,
  commandSource: RuntimeInstructionSource,
): boolean {
  if (commandSource.type === "user") return goalSource.type === "user";
  return (
    commandSource.type === "automation" &&
    goalSource.type !== "user" &&
    goalSource.id === commandSource.sourceRef
  );
}

export function findUnauthorizedConstraintChange(
  current: readonly GoalConstraint[],
  next: readonly GoalConstraint[],
  source: RuntimeInstructionSource,
): GoalConstraint | undefined {
  const currentById = new Map(
    current.map((constraint) => [constraint.id, constraint]),
  );
  const nextById = new Map(
    next.map((constraint) => [constraint.id, constraint]),
  );
  const changedIds = new Set([...currentById.keys(), ...nextById.keys()]);

  for (const id of changedIds) {
    const previous = currentById.get(id);
    const revised = nextById.get(id);
    if (
      previous !== undefined &&
      revised !== undefined &&
      canonicalJson(previous) === canonicalJson(revised)
    ) {
      continue;
    }
    if (previous && !constraintAuthorityMatchesSource(previous, source)) {
      return previous;
    }
    if (revised && !constraintAuthorityMatchesSource(revised, source)) {
      return revised;
    }
  }
  return undefined;
}

function constraintAuthorityMatchesSource(
  constraint: GoalConstraint,
  source: RuntimeInstructionSource,
): boolean {
  return (
    constraint.authority === source.authority &&
    (constraint.authority === "user" ||
      constraint.sourceRef === source.sourceRef)
  );
}
