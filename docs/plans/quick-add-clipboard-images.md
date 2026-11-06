# Quick Add clipboard images

Requested for a personal capture workflow: attach screenshots while entering a
task, without opening its detail panel. The accepted mockup uses 72×48 thumbnails,
per-image removal, and a gallery preview. No setting or new upload service.

## Prior art (vendor documentation checked November 2026)

| App                                                                                               | Existing image interaction                      | Decision for Quick Add                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| [TickTick](https://help.ticktick.com/articles/7055792921664028672)                                | Paste images into task details                  | Keep explicit clipboard paste; extend capture before task creation          |
| [Todoist](https://www.todoist.com/help/articles/add-comments-or-files-to-tasks-in-todoist-CwiA50) | Files live in task comments                     | Keep attachments separate from titles; do not add comments or collaboration |
| [Notion](https://www.notion.com/en-gb/help/images-files-and-media)                                | Images are page blocks or file/media properties | Keep direct visual feedback; do not build a block editor                    |

## Implementation and limits

- Reuse ClipboardImageService and the existing task attachments field; include
  attachments in the normal task creation action, without new synced fields.
- Keep an in-memory image draft across popup lifetimes. Reload clears the draft.
- Paste images only in create-mode title input. Text/HTML takes precedence for
  mixed clipboard payloads; existing note paste keeps its Markdown behavior.
- Append multiple images in paste order, disable submission while saving, keep
  failed saves out of task attachments, and show an error if storage fails.
- Use a document-scoped Material dialog for preview, with normal focus restoration
  and Escape dismissal. No image resizing, new dependencies or network uploads.
- Local image bytes retain the existing cross-device limitation: task sync copies
  attachment metadata, not clipboard-image files. Removing a draft retains the
  file for cleanup through the existing image manager.

## Verification

Service tests cover repeated and mixed pastes, save failures, and removing pending
images. Component tests verify submission includes images and blocks pending
saves. A focused browser test exercises actual image storage, thumbnails, preview
navigation, Escape, removal and task creation.
