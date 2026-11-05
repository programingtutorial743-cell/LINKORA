// Shared Firebase initialization. Firebase Web API keys identify a project; never put service credentials here.
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig={apiKey:'AIzaSyDpDVLFNS2-4yfeiGpNss6Bddr2H1DNLSs',authDomain:'linkora-d6e85.firebaseapp.com',projectId:'linkora-d6e85',storageBucket:'linkora-d6e85.firebasestorage.app',messagingSenderId:'912435689988',appId:'1:912435689988:web:bc4bb95c5f39cb915c9351',measurementId:'G-VSL0GVV2KV'};
export const app=getApps().length?getApps()[0]:initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
// Analytics is intentionally not initialized until analytics consent and supported-browser checks are implemented.
