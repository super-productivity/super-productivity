/**
 * Utilities for encoding/decoding marker with content hash
 * This allows tracking content changes without modifying common Task model
 */

/**
 * Simple hash function for content comparison
 */
export const hashCode = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
};

/**
 * Encode marker and content hash into a single string
 */
export const encodeMarkerWithHash = (marker: string | null, content: string): string => {
  return JSON.stringify({
    marker: marker || 'TODO',
    contentHash: hashCode(content),
  });
};

/**
 * Decode marker from encoded string (backwards compatible)
 */
export const decodeMarker = (
  issueMarker: string | null | undefined,
): {
  marker: string;
  contentHash: number | null;
} => {
  if (!issueMarker) {
    return { marker: 'TODO', contentHash: null };
  }

  // Try to parse as JSON (new format)
  try {
    const parsed = JSON.parse(issueMarker);
    if (parsed.marker && typeof parsed.contentHash === 'number') {
      return { marker: parsed.marker, contentHash: parsed.contentHash };
    }
  } catch {
    // Not JSON - old format (plain marker string)
  }

  // Old format: plain marker string
  return { marker: issueMarker, contentHash: null };
};
