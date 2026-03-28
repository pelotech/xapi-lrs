/**
 * Tagged template literal helper for HTML with auto-escaping.
 *
 * Usage:
 *   html`<p>${unsafeUserInput}</p>`
 *
 * Interpolated values are HTML-escaped. To inject raw HTML (e.g. from
 * another html`` call), wrap it with `raw()`.
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const ESCAPE_RE = /[&<>"']/g;

function escapeHtml(str: string): string {
  return str.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}

/** Marker for pre-escaped HTML that should not be double-escaped. */
const RAW = Symbol("raw");

export interface RawHtml {
  [RAW]: true;
  value: string;
}

/** Mark a string as already-escaped raw HTML. */
export function raw(value: string): RawHtml {
  return { [RAW]: true, value };
}

function isRaw(v: unknown): v is RawHtml {
  return v !== null && typeof v === "object" && RAW in v;
}

/** Tagged template literal that auto-escapes interpolated values. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) {
        // skip nullish / false (convenient for conditional rendering)
      } else if (isRaw(v)) {
        result += v.value;
      } else if (Array.isArray(v)) {
        // Join array of RawHtml (from .map() calls)
        for (const item of v) {
          if (isRaw(item)) {
            result += item.value;
          } else if (item != null && item !== false) {
            result += escapeHtml(String(item));
          }
        }
      } else {
        result += escapeHtml(String(v));
      }
    }
  }
  return raw(result);
}
