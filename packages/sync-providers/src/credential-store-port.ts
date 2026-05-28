export type CredentialChangeHandler<PID extends string, TPrivateCfg> = (data: {
  providerId: PID;
  privateCfg: TPrivateCfg;
}) => void;

export interface SyncCredentialStorePort<PID extends string, TPrivateCfg> {
  load(): Promise<TPrivateCfg | null>;
  setComplete(privateCfg: TPrivateCfg): Promise<void>;
  updatePartial(updates: Partial<TPrivateCfg>): Promise<void>;
  upsertPartial(updates: Partial<TPrivateCfg>): Promise<void>;
  clear(): Promise<void>;
  onConfigChange?(callback: CredentialChangeHandler<PID, TPrivateCfg>): void;
}
