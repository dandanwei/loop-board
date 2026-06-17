// Helpers for adding dropped/pasted images to a markdown field.
//
// Images are uploaded to the board server, which saves them under
// data/uploads/ and returns a URL plus the absolute local path. We then insert
// a markdown image (rendered by @uiw/react-md-editor via the URL) followed by
// the local path as a caption, so an agent working the task can open the file.

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

// One image block: the rendered image (by URL) plus its local path as a
// caption in backticks, so it's both visible in the board and readable by an
// agent that opens the raw markdown.
export function imageBlock({ name, url, path }) {
  const alt = (name || 'image').replace(/[[\]]/g, '');
  const caption = path ? `\n\n\`${path}\`` : '';
  return `![${alt}](${url})${caption}`;
}

// Append one or more blocks to an existing markdown string, separated by a
// blank line.
export function appendToMarkdown(existing, blocks) {
  const list = Array.isArray(blocks) ? blocks : [blocks];
  const joined = list.join('\n\n');
  if (!existing) return `${joined}\n`;
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${joined}\n`;
}
