-- Release the prior migration's index lock before draining existing entries.
SET LOCAL statement_timeout = '300s';
SELECT gin_clean_pending_list('operations_entity_ids_gin');
