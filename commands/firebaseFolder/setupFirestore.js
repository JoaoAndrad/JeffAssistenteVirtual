const db = require("./firebase");

// Criar um documento na coleção "users"
async function createUser() {
    try {
        const userId = "userId2"; // Alinhar o ID do documento com o campo "id"
        const userRef = db.collection("users").doc(userId);
        await userRef.set({
            id: userId,
            name: "Rebeca",
            createdAt: new Date().toISOString(),
            accounts: [
                {
                    id: "3",
                    name: "Nubank",
                    type: "Conta Corrente",
                    balance: 120.00,
                    currency: "BRL",
                    createdAt: new Date().toISOString()
                }
            ]
        });
        console.log(`✅ Usuário criado com sucesso! ID: ${userId}`);
        return userId; // Retornar o ID do usuário criado
    } catch (error) {
        console.error("❌ Erro ao criar usuário:", error);
        throw error; // Lançar o erro para interromper a execução
    }
}

// Criar um documento na coleção "transactions"
async function createTransaction(userId) {
    try {
        const transactionId = "transactionId2"; // ID da transação
        const transactionRef = db.collection("transactions").doc(transactionId);
        await transactionRef.set({
            id: transactionId,
            userId: userId, // Associar a transação ao usuário criado
            type: "despesa",
            value: 50.00,
            category: "transporte",
            description: "Uber moto",
            account: "Nubank",
            date: new Date().toISOString()
        });
        console.log(`✅ Transação criada com sucesso! ID: ${transactionId}`);
    } catch (error) {
        console.error("❌ Erro ao criar transação:", error);
        throw error; // Lançar o erro para interromper a execução
    }
}

// Função principal para executar as operações sequencialmente
async function setupFirestore() {
    try {
        console.log("Chamando createUser...");
        const userId = await createUser();
        console.log("Usuário criado com ID:", userId);

        console.log("Chamando createTransaction...");
        await createTransaction(userId);
        console.log("Transação criada com sucesso!");

        console.log("✅ Configuração do Firestore concluída com sucesso!");
    } catch (error) {
        console.error("❌ Erro durante a configuração do Firestore:", error);
    }
}

module.exports = { setupFirestore };