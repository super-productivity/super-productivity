-- Add is_payload_encrypted column to operations table
ALTER TABLE "operations" ADD COLUMN "is_payload_encrypted" BOOLEAN NOT NULL DEFAULT false;
