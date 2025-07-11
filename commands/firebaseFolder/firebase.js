// filepath: utils/firebase.js
const admin = require("firebase-admin");
const serviceAccount = require("./firebaseUtils/credentials.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://assistente-3cc25.firebaseio.com" // Substitua pelo seu ID do projeto
});

const db = admin.firestore();
module.exports = db;