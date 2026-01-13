/**
 * @deprecated This file is no longer used. Issue provider deletion archive cleanup has
 * been consolidated into ArchiveOperationHandlerEffects for unified handling of both
 * local and remote operations.
 *
 * @see ArchiveOperationHandler._handleDeleteIssueProvider
 * @see ArchiveOperationHandler._handleDeleteIssueProviders
 * @see ArchiveOperationHandlerEffects at:
 * src/app/op-log/apply/archive-operation-handler.effects.ts
 *
 * All archive-affecting operations are now routed through ArchiveOperationHandler,
 * which is the SINGLE SOURCE OF TRUTH for archive storage operations.
 *
 * This file is kept temporarily for reference and should be deleted in a future cleanup.
 */
