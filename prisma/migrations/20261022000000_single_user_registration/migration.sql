-- Enforce the account limit even for simultaneous requests and other write paths.
CREATE UNIQUE INDEX "Admin_single_account_key" ON "Admin" ((true));

CREATE TABLE "_owly_deployment_flags" (
  "key" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
