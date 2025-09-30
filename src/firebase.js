import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, GithubAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCRVGx8k52WELbFv6jrwC9vElcbE885oUM",
  authDomain: "mma-perspectives-u4.firebaseapp.com",
  databaseURL: "https://mma-perspectives-u4-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mma-perspectives-u4",
  storageBucket: "mma-perspectives-u4.firebasestorage.app",
  messagingSenderId: "241966145630",
  appId: "1:241966145630:web:6a0c341cca439e038cd4cf",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const githubProvider = new GithubAuthProvider();
githubProvider.addScope("read:user");