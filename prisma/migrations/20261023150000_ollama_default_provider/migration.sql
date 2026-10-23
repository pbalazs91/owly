ALTER TABLE "Settings" ALTER COLUMN "aiProvider" SET DEFAULT 'ollama';
ALTER TABLE "Settings" ALTER COLUMN "aiModel" SET DEFAULT 'llama3.2:3b';

UPDATE "Settings"
SET "aiProvider" = 'ollama', "aiModel" = 'llama3.2:3b'
WHERE "id" = 'default' AND "aiProvider" = 'openai' AND "aiApiKey" = '';
