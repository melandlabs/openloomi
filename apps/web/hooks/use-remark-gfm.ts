"use client";

import { useEffect, useState } from "react";

// remark-gfm plugin type
type PluggableList = Array<any>;

/**
 * Dynamically and safely load remark-gfm plugin
 *
 * remark-gfm's dependency mdast-util-gfm-autolink-literal@2.x uses
 * regex lookbehind assertion (?<=...) which is not supported in
 * older Safari (< 16.4) on Intel Mac, causing SyntaxError.
 *
 * Using dynamic import() isolates remark-gfm into separate chunk:
 * - Supported browsers: loads normally, GFM features available
 * - Unsupported browsers: import fails caught, markdown still renders (GFM features disabled)
 */

let cachedPlugin: any = undefined;
let loadPromise: Promise<any> | null = null;

function loadRemarkGfm(): Promise<any> {
  if (cachedPlugin !== undefined) return Promise.resolve(cachedPlugin);
  if (loadPromise) return loadPromise;

  loadPromise = import("remark-gfm")
    .then((mod) => {
      const original = mod.default;
      if (typeof original !== "function") {
        console.warn("[openloomi] remark-gfm is disabled");
        cachedPlugin = null;
        return null;
      }

      // remark-gfm accesses `this` as the unified processor (stores micromarkExtensions etc.).
      // In Turbopack production bundles, `this` may be undefined, causing
      // "undefined is not an object (evaluating 'self.data')".
      // Wrap with a function that provides a unified processor-like `this` context via a Proxy.
      cachedPlugin = function (this: any, options?: any) {
        try {
          return original.call(this, options);
        } catch (err) {
          const errStr = String(err);
          if (
            errStr.includes("self.data") ||
            errStr.includes(
              "undefined is not an object (evaluating 'self.data",
            ) ||
            errStr.includes("undefined is not an object")
          ) {
            // Build a safe unified processor-like object that remark-gfm can write to.
            // remark-gfm calls: self.data() which returns a data object with
            // micromarkExtensions, fromMarkdownExtensions, toMarkdownExtensions arrays.
            const data: any = {};
            const safeThis = new Proxy(
              {},
              {
                get(_target, prop) {
                  if (prop === "data") {
                    return () => data;
                  }
                  return undefined;
                },
              },
            );
            try {
              return original.call(safeThis, options);
            } catch (_) {
              console.warn(
                "[openloomi] remark-gfm plugin error, GFM features disabled:",
                err,
              );
              return undefined;
            }
          }
          console.warn(
            "[openloomi] remark-gfm plugin error, GFM features disabled:",
            err,
          );
          return undefined;
        }
      };

      return cachedPlugin;
    })
    .catch((err) => {
      console.warn(
        "[openloomi] remark-gfm load failed (browser may not support regex lookbehind), GFM features disabled:",
        err,
      );
      cachedPlugin = null;
      return null;
    });

  return loadPromise;
}

/**
 * Returns remarkPlugins array, auto-updates when remark-gfm loads
 * Can be passed directly to ReactMarkdown's remarkPlugins prop
 */
export function useRemarkGfm(extraPlugins?: PluggableList): PluggableList {
  const [plugin, setPlugin] = useState<any>(cachedPlugin);

  useEffect(() => {
    if (cachedPlugin !== undefined) {
      setPlugin(cachedPlugin);
      return;
    }
    loadRemarkGfm().then((p) => setPlugin(p));
  }, []);

  const plugins: PluggableList = [];
  if (plugin) plugins.push(plugin);
  if (extraPlugins) plugins.push(...extraPlugins);
  return plugins;
}
