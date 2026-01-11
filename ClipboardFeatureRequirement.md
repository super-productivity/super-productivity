# Clipboard Image Paste Feature for Markdown Editor

Add a feature to allow users to paste images from clipboard into the markdown editor.

---

## Platform-Specific Implementation

### Electron (Desktop)

Two clipboard scenarios to handle:

1. **Image content in clipboard** (e.g., screenshot, copied image data):

   - Create an image file in the local user data folder (via `getUserDataPath()`)
   - Reference the image using `file://` protocol path

2. **Image file in clipboard** (e.g., copied file from explorer):
   - Extract the file path directly from clipboard
   - Reference the image using the local file path

**Storage location:** `{userData}/clipboard-images/` directory, this should be customizable in settings.

---

### Web Application (Browser)

Since Super Productivity does **not have a backend server** to store uploaded images, here are some considerations:

- When pasted, store them in **IndexedDB**.
- Create custom protocol URL and use Service Workers to serve images.
- Custom protocol should be `supprod://clipboard-images/{unique-id}`.
- For HTML: `<img src="supprod://clipboard-images/{unique-id}">`
- For Markdown: `![pasted image](supprod://clipboard-images/{unique-id})`.
- Size limitations should be enforced (e.g., max 2MB per image).

**Browser support required:**

- Google Chrome
- Mozilla Firefox
- Apple Safari
- Microsoft Edge
- Opera

---

### Extra Considerations

In markdown, we should support image sizing syntax like `![pasted image](supprod://clipboard-images/{unique-id} =200x150)` to allow users to specify image dimensions.

## Implementation Tasks

### Phase 1: Core Clipboard Handling

- [ ] Detect image paste events in markdown editor
- [ ] Extract image data from clipboard (both image content and file)
- [ ] Platform detection (Electron vs Web)
- [ ] Generate unique IDs for pasted images (UUID or timestamp-based)

### Phase 2: Electron Implementation

- [ ] Add settings option for clipboard images storage location
- [ ] Create `clipboard-images` directory in configured location (default: user data folder)
- [ ] Save pasted images with unique filenames
- [ ] Insert markdown image reference with `file://` path
- [ ] Handle clipboard file references (copy file vs reference original)

### Phase 3: Web Implementation - Storage Layer

- [ ] Create IndexedDB store for clipboard images (key: unique-id, value: Blob/ArrayBuffer)
- [ ] Implement image CRUD operations (create, read, delete)
- [ ] Add image size validation (max 2MB per image)
- [ ] Implement image compression for oversized images (optional)

### Phase 4: Web Implementation - Service Worker

- [ ] Register Service Worker for `supprod://` protocol handling
- [ ] Implement fetch handler to intercept `supprod://clipboard-images/{id}` requests
- [ ] Retrieve image from IndexedDB and return as Response
- [ ] Handle missing images gracefully (placeholder or error image)

### Phase 5: Markdown Editor Integration

- [ ] Extend markdown renderer to support `supprod://` protocol in image src
- [ ] Support image sizing syntax: `![alt](url =WIDTHxHEIGHT)`
- [ ] Add image resize handles in editor (optional enhancement)
- [ ] Preview support for pasted images

### Phase 6: Data Sync Considerations

- [ ] Include clipboard images in backup/export
- [ ] Handle image sync with Dropbox/WebDAV providers
- [ ] Implement image cleanup for orphaned images (not referenced in any note)

### Phase 7: Polish & Testing

- [ ] Add progress indicator for large images
- [ ] Error handling and user notifications
- [ ] Unit tests for clipboard handling and IndexedDB storage
- [ ] Unit tests for Service Worker image serving
- [ ] E2E tests for paste functionality (Electron and Web)
