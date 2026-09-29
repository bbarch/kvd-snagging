// 1. Paste the config from Firebase console > Project settings > Your apps > Web app.
//    These values are not secret; access is controlled by firestore.rules.
export const FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

export const APP = {
  // People with these emails are always admins (must sign in with Google or a verified email).
  // Keep this list the same as ADMIN_EMAILS in firestore.rules and storage.rules.
  adminEmails: ["ab@bbarch.net"],
  // false: photos are compressed and kept in Firestore (works on the free Spark plan).
  // true: full-size photos go to Cloud Storage (needs the Blaze plan; deploy storage.rules first).
  useStorage: false,
};
