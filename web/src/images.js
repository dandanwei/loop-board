// Helpers for embedding images into markdown as base64 data URIs.
//
// The board stores descriptions as plain markdown text and renders them with
// @uiw/react-md-editor, so a dropped image just becomes an `![alt](data:...)`
// node — no upload endpoint or file storage needed.

export const MAX_IMAGE_MB = 5;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

export function isImageFile(file) {
  return !!file && typeof file.type === 'string' && file.type.startsWith('image/');
}

// True when a drag/clipboard payload carries files (vs. plain text/URLs).
export function hasFiles(dataTransfer) {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

// Pull image File objects out of a DataTransfer or ClipboardData.
export function imageFilesFrom(transfer) {
  if (!transfer) return [];
  if (transfer.files && transfer.files.length) {
    return Array.from(transfer.files).filter(isImageFile);
  }
  if (transfer.items && transfer.items.length) {
    return Array.from(transfer.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
  }
  return [];
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export function imageMarkdown(name, dataUrl) {
  const alt = (name || 'image').replace(/[[\]]/g, '');
  return `![${alt}](${dataUrl})`;
}

// Append one or more image-markdown snippets to an existing markdown string,
// keeping each on its own line.
export function appendToMarkdown(existing, snippets) {
  const blocks = Array.isArray(snippets) ? snippets : [snippets];
  const joined = blocks.join('\n');
  if (!existing) return `${joined}\n`;
  const sep = existing.endsWith('\n') ? '' : '\n\n';
  return `${existing}${sep}${joined}\n`;
}
