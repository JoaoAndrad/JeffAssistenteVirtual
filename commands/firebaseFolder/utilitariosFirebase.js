const db = require("./firebase");
const { simularDigitar } = require("../utilitariosComandos");


// Buscar contas do usuário
async function getAccountsFromFirebase(userId) {
    try {
        const userDoc = await db.collection("users").doc(userId).get();
        if (!userDoc.exists) {
            throw new Error(`Usuário com ID "${userId}" não encontrado no Firebase.`);
        }
        const userData = userDoc.data();
        return userData.accounts || [];
    } catch (error) {
        console.error("❌ Erro ao buscar contas no Firebase:", error);
        throw error;
    }
}

// Adicionar transação no Firebase
async function addTransaction(data) {
    try {
        const transactionId = db.collection("transactions").doc().id; // Gera um ID único
        const transaction = {
            id: transactionId,
            date: data[0],
            type: data[1],
            value: parseFloat(data[2]),
            category: data[3] || "Não especificada",
            description: data[4] || "Sem descrição",
            account: data[5],
            tag: data[6] || null,
            userId: data[7],
        };
        Object.keys(transaction).forEach(key => {
            if (transaction[key] === undefined) {
                delete transaction[key];
            }
        });
        const transactionRef = db.collection("transactions").doc(transactionId);
        await transactionRef.set(transaction);
        console.log(`✅ Transação salva no Firebase com sucesso! ID: ${transactionId}`);
    } catch (error) {
        console.error("❌ Erro ao salvar transação no Firebase:", error);
        throw error;
    }
}

// Adicionar ou atualizar categoria no Firebase
async function addCategory(data) {
    try {
        const [id, category, budget, type, senderNumber] = data;
        const categoriesRef = db.collection("categories");
        // Verifica se já existe categoria para o usuário
        const snapshot = await categoriesRef
            .where("name", "==", category)
            .where("userId", "==", senderNumber)
            .get();
        if (!snapshot.empty) {
            // Atualizar categoria existente
            const docRef = categoriesRef.doc(snapshot.docs[0].id);
            await docRef.update({
                budget: budget || snapshot.docs[0].data().budget,
                type: type || snapshot.docs[0].data().type
            });
            console.log(`[LOG] Categoria "${category}" atualizada no Firebase para o usuário ${senderNumber}`);
        } else {
            // Adicionar nova categoria
            const newDoc = categoriesRef.doc();
            await newDoc.set({
                id: newDoc.id,
                name: category,
                budget: budget || "",
                type: type || "",
                userId: senderNumber
            });
            console.log(`[LOG] Nova categoria adicionada no Firebase: ${category} (${newDoc.id})`);
        }
    } catch (error) {
        console.error("❌ Erro ao adicionar/atualizar categoria no Firebase:", error);
        throw error;
    }
}

// Adicionar conta ao perfil do usuário
async function addProfile(data) {
    try {
        const [userId, , accountId, accountName, accountType, accountBalance, currency, description, creationDate] = data;
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new Error(`Usuário com ID "${userId}" não encontrado no Firebase.`);
        }
        const userData = userDoc.data();
        const accounts = userData.accounts || [];
        accounts.push({
            id: accountId,
            name: accountName,
            type: accountType,
            balance: parseFloat(accountBalance),
            currency,
            description,
            creationDate,
        });
        await userRef.update({ accounts });
        console.log(`[LOG] Nova conta adicionada ao Firebase para o usuário "${userId}": ${JSON.stringify(accounts[accounts.length - 1])}`);
    } catch (error) {
        console.error("❌ Erro ao adicionar a nova conta ao Firebase:", error);
        throw error;
    }
}

// Atualizar saldo de uma conta
async function atualizarSaldoConta(userId, accountId, newBalance) {
    try {
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new Error(`Usuário com ID "${userId}" não encontrado no Firebase.`);
        }
        const userData = userDoc.data();
        const accounts = userData.accounts || [];
        const accountIndex = accounts.findIndex(account => account.id === accountId);
        if (accountIndex === -1) {
            throw new Error(`Conta com ID "${accountId}" não encontrada para o usuário "${userId}".`);
        }
        accounts[accountIndex].balance = newBalance;
        await userRef.update({ accounts });
        console.log(`✅ Saldo atualizado no Firebase para a conta "${accounts[accountIndex].name}" do usuário "${userId}".`);
    } catch (error) {
        console.error("❌ Erro ao atualizar saldo no Firebase:", error);
        throw error;
    }
}

// Atualizar saldo após transação
async function handleTransactionCompletion(sock, chatId, senderNumber, accountId, transactionType, transactionValue) {
    console.log(`[LOG] Valores recebidos: \n    Sender: ${senderNumber}, \n    Conta: ${accountId}, \n    Tipo de Transação: ${transactionType}, \n    Valor da Transação: ${transactionValue}`);
    try {
        const userRef = db.collection("users").doc(senderNumber);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new Error(`Usuário com ID "${senderNumber}" não encontrado no Firebase.`);
        }
        const userData = userDoc.data();
        const accounts = userData.accounts || [];
        const account = accounts.find(account => account.id === accountId);
        if (!account) {
            throw new Error(`Conta com ID "${accountId}" não encontrada para o perfil "${senderNumber}".`);
        }
        const currentBalance = parseFloat(account.balance) || 0;
        const newBalance = transactionType === "despesa"
            ? currentBalance - transactionValue
            : currentBalance + transactionValue;
        account.balance = newBalance;
        await userRef.update({ accounts });
        const formattedAccountBalance = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(newBalance);
        console.log(`[LOG] Saldo da conta "${account.name}" atualizado para ${formattedAccountBalance} para o perfil "${senderNumber}"`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `✅ Saldo atualizado com sucesso!\n\n💳 Conta: ${account.name}\n💰 Novo Saldo: ${formattedAccountBalance}`
        });
    } catch (error) {
        console.error(`[ERRO] Falha ao processar a atualização do saldo para o perfil "${senderNumber}": ${error.message}`);
        await sock.sendMessage(chatId, {
            text: "⚠️ Ocorreu um erro ao *atualizar o saldo*.\n\n🔍 Verifique os *logs* para mais detalhes."
        });
    }
}

module.exports = { getAccountsFromFirebase, addTransaction, addCategory, addProfile, atualizarSaldoConta, handleTransactionCompletion };