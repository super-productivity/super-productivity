CREATE TABLE "operation_affected_entities" (
  "id" BIGSERIAL PRIMARY KEY,
  "operation_id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "server_seq" INTEGER NOT NULL,
  CONSTRAINT "operation_affected_entities_operation_id_fkey"
    FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "operation_affected_entities_operation_id_entity_type_entity_id_key"
  ON "operation_affected_entities"("operation_id", "entity_type", "entity_id");

CREATE INDEX "operation_affected_entities_user_id_entity_type_entity_id_server_seq_idx"
  ON "operation_affected_entities"("user_id", "entity_type", "entity_id", "server_seq");

INSERT INTO "operation_affected_entities"
  ("operation_id", "user_id", "entity_type", "entity_id", "server_seq")
SELECT "id", "user_id", "entity_type", "entity_id", "server_seq"
FROM "operations"
WHERE "entity_id" IS NOT NULL
ON CONFLICT DO NOTHING;

WITH completion_payloads AS (
  SELECT
    "id",
    "user_id",
    "server_seq",
    COALESCE("payload"->'actionPayload', "payload") AS "action_payload"
  FROM "operations"
  WHERE "action_type" IN ('[Task Shared] completeProject', '[Project] Complete Project')
),
completion_refs AS (
  SELECT
    "id",
    "user_id",
    "server_seq",
    CASE
      WHEN jsonb_typeof("action_payload"->'taskIdsToMarkDone') = 'array'
      THEN "action_payload"->'taskIdsToMarkDone'
      ELSE '[]'::jsonb
    END AS "task_ids_to_mark_done",
    CASE
      WHEN jsonb_typeof("action_payload"->'topLevelTaskIdsToMoveToInbox') = 'array'
      THEN "action_payload"->'topLevelTaskIdsToMoveToInbox'
      ELSE '[]'::jsonb
    END AS "top_level_task_ids_to_move_to_inbox",
    CASE
      WHEN jsonb_typeof("action_payload"->'taskIdsToMoveToInbox') = 'array'
      THEN "action_payload"->'taskIdsToMoveToInbox'
      ELSE '[]'::jsonb
    END AS "task_ids_to_move_to_inbox",
    CASE
      WHEN jsonb_typeof("action_payload"->'taskIdsToMarkUndone') = 'array'
      THEN "action_payload"->'taskIdsToMarkUndone'
      ELSE '[]'::jsonb
    END AS "task_ids_to_mark_undone"
  FROM completion_payloads
)
INSERT INTO "operation_affected_entities"
  ("operation_id", "user_id", "entity_type", "entity_id", "server_seq")
SELECT
  "id",
  "user_id",
  'TASK',
  task_refs."task_id",
  "server_seq"
FROM completion_refs,
LATERAL jsonb_array_elements_text(
  "task_ids_to_mark_done" ||
  "top_level_task_ids_to_move_to_inbox" ||
  "task_ids_to_move_to_inbox" ||
  "task_ids_to_mark_undone"
) AS task_refs("task_id")
ON CONFLICT DO NOTHING;

WITH completion_payloads AS (
  SELECT
    "id",
    "user_id",
    "server_seq",
    COALESCE("payload"->'actionPayload', "payload") AS "action_payload"
  FROM "operations"
  WHERE "action_type" IN ('[Task Shared] completeProject', '[Project] Complete Project')
),
completion_move_refs AS (
  SELECT
    "id",
    "user_id",
    "server_seq",
    CASE
      WHEN jsonb_typeof("action_payload"->'topLevelTaskIdsToMoveToInbox') = 'array'
      THEN jsonb_array_length("action_payload"->'topLevelTaskIdsToMoveToInbox')
      ELSE 0
    END AS "top_level_move_count",
    CASE
      WHEN jsonb_typeof("action_payload"->'taskIdsToMoveToInbox') = 'array'
      THEN jsonb_array_length("action_payload"->'taskIdsToMoveToInbox')
      ELSE 0
    END AS "move_count",
    CASE
      WHEN jsonb_typeof("action_payload"->'taskIdsToMarkDone') = 'array'
      THEN jsonb_array_length("action_payload"->'taskIdsToMarkDone')
      ELSE 0
    END AS "mark_done_count"
  FROM completion_payloads
)
INSERT INTO "operation_affected_entities"
  ("operation_id", "user_id", "entity_type", "entity_id", "server_seq")
SELECT "id", "user_id", 'PROJECT', 'INBOX_PROJECT', "server_seq"
FROM completion_move_refs
WHERE "top_level_move_count" > 0 OR "move_count" > 0
UNION ALL
SELECT "id", "user_id", 'TAG', 'TODAY', "server_seq"
FROM completion_move_refs
WHERE "mark_done_count" > 0
ON CONFLICT DO NOTHING;
