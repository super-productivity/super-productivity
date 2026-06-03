/**
 * Pure decision logic for the Node.js execution consent dialog.
 *
 * Given the dialog result, returns:
 *  - granted: whether the plugin may run nodeExecution scripts now
 *  - consentToStore: the value to persist for future startups
 *
 * Side effects (dialog, persistence) stay in PluginService; this function is
 * pure so it can be unit-tested directly without the full DI graph.
 */
export interface NodeExecutionConsentDecision {
  granted: boolean;
  consentToStore: boolean;
}

export interface NodeExecutionConsentDialogResult {
  granted: boolean;
  remember?: boolean;
}

export const decideNodeExecutionConsent = (
  dialogResult: NodeExecutionConsentDialogResult | null | undefined,
): NodeExecutionConsentDecision => ({
  granted: !!dialogResult?.granted,
  consentToStore: !!(dialogResult?.granted && dialogResult.remember),
});
