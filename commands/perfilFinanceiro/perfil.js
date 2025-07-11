const { simularDigitar } = require("../utilitariosComandos");
const { addProfile } = require("../firebaseFolder/utilitariosFirebase");
const moment = require("moment-timezone");
const db = require("../firebaseFolder/firebase");


const estadoPendentePerfil = {}; // Estado para armazenar perfis em criação por chatId

// Função para gerar IDs únicos
const generateUniqueId = () => Math.random().toString(36).substr(2, 9);

async function saveProfileToFirebase(profile, overwrite = false) {
    try {
        const userRef = db.collection("users").doc(profile.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists || overwrite) {
            // Criar ou sobrescrever completamente o perfil
            const newAccounts = profile.contas
                .filter((conta) => conta.nome && conta.saldo !== undefined && conta.tipo) // Validar contas
                .map((conta) => ({
                    id: conta.id,
                    name: conta.nome,
                    type: conta.tipo,
                    balance: conta.saldo,
                    currency: conta.moeda || "BRL",
                    createdAt: conta.dataCriacao || new Date().toISOString(),
                }));

            await userRef.set({
                id: profile.id,
                name: profile.nome,
                createdAt: new Date().toISOString(),
                accounts: newAccounts,
            });

            console.log(`✅ Perfil ${overwrite ? "sobrescrito" : "criado"} no Firebase com sucesso! ID: ${profile.id}`);
            return;
        }

        // Atualizar o perfil sem sobrescrever
        const existingAccounts = userDoc.data().accounts || [];
        const newAccounts = profile.contas
            .filter((conta) => conta.nome && conta.saldo !== undefined && conta.tipo) // Validar contas
            .map((conta) => ({
                id: conta.id,
                name: conta.nome,
                type: conta.tipo,
                balance: conta.saldo,
                currency: conta.moeda || "BRL",
                createdAt: conta.dataCriacao || new Date().toISOString(),
            }));

        // Verificar duplicatas e adicionar apenas contas novas
        const updatedAccounts = [...existingAccounts];
        profile.duplicateAccounts = [];

        newAccounts.forEach((newAccount) => {
            const duplicate = existingAccounts.find((acc) => acc.name === newAccount.name);
            if (duplicate) {
                console.log(`[NOTIFY] Conta duplicada detectada: ${newAccount.name}`);
                profile.duplicateAccounts.push(newAccount.name);
            } else {
                updatedAccounts.push(newAccount);
            }
        });

        await userRef.update({
            name: profile.nome,
            accounts: updatedAccounts,
        });

        console.log(`✅ Perfil atualizado no Firebase com sucesso! ID: ${profile.id}`);

        if (profile.duplicateAccounts.length > 0) {
            console.log(`[NOTIFY] Contas duplicadas não adicionadas: ${profile.duplicateAccounts.join(", ")}`);
        }
    } catch (error) {
        console.error("❌ Erro ao salvar perfil no Firebase:", error);
        throw error;
    }
}

