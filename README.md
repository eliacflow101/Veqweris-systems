# Veqweris Systems

## Stage 2 setup

1. Copy `.env.example` to `.env.local`. The supplied Firebase web configuration is already filled in; add the Firebase Admin SDK service-account values before using server sessions.
2. Enable Email/Password in Firebase Authentication.
3. From this directory, run `firebase deploy --only firestore:rules` after authenticating with the Firebase CLI. `.firebaserc` targets the `veqweris-systems` `veqweris-systems-feb94` project and `firebase.json` points to `firestore.rules`.
4. Run `npm run typecheck` and `npm run build`.

Sign-up creates the institution and owner profile in one Firestore batch. The session endpoint validates Firebase ID tokens and stores the short-lived token in an HTTP-only cookie used by middleware to protect the application shell.

The `NEXT_PUBLIC_FIREBASE_*` values are browser configuration and are not secrets. `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` are server-only credentials and must remain in `.env.local` or the deployment provider's secret configuration.
