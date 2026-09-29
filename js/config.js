// 1. Paste the config from Firebase console > Project settings > Your apps > Web app.
//    These values are not secret; access is controlled by firestore.rules.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAC6q8mYy0MRRn07U9HaCw3wIr5Ims0eAY",
  authDomain: "kvd-snagging-ab-28586-4a333.firebaseapp.com",
  projectId: "kvd-snagging-ab-28586-4a333",
  storageBucket: "kvd-snagging-ab-28586-4a333.firebasestorage.app",
  messagingSenderId: "514303187965",
  appId: "1:514303187965:web:c95f6c8425cf4f81c19794",
};

export const APP = {
  // People with these emails are always admins (must sign in with Google or a verified email).
  // Keep this list the same as ADMIN_EMAILS in firestore.rules and storage.rules.
  adminEmails: ["ab@bbarch.net"],
  // false: photos are compressed and kept in Firestore (works on the free Spark plan).
  // true: full-size photos go to Cloud Storage (needs the Blaze plan; deploy storage.rules first).
  useStorage: false,
};