async function tratarCriarPerfil(sock, chatId, messageContent) {
    const senderNumber = chatId.split("@")[0]; // Extrair o número do remetente do chatId

    // Verificar se já existe um estado pendente para o chat
    if (estadoPendentePerfil[chatId]) {
        const profile = estadoPendentePerfil[chatId];

        switch (profile.step) {
            case "alterarPerfil":
                if (messageContent.toLowerCase() === "sim" || messageContent.toLowerCase() === "s") {
                    // Iniciar o fluxo de alteração do perfil
                    profile.step = "perfil";
                    profile.contas = profile.userData.accounts || [];
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "👤 Vamos alterar as informações do seu perfil financeiro.\n\nQual será o *novo nome do perfil*? 📝"
                    });
                } else if (messageContent.toLowerCase() === "não" || messageContent.toLowerCase() === "n" || messageContent.toLowerCase() === "nao") {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "✅ As informações do perfil atual foram mantidas. Se precisar de algo mais, é só me chamar! 😉"
                    });

                    // Remover o estado pendente para evitar loops
                    delete estadoPendentePerfil[chatId];
                } else {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: '🤖 Por favor, responda com *"sim"* ou *"não"* para que eu possa continuar te ajudando. 😉'
                    });
                }
                return;

            case "perfil":
                profile.nome = messageContent;
                profile.step = "adicionarConta";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: `✅ *Perfeito!*\n\nPerfil *"${profile.nome}"* criado com sucesso. 🎉\n\n💳 Gostaria de *adicionar uma conta* agora?\n\nResponda com *"sim"* ou *"não"*.`
                });
                return;

            case "adicionarConta":
                if (messageContent.toLowerCase() === "sim" || messageContent.toLowerCase() === "s") {
                    profile.step = "nomeConta";
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "🏦 Vamos criar uma nova conta!\n\nQual será o *nome da conta*? 💬\n\nEx: C6, Itaú, Dinheiro"
                    });
                } else if (messageContent.toLowerCase() === "não" || messageContent.toLowerCase() === "n" || messageContent.toLowerCase() === "nao") {
                    const userRef = db.collection("users").doc(profile.id);
                    const userDoc = await userRef.get();

                    if (userDoc.exists && userDoc.data().accounts && userDoc.data().accounts.length > 0) {
                        // Perguntar se o usuário deseja sobrescrever ou atualizar
                        profile.step = "escolherAcaoFinal";
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, {
                            text: `❓ Deseja *sobrescrever* todas as informações ou apenas *atualizar* o perfil?\n\nResponda com:\n- *"sobrescrever"* para substituir todas as informações. (Contas antigas serão excluídas permanentemente)\n\n- *"atualizar"* para manter as contas existentes e adicionar as novas.`
                        });
                    } else {
                        // Não há contas existentes, salvar diretamente
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, {
                            text: "✅ *Entendido!* Salvando o perfil... ⏳"
                        });

                        // Salvar o perfil no Firebase
                        await saveProfileToFirebase(profile, false);

                        // Enviar mensagem de sucesso com o resumo do perfil
                        const resumoContas = profile.contas.map((conta) =>
                            `🔹 ${conta.nome} — ${conta.tipo} — Saldo: R$ ${conta.saldo.toFixed(2)}`
                        ).join("\n");

                        const saldoTotal = profile.contas.reduce((total, conta) => total + conta.saldo, 0);

                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, {
                            text: `✅ *Perfil salvo com sucesso!*\n\n📋 *Resumo do Perfil*\n\n👤 Usuário: ${profile.nome}\n\n💳 *Contas:*\n${resumoContas}\n\n💰 *Saldo Total:* R$ ${saldoTotal.toFixed(2)}`
                        });

                        // Finalizar o estado
                        delete estadoPendentePerfil[chatId];
                    }
                } else {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: '🤖 Por favor, responda com *"sim"* ou *"não"* para que eu possa continuar te ajudando. 😉'
                    });
                }
                return;

            case "escolherAcaoFinal":
                if (messageContent.toLowerCase() === "sobrescrever") {
                    profile.overwrite = true;
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "✅ *Entendido!* Todas as contas anteriores serão substituídas. Salvando o perfil... ⏳"
                    });

                    // Salvar o perfil no Firebase
                    await saveProfileToFirebase(profile, true);

                    const resumoContas = profile.contas.map((conta) =>
                        `🔹 ${conta.nome} — ${conta.tipo} — Saldo: R$ ${conta.saldo.toFixed(2)}`
                    ).join("\n");

                    const saldoTotal = profile.contas.reduce((total, conta) => total + conta.saldo, 0);

                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: `✅ *Perfil salvo com sucesso!*\n\n📋 *Resumo do Perfil*\n\n👤 Usuário: ${profile.nome}\n\n💳 *Contas:*\n${resumoContas}\n\n💰 *Saldo Total:* R$ ${saldoTotal.toFixed(2)}`
                    });

                    // Finalizar o estado
                    delete estadoPendentePerfil[chatId];
                } else if (messageContent.toLowerCase() === "atualizar") {
                    profile.overwrite = false;
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "✅ *Entendido!* As contas existentes serão mantidas e as novas serão adicionadas. Salvando o perfil... ⏳"
                    });

                    // Salvar o perfil no Firebase
                    await saveProfileToFirebase(profile, false);

                    const resumoContas = profile.contas.map((conta) =>
                        `🔹 ${conta.nome} — ${conta.tipo} — Saldo: R$ ${conta.saldo.toFixed(2)}`
                    ).join("\n");

                    const saldoTotal = profile.contas.reduce((total, conta) => total + conta.saldo, 0);

                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: `✅ *Perfil salvo com sucesso!*\n\n📋 *Resumo do Perfil*\n\n👤 Usuário: ${profile.nome}\n\n💳 *Contas:*\n${resumoContas}\n\n💰 *Saldo Total:* R$ ${saldoTotal.toFixed(2)}`
                    });

                    // Finalizar o estado
                    delete estadoPendentePerfil[chatId];
                } else {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: '🤖 Por favor, responda com *"sobrescrever"* ou *"atualizar"* para que eu possa continuar te ajudando. 😉'
                    });
                }
                return;

            case "nomeConta":
                profile.currentConta = { id: generateUniqueId(), nome: messageContent };
                profile.step = "saldoConta";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "💰 Qual é o *saldo atual* da conta?\n\nPode me informar o valor em reais. Ex: `2500,00`"
                });
                return;

            case "saldoConta":
                // Remover separadores de milhares e substituir vírgula decimal por ponto
                const saldo = parseFloat(messageContent.replace(/\./g, "").replace(",", "."));
                if (isNaN(saldo)) {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "⚠️ Opa! Preciso que você informe um *valor válido* para o saldo inicial.\n\nExemplo: `1500,00` ou `1500.00`"
                    });
                    return;
                }
                profile.currentConta.saldo = saldo;
                profile.step = "tipoConta";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "🏦 Qual é o *tipo da conta*?\n\nEscolha uma das opções abaixo, digitando o número correspondente:\n\n1️⃣ - Conta Corrente\n2️⃣ - Poupança\n3️⃣ - Carteira Digital"
                });
                return;

            case "tipoConta":
                const tipos = { "1": "Conta Corrente", "2": "Poupança", "3": "Carteira Digital" };
                const tipo = tipos[messageContent];
                if (!tipo) {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "⚠️ Opa! Parece que a opção não é válida.\n\nPor favor, escolha uma das opções abaixo digitando o número correspondente:\n\n1️⃣ - Conta Corrente\n2️⃣ - Poupança\n3️⃣ - Carteira Digital"
                    });
                    return;
                }

                // Validar e adicionar a conta ao perfil
                if (!profile.currentConta || !profile.currentConta.nome || profile.currentConta.saldo === undefined) {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "❌ Algo deu errado ao adicionar a conta. Por favor, tente novamente."
                    });
                    return;
                }

                profile.currentConta.tipo = tipo;
                profile.currentConta.dataCriacao = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD");
                profile.contas.push(profile.currentConta); // Salvar a conta no perfil
                delete profile.currentConta; // Limpar a conta temporária

                profile.step = "adicionarConta";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "✅ *Conta adicionada com sucesso!*\n\n💳 Deseja *adicionar outra conta*?\nResponda com *\"sim\"* ou *\"não\"*."
                });
                return;

            default:
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "❌ Ixe! Algo deu errado...\n\nPor favor, tente novamente. Se o problema continuar, me avise que eu te ajudo! 🤖"
                });
                delete estadoPendentePerfil[chatId];
                return;
        }
    }

    // Verificar se já existe um perfil com o mesmo ID no Firebase
    const userRef = db.collection("users").doc(senderNumber);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
        const userData = userDoc.data();

        // Perguntar ao usuário se ele deseja alterar as informações salvas
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `👤 Já existe um perfil financeiro associado ao número *${senderNumber}*.\n\n📋 *Resumo do Perfil Atual:*\n\n👤 *Nome:* ${userData.name}\n💳 *Contas:* ${userData.accounts.map(account => `\n- ${account.name} (${account.type}) - Saldo: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(account.balance)}`).join("")}\n\n❓ Deseja *alterar as informações* deste perfil?\n\nResponda com *"sim"* para alterar ou *"não"* para manter as informações atuais.`
        });

        // Armazenar o estado pendente para o chat
        estadoPendentePerfil[chatId] = { id: senderNumber, step: "alterarPerfil", userData };
        return;
    }

    // Caso não exista um perfil, iniciar o fluxo de criação
    estadoPendentePerfil[chatId] = { id: senderNumber, step: "perfil", contas: [] };
    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: "👤 Vamos criar seu *perfil financeiro*!\n\nQual será o *nome do perfil*? 📝\n\n*Atenção*, será o seu nome de usuário."
    });
}

module.exports = { tratarCriarPerfil, estadoPendentePerfil };