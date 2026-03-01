# SuperSync Sync Flow — Mermaid Chart

Visual overview of the main sync decision tree. For full details see [supersync-scenarios.md](./supersync-scenarios.md).

```mermaid
flowchart TD
    START([Sync Triggered]) --> DL[Download remote ops]
    DL --> HAS_OPS{Remote ops found?}

    HAS_OPS -->|No| FRESH{Is fresh client?}
    HAS_OPS -->|Yes| DECRYPT{Encrypted?}

    %% Fresh client path
    FRESH -->|No| UPLOAD
    FRESH -->|Yes| LOCAL_DATA{Has local data?}
    LOCAL_DATA -->|No| CONFIRM[Confirm dialog:<br/>Download remote?]
    LOCAL_DATA -->|Yes| CONFLICT_DLG[Conflict dialog:<br/>USE_LOCAL / USE_REMOTE / CANCEL]
    CONFIRM -->|OK| APPLY
    CONFIRM -->|Cancel| CANCELLED([Sync Cancelled])
    CONFLICT_DLG -->|Use Local| FORCE_UP[Force upload local state<br/>SYNC_IMPORT]
    CONFLICT_DLG -->|Use Remote| FORCE_DL[Force download<br/>from seq 0]
    CONFLICT_DLG -->|Cancel| CANCELLED

    %% Decryption path
    DECRYPT -->|Yes| DECRYPT_OK{Decryption succeeds?}
    DECRYPT -->|No| PROCESS
    DECRYPT_OK -->|Yes| PROCESS
    DECRYPT_OK -->|No| PWD_DLG[Password dialog:<br/>Save & Sync / Use Local Data]
    PWD_DLG -->|Save & Sync| START
    PWD_DLG -->|Use Local| FORCE_UP

    %% Processing remote ops
    PROCESS[Process remote ops] --> IS_IMPORT{Contains SYNC_IMPORT?}
    IS_IMPORT -->|Yes| PENDING{Has local pending ops?}
    IS_IMPORT -->|No| CONFLICT_CHK

    PENDING -->|No| MEANINGFUL{Has meaningful<br/>local data?}
    MEANINGFUL -->|Yes| IMPORT_DLG[Conflict dialog:<br/>import reason shown,<br/>Use Server Data recommended]
    MEANINGFUL -->|No| APPLY_IMPORT[Apply full state replacement]
    IMPORT_DLG -->|Use Server| FORCE_DL
    IMPORT_DLG -->|Use Local| FORCE_UP
    IMPORT_DLG -->|Cancel| CANCELLED
    PENDING -->|Yes| CONFLICT_DLG

    %% Conflict detection
    CONFLICT_CHK{Vector clock conflict?} -->|CONCURRENT| LWW[Auto-resolve LWW<br/>later timestamp wins]
    CONFLICT_CHK -->|No conflict| APPLY

    LWW --> APPLY[Apply ops to NgRx store]
    APPLY_IMPORT --> UPLOAD

    %% Upload phase
    APPLY --> UPLOAD[Upload pending local ops]
    UPLOAD --> REJECTED{Server rejects any?}

    REJECTED -->|No| PIGGYBACK[Process piggybacked ops]
    REJECTED -->|CONFLICT_CONCURRENT| REDOWNLOAD[Re-download & resolve]
    REJECTED -->|VALIDATION_ERROR| PERM_REJECT[Op permanently rejected]
    REJECTED -->|Payload too large| ALERT[Alert dialog, sync stops]

    REDOWNLOAD --> CONFLICT_CHK
    PIGGYBACK --> ENCRYPT_CHK

    %% Post-sync encryption check
    ENCRYPT_CHK{SuperSync without<br/>encryption?}
    ENCRYPT_CHK -->|Yes| ENC_PROMPT[Encryption prompt:<br/>Set password or disable sync]
    ENCRYPT_CHK -->|No| IN_SYNC([IN_SYNC ✓])
    ENC_PROMPT -->|Password set| ENABLE_ENC[Enable encryption:<br/>delete server → upload encrypted]
    ENC_PROMPT -->|Cancel| DISABLE([Sync Disabled])
    ENABLE_ENC --> IN_SYNC

    FORCE_UP --> IN_SYNC
    FORCE_DL --> IN_SYNC
    PERM_REJECT --> ERROR([ERROR])
    ALERT --> ERROR

    %% Styling
    classDef success fill:#2d6,stroke:#1a4,color:#fff
    classDef error fill:#d33,stroke:#a11,color:#fff
    classDef cancel fill:#888,stroke:#555,color:#fff
    classDef dialog fill:#48f,stroke:#26d,color:#fff

    class IN_SYNC success
    class ERROR error
    class CANCELLED,DISABLE cancel
    class CONFIRM,CONFLICT_DLG,IMPORT_DLG,PWD_DLG,ENC_PROMPT dialog
```

**Legend:**

- 🟢 Green = success states
- 🔴 Red = error states
- 🔵 Blue = user-facing dialogs
- ⚫ Gray = cancelled/disabled
