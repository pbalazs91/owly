-- Reserve one unique slot for the bootstrap administrator and one for signup.
-- Existing account names are not changed. Both slots are enforced for all writes.
DROP INDEX IF EXISTS "Admin_single_account_key";
CREATE UNIQUE INDEX "Admin_two_accounts_key" ON "Admin"
  ((CASE WHEN "username" = 'balazs' THEN 1 ELSE 2 END));
