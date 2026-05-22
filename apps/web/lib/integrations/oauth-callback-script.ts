/**
 * Serialize a value for embedding inside an inline `<script>` tag.
 *
 * `JSON.stringify` alone does not escape `</`, so an attacker-controlled
 * string containing `</script>` can break out of the surrounding script
 * block. Use this helper instead of raw `JSON.stringify` whenever the
 * output is interpolated into a `<script>...</script>` body in OAuth
 * callback HTML responses.
 */
export function jsonForScript(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return serialized;
  return serialized.replace(/</g, "\\u003c");
}
