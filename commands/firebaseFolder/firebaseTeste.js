// filepath: testFirebase.js
const db = require("./commands/firebaseFolder/firebase");

async function testConnection() {
    try {
        const docRef = db.collection("test").doc("testDoc");
        await docRef.set({ message: "Conexão bem-sucedida!" });
        console.log("🔥 Dados enviados ao Firebase com sucesso!");
    } catch (error) {
        console.error("Erro ao conectar ao Firebase:", error);
    }
}

testConnection();