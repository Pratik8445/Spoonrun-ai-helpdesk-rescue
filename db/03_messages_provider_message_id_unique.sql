-- Repeated provider deliveries were stored as duplicate inbound messages because
-- provider_message_id was not unique. Keep one row per provider delivery.
-- Agent replies/notes leave provider_message_id NULL; PostgreSQL allows many NULLs
-- under a UNIQUE constraint.

DELETE FROM messages a
    USING messages b
WHERE a.provider_message_id IS NOT NULL
  AND a.provider_message_id = b.provider_message_id
  AND a.id > b.id;

ALTER TABLE messages
    ADD CONSTRAINT messages_provider_message_id_key UNIQUE (provider_message_id);
