const { getAccountsFromFirebase, addTransaction } = require("../firebaseFolder/utilitariosFirebase");
const { atualizarSaldoConta } = require("../movimentacao/utilitariosFinanceiros");
const { simularDigitar } = require("../utilitariosComandos");

const estadoPendenteSaldo = {}; // Estado para armazenar atualizações pendentes por chatId

async function tratarAtualizarSaldo(sock, chatId, messageContent) {
    const senderNumber = chatId.split("@")[0]; // Extrair o número do remetente

    // Verificar se já existe um estado pendente para este chat
    if (estadoPendenteSaldo[chatId]) {
        const updateState = estadoPendenteSaldo[chatId];

        if (updateState.step === "escolherConta") {
            const contas = updateState.contas;
            const contaEscolhidaIndex = parseInt(messageContent); // Captura a escolha do usuário

            if (isNaN(contaEscolhidaIndex) || contaEscolhidaIndex < 1 || contaEscolhidaIndex > contas.length) {
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⚠️ Opa! Escolha uma conta válida da lista."
                });
                return;
            }

            // Conta escolhida
            const contaEscolhida = contas[contaEscolhidaIndex - 1];
            updateState.contaEscolhida = contaEscolhida;
            updateState.step = "informarSaldo";

            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: `💰 Qual é o *novo saldo* para a conta *${contaEscolhida[3]}*?\n\nInforme o valor em reais. Ex: \`2500,00\``
            });
            return;
        }

        if (updateState.step === "informarSaldo") {
            const novoSaldo = parseFloat(messageContent.replace(/\./g, "").replace(",", "."));
            if (isNaN(novoSaldo)) {
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⚠️ Opa! Preciso que você informe um *valor válido* para o saldo.\n\nExemplo: `1500,00` ou `1500.00`"
                });
                return;
            }

            // Atualizar o saldo na conta do Firebase
            const conta = updateState.contaEscolhida;
            try {
                const saldoAnterior = conta.balance || 0; // Saldo anterior
                const diferenca = novoSaldo - saldoAnterior; // Diferença entre o novo saldo e o anterior
                const tipoTransacao = diferenca > 0 ? "receita" : "despesa"; // Determinar o tipo de transação

                // Atualizar diretamente o saldo no Firebase
                const userRef = require("../firebaseFolder/firebase").collection("users").doc(senderNumber);
                const userDoc = await userRef.get();

                if (userDoc.exists) {
                    const userData = userDoc.data();
                    const accounts = userData.accounts || [];

                    const accountIndex = accounts.findIndex(acc => acc.id === conta.id);
                    if (accountIndex !== -1) {
                        accounts[accountIndex].balance = novoSaldo;
                        await userRef.update({ accounts });
                    }
                }

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: `✅ Saldo da conta *${conta.name}* atualizado com sucesso para *R$ ${novoSaldo.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*!`
                });

                // Perguntar se deseja salvar a diferença como uma transação
                updateState.step = "salvarTransacao";
                updateState.diferenca = Math.abs(diferenca); // Armazenar a diferença
                updateState.tipoTransacao = tipoTransacao; // Armazenar o tipo de transação

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: `🔄 Deseja salvar a diferença de *R$ ${Math.abs(diferenca).toFixed(2)}* como uma *${tipoTransacao}*?\n\nResponda com *sim* ou *não*.`
                });
            } catch (error) {
                console.error(`[ERRO] Falha ao atualizar saldo: ${error.message}`);
                await sock.sendMessage(chatId, {
                    text: "❌ Ocorreu um erro ao atualizar o saldo. Por favor, tente novamente mais tarde."
                });
            }
            return;
        }

        if (updateState.step === "salvarTransacao") {
            if (messageContent.toLowerCase() === "sim") {
                updateState.step = "adicionarDetalhesTransacao";

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "🏷️ Deseja adicionar uma *categoria* para a transação? Se sim, informe o nome da categoria. Caso contrário, digite *pular*."
                });
            } else if (messageContent.toLowerCase() === "não") {
                delete estadoPendenteSaldo[chatId];
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "✅ Tudo bem! Se precisar de algo mais, é só chamar. 😉"
                });
            } else {
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⚠️ Por favor, responda com *sim* ou *não*."
                });
            }
            return;
        }

        if (updateState.step === "adicionarDetalhesTransacao") {
            if (messageContent.toLowerCase() === "pular") {
                updateState.categoria = "Não especificada";
                updateState.step = "adicionarDescricaoTransacao";

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "📝 Deseja adicionar uma *descrição* para a transação? Se sim, informe a descrição. Caso contrário, digite *pular*."
                });
            } else {
                updateState.categoria = messageContent;
                updateState.step = "adicionarDescricaoTransacao";

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "📝 Deseja adicionar uma *descrição* para a transação? Se sim, informe a descrição. Caso contrário, digite *pular*."
                });
            }
            return;
        }

        if (updateState.step === "adicionarDescricaoTransacao") {
            const descricao = messageContent.toLowerCase() === "pular" ? "Sem descrição" : messageContent;

            // Salvar a transação
            try {
                const transacao = {
                    date: new Date().toISOString(),
                    type: updateState.tipoTransacao,
                    value: updateState.diferenca,
                    category: updateState.categoria || "Não especificada",
                    description: descricao,
                    account: updateState.contaEscolhida.id,
                    userId: senderNumber
                };

                await addTransaction([
                    transacao.date,
                    transacao.type,
                    transacao.value,
                    transacao.category,
                    transacao.description,
                    transacao.account,
                    senderNumber
                ]);

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: `✅ Transação de *R$ ${transacao.value.toFixed(2)}* salva como *${transacao.type}* com sucesso!`
                });
            } catch (error) {
                console.error(`[ERRO] Falha ao salvar transação: ${error.message}`);
                await sock.sendMessage(chatId, {
                    text: "❌ Ocorreu um erro ao salvar a transação. Por favor, tente novamente mais tarde."
                });
            }

            // Finalizar o fluxo
            delete estadoPendenteSaldo[chatId];
            return;
        }

        if (updateState.step === "atualizarOutraConta") {
            if (messageContent.toLowerCase() === "sim") {
                // Reiniciar o fluxo para escolher outra conta
                updateState.step = "escolherConta";

                // Buscar as contas atualizadas do Firebase
                const contasAtualizadas = await getAccountsFromFirebase(senderNumber);

                // Atualizar o estado pendente com as contas atualizadas
                updateState.contas = contasAtualizadas;

                const formatCurrency = (value) =>
                    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

                const emojisNumeros = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
                let contasMsg = "🏦 *Escolha uma conta para atualizar o saldo:*\n\n";

                contasAtualizadas.forEach((conta, index) => {
                    const emoji = emojisNumeros[index] || "🔹";
                    contasMsg += `${emoji} *${conta.name}* — *Saldo:* ${formatCurrency(conta.balance)}\n`;
                });

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, { text: contasMsg });
            } else if (messageContent.toLowerCase() === "não") {
                // Buscar as contas atualizadas do Firebase
                const contasAtualizadas = await getAccountsFromFirebase(senderNumber);

                const allBalances = contasAtualizadas.map(conta => ({
                    name: conta.name,
                    balance: conta.balance || 0
                }));

                const formattedBalances = allBalances.map(account =>
                    `• ${account.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(account.balance)}`
                ).join("\n");

                const totalBalance = allBalances.reduce((sum, account) => sum + account.balance, 0);
                const formattedTotalBalance = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBalance);

                const message = `✅ *Saldos Atualizados:*\n\n${formattedBalances}\n\n🧮 *Saldo Total:* ${formattedTotalBalance}`;

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, { text: message });

                // Limpar o estado pendente
                delete estadoPendenteSaldo[chatId];
            } else {
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⚠️ Por favor, responda com *sim* ou *não*."
                });
            }
            return;
        }
    }

    // Início do fluxo: listar contas
    const contas = await getAccountsFromFirebase(senderNumber);
    if (contas.length === 0) {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "📭 Não encontrei nenhuma conta cadastrada para o seu perfil no Firebase.\n\nParece que você ainda não possui um *perfil financeiro* configurado. Vamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
        });
        return;
    }

    // Exibir lista de contas para o usuário
    const formatCurrency = (value) =>
        new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

    const emojisNumeros = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    let contasMsg = "🏦 *Escolha uma conta para atualizar o saldo:*\n\n";

    contas.forEach((conta, index) => {
        const emoji = emojisNumeros[index] || "🔹";
        contasMsg += `${emoji} *${conta.name}* — *Saldo:* ${formatCurrency(conta.balance)}\n`;
    });

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: contasMsg });

    // Salvar o estado pendente
    estadoPendenteSaldo[chatId] = {
        step: "escolherConta",
        contas: contas // Contas retornadas do Firebase
    };
}

module.exports = { tratarAtualizarSaldo, estadoPendenteSaldo };