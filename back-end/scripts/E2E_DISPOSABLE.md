# Disposable E2E safety contract

The disposable harness accepts only `127.0.0.1:3307`, database
`job_connect_e2e_disposable`, runner `job_connect_e2e_runner`, and migrator
`job_connect_e2e_migrator`. It never treats `DATABASE_URL` as input.

Commands are deliberately separate. Provisioning is external and requires its
own approval. `e2e:db:identity` is the pre-migration check. `e2e:migrate` also
requires `E2E_MIGRATION_APPROVED=job_connect_e2e_disposable`. All reset, seed,
server, QA-test, and Playwright operations require a canonical 22-migration
attestation plus the disposable storage marker.

The intended approved order is:

1. provision the isolated MySQL service/database and scoped users;
2. initialize storage and run the identity-only database guard;
3. run the separately approved migration launcher;
4. run the canonical guard, reset/seed, and explicit server launchers;
5. start the frontend explicitly and run the frontend command
   `npm run test:e2e:disposable` (the launcher strips all database credentials
   before Playwright starts);
6. run the disposable QA suite;
7. stop processes, snapshot/reconcile, and clean up through guarded commands.

No command in this document is authorized merely by this file. QA-03B2 must
approve provisioning and every destructive execution first.
