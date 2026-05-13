const PREVIEW_SCROLL_FIX_ATTR = "data-openloomi-preview-scroll-fix";
const PREVIEW_SNAPSHOT_CLAMP_ATTR = "data-openloomi-preview-snapshot-clamp";
const PREVIEW_PAGE_FLOW_ATTR = "data-openloomi-preview-page-flow";

/**
 * Inject high-priority styles into HTML for iframe `srcDoc`:
 * html does not scroll, fixed viewport height,
 * body has fixed `height:100%` and `overflow-y:auto` as the scroll root.
 * If body only uses `min-height` without limiting height,
 * under `html{overflow:hidden}` content will be clipped and cannot scroll.
 */
export function injectHtmlPreviewScrollFix(html: string): string {
  const trimmed = html.trim();
  if (!trimmed || trimmed.includes(PREVIEW_SCROLL_FIX_ATTR)) {
    return html;
  }

  // Lock html to viewport height and disable scrolling; body serves as the sole vertical scroll root.
  // Body must have fixed height:100%; using only min-height would cause body to expand with content,
  // overflow-y:auto would never show scrollbar, and content would be clipped by html.
  const style = `<style ${PREVIEW_SCROLL_FIX_ATTR}>
  html{height:100%!important;overflow:hidden!important;}
  body{height:100%!important;margin:0!important;box-sizing:border-box!important;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;}
</style>`;

  if (/<head[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<head([^>]*)>/i, `<head$1>${style}`);
  }
  if (/<html[\s>]/i.test(trimmed)) {
    return trimmed.replace(/(<html[^>]*>)/i, `$1<head>${style}</head>`);
  }
  if (/<body[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<body([^>]*)>/i, `<body$1>${style}`);
  }
  return `<!DOCTYPE html><html><head>${style}</head><body>${trimmed}</body></html>`;
}

/**
 * Inject styles for page-flow iframe rendering:
 * the iframe grows to the document height and the host page owns scrolling.
 */
export function injectHtmlPreviewPageFlow(html: string): string {
  const trimmed = html.trim();
  if (!trimmed || trimmed.includes(PREVIEW_PAGE_FLOW_ATTR)) {
    return html;
  }

  const style = `<style ${PREVIEW_PAGE_FLOW_ATTR}>
  html{height:auto!important;min-height:0!important;overflow:visible!important;}
  body{height:auto!important;min-height:0!important;margin:0!important;box-sizing:border-box!important;overflow:visible!important;}
  img,video,canvas,svg{max-width:100%;height:auto;}
</style>`;

  if (/<head[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<head([^>]*)>/i, `<head$1>${style}`);
  }
  if (/<html[\s>]/i.test(trimmed)) {
    return trimmed.replace(/(<html[^>]*>)/i, `$1<head>${style}</head>`);
  }
  if (/<body[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<body([^>]*)>/i, `<body$1>${style}`);
  }
  return `<!DOCTYPE html><html><head>${style}</head><body>${trimmed}</body></html>`;
}

/**
 * For library grid "snapshot": both html/body have `overflow:hidden`, no scrollbars,
 * display is clipped by outer iframe.
 * Contrast with {@link injectHtmlPreviewScrollFix} which is for scrollable fullscreen/inline preview.
 */
export function injectHtmlPreviewSnapshotClamp(html: string): string {
  const trimmed = html.trim();
  if (!trimmed || trimmed.includes(PREVIEW_SNAPSHOT_CLAMP_ATTR)) {
    return html;
  }

  const style = `<style ${PREVIEW_SNAPSHOT_CLAMP_ATTR}>
  html{height:100%!important;overflow:hidden!important;}
  body{height:100%!important;margin:0!important;box-sizing:border-box!important;overflow:hidden!important;}
</style>`;

  if (/<head[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<head([^>]*)>/i, `<head$1>${style}`);
  }
  if (/<html[\s>]/i.test(trimmed)) {
    return trimmed.replace(/(<html[^>]*>)/i, `$1<head>${style}</head>`);
  }
  if (/<body[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<body([^>]*)>/i, `<body$1>${style}`);
  }
  return `<!DOCTYPE html><html><head>${style}</head><body>${trimmed}</body></html>`;
}
