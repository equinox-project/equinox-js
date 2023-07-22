export const compose = (category: string, id: string) => `${category}-${id}`;

export function parseCategoryAndId(streamName: string) {
  const idx = streamName.indexOf('-');
  return [streamName.slice(0, idx), streamName.slice(idx + 1)];
}

export function parseCategory(streamName: string) {
  const idx = streamName.indexOf('-');
  return streamName.slice(0, idx);
}

export function parseIds(streamName: string) {
  const idx = streamName.indexOf('-');
  return streamName.slice(idx + 1).split('-');
}

export function parseId(streamName: string) {
  const idx = streamName.indexOf('-');
  return streamName.slice(idx + 1);
}

