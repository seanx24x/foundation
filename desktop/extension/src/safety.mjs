import { relative, resolve, sep, isAbsolute } from "node:path";

export function relativeSourcePath(root, filename) {
  const path = relative(resolve(root), resolve(filename));
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
    return null;
  return path.split(sep).join("/");
}
export function validSourcePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length < 2048 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !isAbsolute(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
export function validLine(line) {
  return Number.isSafeInteger(line) && line > 0 && line <= 1000000 ? line : 1;
}
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
