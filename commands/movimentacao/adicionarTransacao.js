const { gerarProximoIdDeTransacao, atualizarSaldoConta, interpretarMensagemTransacao } = require("./utilitariosFinanceiros");
const moment = require("moment-timezone");
const { simularDigitar } = require("../utilitariosComandos");
const levenshtein = require("fast-levenshtein"); // Instale com `npm install fast-levenshtein`
const db = require("../firebaseFolder/firebase");
const { palavrasChave, manager, notificarStatusOrcamento } = require("./utilitariosFinanceiros");

const detalhesPendentes = {}; // Estado para armazenar detalhes pendentes por chatId

async function comecarProcessoDeTransacao(sock, chatId, msg) {
    console.log("[LOG] Processo de transação em andamento\n");

    const messageContent = msg.message.conversation || msg.message.extendedTextMessage.text;
    const senderNumber = chatId.split("@")[0]; // Extrair o número do remetente
    //console.log(`[LOG] Mensagem recebida: ${messageContent}\n[LOG] Sender Number: ${senderNumber}\n`);

    // Verificar se há detalhes pendentes para este chat
    if (detalhesPendentes[chatId]) {
        console.log(`[LOG] Estado pendente encontrado para o chat ${chatId}. Encaminhando para tratarDetalhesAdicionais.\n`);
        await tratarDetalhesAdicionais(sock, chatId, messageContent, detalhesPendentes, senderNumber);
        return;
    }

    try {
        const senderNumber2 = chatId.split("@")[0]; // Extrair o número do remetente
        console.log(`[LOG] Sender Number recebido: ${senderNumber2}. Iniciando a busca pelo perfil financeiro associado...\n`);

        // Buscar perfis do Firebase
        const userDoc = await db.collection("users").doc(senderNumber2).get();
        if (!userDoc.exists) {
            console.log("[LOG] Perfil financeiro não encontrado. Solicitando criação de perfil.\n");
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "📭 Não encontrei um *perfil financeiro* associado ao seu número.\n\nVamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
            });
            return;
        }
        const perfisDoUsuario = userDoc.data();

        console.log(`[LOG] Perfil financeiro encontrado: ${JSON.stringify(perfisDoUsuario)}\n`);

        // Buscar contas do Firebase
        const contasFiltradas = perfisDoUsuario.accounts || [];

        if (contasFiltradas.length === 0) {
            console.log("[LOG] Nenhuma conta encontrada para o usuário. Solicitando criação de nova conta.\n");
            delete detalhesPendentes[chatId];
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "📭 Não encontrei nenhuma conta cadastrada para o seu perfil.\n\nParece que você ainda não possui um *perfil financeiro* configurado. Vamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
            });
            return;
        }

        // Interpretar a mensagem (passando as contas para detecção inteligente)
        const parsedData = await interpretarMensagemTransacao(messageContent, sock, chatId, senderNumber2, contasFiltradas);
        if (!parsedData) {
            console.log("[ERRO] Não foi possível interpretar a mensagem.\n");
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "🤔 Opa! Não entendi o que você quis dizer...\n\nTente algo como:\n🛒 *\"Gastei 50 reais no mercado ontem\"*"
            });
            return;
        }

        // Extrair dados de parsedData
        const { date, type, value, description, account, category, detectedAccount, senderNumber } = parsedData;

        // Configurar estado pendente
        detalhesPendentes[chatId] = {
            date,
            type,
            value,
            description,
            category,
            senderNumber,
            contasDisponiveis: contasFiltradas,
            step: "escolherConta"
        };

        console.log(`\n\n[LOG] Dados recebidos - Data: ${date} | Tipo: ${type} | Valor: ${value} | Descrição: ${description} | Conta: ${account || "Não especificada"} | Categoria: ${category || "Não especificada"} | Sender: ${senderNumber}\n`);

        // **NOVO: Verificar se a conta foi detectada automaticamente**
        if (detectedAccount) {
            console.log(`\n[LOG] 🎯 Conta detectada automaticamente: ${detectedAccount.name}. Processando transação diretamente.\n`);

            // Usar a conta detectada automaticamente e processar a transação
            detalhesPendentes[chatId] = {
                date,
                type,
                value,
                description,
                category,
                account: detectedAccount.name, // Usar a conta detectada
                senderNumber,
                contasDisponiveis: contasFiltradas,
                step: "confirmarTransacao"
            };

            // Perguntar se o usuário quer confirmar a transação com os dados detectados
            const formatCurrency = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: `🤖 *Transação detectada:*

📅 *Data:* ${date}
💰 *Valor:* ${formatCurrency(value)}
📊 *Tipo:* ${type === 'despesa' ? '📉 Despesa' : '📈 Receita'}
🏦 *Conta:* ${detectedAccount.name}
🏷️ *Categoria:* ${category || 'Não especificada'}
📝 *Descrição:* ${description || 'Não especificada'}

Deseja *\`salvar do jeito que está\`*?
Digite:
✅ \`SIM\` para confirmar\n
✏️ \`EDITAR\` para modificar\n
➡️ \`DEPOIS\` para decidir depois\n
❌ \`CANCELAR\` para cancelar`
            });
            return;
        }

        // Verificar se a conta foi identificada manualmente
        if (!account) {
            console.log("[LOG] Conta não identificada. Solicitando escolha de conta.\n");

            // Verificar contas carregadas do Firebase
            if (contasFiltradas.length === 0) {
                console.log("[LOG] Nenhuma conta encontrada para o usuário. Solicitando criação de nova conta.\n");
                delete detalhesPendentes[chatId];
                console.log("[LOG] Deletando detalhes pendentes pois não foi encontrada conta para o chatId:", chatId);
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "📭 Não encontrei nenhuma conta cadastrada para o seu perfil.\n\nParece que você ainda não possui um *perfil financeiro* configurado. Vamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
                });
                return;
            }

            // Exibir lista de contas filtradas para o usuário
            const formatCurrency = (value) =>
                new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

            const emojisNumeros = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

            let contasMsg = "🏦 *Escolha uma conta para associar à transação:*\n\n";

            contasFiltradas.forEach((conta, index) => {
                const emoji = emojisNumeros[index] || "🔹";
                contasMsg += `${emoji} *${conta.name}* — *Saldo:* ${formatCurrency(conta.balance)}\n`;
            });

            contasMsg += `\n0️⃣ *Criar nova conta*`;
            detalhesPendentes[chatId] = { date, type, value, description, category, senderNumber, contasDisponiveis: contasFiltradas, step: "escolherConta" };
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, { text: contasMsg });
            return;
        }

        // Se a conta já foi identificada, prosseguir para perguntar sobre detalhes adicionais
        detalhesPendentes[chatId] = { date, type, value, description, account, category, step: "adicionarDetalhes" };

        const { exists, id: categoryId } = await garantirCategoriaNoFirebase(category, senderNumber2, type);

        if (!exists) {
            console.log(`[LOG] Categoria "${category}" criada para o perfil: ${senderNumber2} com ID: ${categoryId}`);
            await perguntarOrcamento(sock, chatId, category, type, senderNumber2);
        }

        // Registrar a transação no Firebase
        const nextId = await gerarProximoIdDeTransacao();
        const transactionData = {
            id: nextId,
            date: date,
            type: type,
            value: value,
            category: category || "Não especificado",
            description: description || "Não especificado",
            account: account,
            tag: "Não especificado",
            userId: senderNumber2
        };
        await salvarTransacaoNoFirebase(transactionData);

        console.log(`[LOG] Transação salva com sucesso: ${JSON.stringify(transactionData)}\n`);

        // Atualizar saldo da conta
        await atualizarSaldoConta(senderNumber2, account, type, value);

        // Finalizar o fluxo
        await sock.sendMessage(chatId, {
            text: "💰  Transação registrada com sucesso!\n\nSe precisar de mais alguma coisa, é só chamar. 😉"
        });

        await enviarResumoTransacao(sock, chatId, senderNumber2, account, type, value);            

    } catch (error) {
        console.error(`[ERRO] Falha ao processar a mensagem: ${error}\n`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "❌ Algo deu errado ao processar sua solicitação.\n\n🔍 Verifique os *logs* para entender melhor o que aconteceu."
        });
        return;
    }
};

/**
 * Função para lidar com detalhes adicionais.
 */
async function tratarDetalhesAdicionais(sock, chatId, messageContent, detalhesPendentes, senderNumber) {
    const details = detalhesPendentes[chatId];
    console.log(`[LOG] Processando detalhes adicionais para o chat ${chatId}. Step atual: ${details.step || "adicionarDetalhes"}\n`);

    // **NOVO: Tratar confirmação de transação detectada automaticamente**
    if (details.step === "confirmarTransacao") {
        const resposta = messageContent.trim().toLowerCase();
        if (["sim", "s", "1"].includes(resposta)) {
            console.log("[LOG] Usuário confirmou a transação detectada automaticamente. Salvando...\n");

            // Registrar a transação no Firebase
            const nextId = await gerarProximoIdDeTransacao();
            const transactionData = {
                id: nextId,
                date: details.date,
                type: details.type,
                value: details.value,
                category: details.category || "Não especificada",
                description: details.description || "Não especificada",
                account: details.account,
                tag: null,
                userId: details.senderNumber
            };

            try {
                await salvarTransacaoNoFirebase(transactionData);
                console.log(`[LOG] Transação salva com sucesso: ${JSON.stringify(transactionData)}\n`);

                // Atualizar saldo da conta
                await atualizarSaldoConta(details.senderNumber, details.account, details.type, details.value);

                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "✅ *Transação registrada com sucesso!*\n\n🤖 A detecção automática funcionou perfeitamente!\n\nSe precisar de mais alguma coisa, é só chamar. 😉"
                });

                await enviarResumoTransacao(sock, chatId, details.senderNumber, details.account, details.type, details.value);

                // Verificar se a categoria já está cadastrada
                const categories = await getCategoriesFromFirebase(details.senderNumber);
                const existingCategory = categories.find(
                    category => category.name.toLowerCase() === (details.category || "").toLowerCase()
                );

                if (!existingCategory && details.category && details.category !== "Não especificada" && details.category !== "Não identificada") {
                    console.log(`[LOG] Categoria "${details.category}" não encontrada. Registrando como nova.`);
                    await perguntarOrcamento(sock, chatId, details.category, details.type, details.senderNumber);
                    return;
                }

                delete detalhesPendentes[chatId];
                return;
            } catch (error) {
                console.error(`[ERRO] Falha ao salvar transação: ${error.message}`);
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "❌ Ops! Ocorreu um erro ao salvar a transação. Tente novamente em alguns instantes."
                });
                delete detalhesPendentes[chatId];
                return;
            }
        } else if (["editar", "edit", "2"].includes(resposta)) {
            console.log("[LOG] Usuário escolher editar a transação:\n");
            // Salvar a transação como pendente e iniciar o fluxo de edição igual ao de transações pendentes
            const transacoesPendentes = require("./transacoesPendentes");
            const db = require("../firebaseFolder/firebase");
            const cleanPhone = details.senderNumber.replace(/\D/g, '');
            const chatId = `${cleanPhone}@s.whatsapp.net`;
            // Salvar a transação como pendente se ainda não estiver
            const pendingData = {
                userId: cleanPhone,
                status: 'editing',
                createdAt: new Date().toISOString(),
                transactionData: {
                    date: details.date,
                    type: details.type,
                    value: details.value,
                    category: details.category || "",
                    description: details.description || "",
                    account: details.account || "",
                    tag: details.tag || "Detectado automaticamente"
                }
            };
            // Salva no Firestore
            const pendingRef = await db.collection("pending_transactions").add(pendingData);
            pendingData.id = pendingRef.id;
            // Inicia o fluxo de edição igual ao de transações pendentes
            await transacoesPendentes.iniciarEdicaoTransacao(sock, cleanPhone, pendingData);
            // Limpa detalhes pendentes locais
            delete detalhesPendentes[chatId];
            return;
        } else if (["depois", "later"].includes(resposta)) {
            // Salvar como transação pendente para o usuário decidir depois
            const transacoesPendentes = require("./transacoesPendentes");
            const db = require("../firebaseFolder/firebase");
            const cleanPhone = details.senderNumber.replace(/\D/g, '');
            const chatIdPendente = `${cleanPhone}@s.whatsapp.net`;
            const pendingData = {
                userId: cleanPhone,
                status: 'pending_confirmation',
                createdAt: new Date().toISOString(),
                recemDetectada: true,
                transactionData: {
                    date: details.date,
                    type: details.type,
                    value: details.value,
                    category: details.category || "",
                    description: details.description || "",
                    account: details.account || "",
                    tag: details.tag || "Detectado automaticamente"
                }
            };
            const pendingRef = await db.collection("pending_transactions").add(pendingData);
            pendingData.id = pendingRef.id;
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, { text: "🔔 Transação salva como pendente! Você pode confirmar, editar ou cancelar depois usando o comando /pendentes." });
            delete detalhesPendentes[chatId];
            return;
        } else if (["cancelar", "cancel", "c"].includes(resposta)) {
            // Interromper o fluxo
            delete detalhesPendentes[chatId];
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "❌ Fluxo de adição de transação cancelado. Nenhuma informação foi salva."
            });
            return;
        } else {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ Resposta inválida. Por favor, responda com *sim* para salvar, *não* para editar ou *cancelar* para interromper."
            });
            return;
        }
    }

    if (details.step === "escolherConta") {
        const contasDisponiveis = detalhesPendentes[chatId].contasDisponiveis;
        const contaEscolhidaIndex = parseInt(messageContent);

        if (contaEscolhidaIndex === 0) {
            console.log("[LOG] Usuário escolheu criar uma nova conta.");
            detalhesPendentes[chatId].step = "criarNovaConta"; // Redirecionar para a etapa de criação de nova conta
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "🏦 Vamos criar uma nova conta!\n\nQual será o *nome da conta*? 💬"
            });
            return;
        }

        if (contaEscolhidaIndex > 0 && contaEscolhidaIndex <= contasDisponiveis.length) {
            const contaEscolhida = contasDisponiveis[contaEscolhidaIndex - 1]; // Obter o objeto da conta
            detalhesPendentes[chatId].account = contaEscolhida.id; // Atribuir o ID da conta
            console.log(`[LOG] Conta escolhida: ${contaEscolhida.name}`);
            console.log(`[LOG] Dados até o momento - Data: ${detalhesPendentes[chatId].date} | Tipo: ${detalhesPendentes[chatId].type} | Valor: ${detalhesPendentes[chatId].value} | Descrição: ${detalhesPendentes[chatId].description} | Conta: ${contaEscolhida.name} | Categoria: ${detalhesPendentes[chatId].category || "Não especificada"}`);

            // Avançar para o próximo passo
            detalhesPendentes[chatId].step = "adicionarDetalhes";
            await simularDigitar(sock, chatId);
            const resumoTransacao = `📋 *Resumo da Transação até o momento:*\n\n
- 📅 *Data:* ${details.date || "Não especificada"}
- 🔄 *Tipo:* ${details.type || "Não especificado"}
- 💰 *Valor:* ${details.value ? `R$ ${details.value.toFixed(2)}` : "Não especificado"}
- 🏦 *Conta:* ${contaEscolhida.name || "Não especificada"}
- 🏷️ *Categoria:* ${details.category || "Não especificada"}
- 📝 *Descrição:* ${details.description || "Não especificada"}`;

            // Enviar o resumo para o usuário
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: `${resumoTransacao}`
            });
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "📝 Gostaria de adicionar mais detalhes *opcionais* à transação?\n\nResponda com *sim* ou *não*."
            });
        } else {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ Opa! Essa opção não é válida.\n\nPor favor, escolha uma *conta da lista* ou digite *0* para criar uma nova conta."
            });
        }
        return; // Garante que o fluxo não continue para outras etapas
    }

    if (details.step === "criarNovaConta") {
        if (!details.newAccount) {
            // Solicitar o nome da nova conta
            details.newAccount = { step: "nomeConta" };
        }

        switch (details.newAccount.step) {
            case "nomeConta":
                details.newAccount.nome = messageContent;
                details.newAccount.step = "saldoConta";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "💰 Qual é o *saldo inicial* da conta?\n\nInforme o valor em reais. Ex: `2500,00`"
                });
                break;

            case "saldoConta":
                const saldo = parseFloat(messageContent.replace(/\./g, "").replace(",", "."));
                if (isNaN(saldo)) {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "⚠️ Opa! Preciso que você informe um *valor válido* para o saldo inicial.\n\nExemplo: `1500,00` ou `1500.00`"
                    });
                    return;
                }
                details.newAccount.saldo = saldo;
                details.newAccount.step = "tipoConta";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "🏦 Qual é o *tipo da conta*?\n\nEscolha uma das opções abaixo, digitando o número correspondente:\n\n1️⃣ - Conta Corrente\n2️⃣ - Poupança\n3️⃣ - Carteira Digital"
                });
                break;

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
                details.newAccount.tipo = tipo;
                details.newAccount.dataCriacao = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD");
                const senderNumber3 = chatId.split("@")[0]; // Extrair o número do remetente novamente

                const userDoc = await db.collection("users").doc(senderNumber3).get();
                if (!userDoc.exists) {
                    console.log("[LOG] Perfil financeiro não encontrado.");
                    return null;
                }
                const perfisDosUsuarios = userDoc.data();

                console.log(`[LOG] Nome do perfil associado ao senderNumber: ${perfisDosUsuarios}`);

                // Salvar a nova conta no Firebase
                const newAccountData = {
                    id: gerarProximoIdDeTransacao(),
                    name: details.newAccount.nome,
                    type: details.newAccount.tipo,
                    balance: details.newAccount.saldo,
                    currency: "BRL",
                    description: "Sem descrição",
                    createdAt: details.newAccount.dataCriacao
                };
                await createAccountInFirebase(senderNumber3, newAccountData);

                console.log(`[LOG] Nova conta criada: ${JSON.stringify(newAccountData)}`);

                // Recarregar as contas disponíveis associadas ao senderNumber
                const updatedUserDoc = await db.collection("users").doc(senderNumber3).get();
                if (!updatedUserDoc.exists) {
                    console.log("[LOG] Perfil financeiro não encontrado após criar a conta.");
                    return [];
                }

                const updatedUserData = updatedUserDoc.data();
                const contasFiltradas = updatedUserData.accounts || [];
                if (contasFiltradas.length === 0) {
                    console.log("[LOG] Nenhuma conta encontrada para o usuário.");
                    return [];
                }

                // Exibir a lista de contas novamente para o usuário
                const formatCurrency = (value) =>
                    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

                const emojisNumeros = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
                let contasMsg = "🏦 *Escolha uma conta para associar à transação:*\n\n";

                contasFiltradas.forEach((conta, index) => {
                    const emoji = emojisNumeros[index] || "🔹";
                    contasMsg += `${emoji} *${conta.name}* — *Saldo:* ${formatCurrency(parseFloat(conta.balance))}\n`;
                });

                contasMsg += `\n0️⃣ *Criar nova conta*`;

                // Atualizar o estado pendente para aguardar a escolha da conta
                detalhesPendentes[chatId] = {
                    ...detalhesPendentes[chatId],
                    contasDisponiveis: contasFiltradas,
                    step: "escolherConta"
                };

                // Enviar a mensagem com a lista de contas
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, { text: contasMsg });
                break;
            default:
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "❌ Algo deu errado durante a criação da conta. Por favor, tente novamente."
                });
                delete details.newAccount;
                details.step = "escolherConta";
        }
        return;
    }

    if (details.step === "adicionarDetalhes") {
        if (messageContent.toLowerCase() === "não" || messageContent.toLowerCase() === "n" || messageContent.toLowerCase() === "2" || messageContent.toLowerCase() === "nao") {
            console.log("[LOG] Usuário optou por não adicionar mais detalhes. Salvando transação básica.\n");

            // Registrar a transação no Firebase
            const nextId = await gerarProximoIdDeTransacao();
            const transactionData = {
                id: nextId,
                date: details.date,
                type: details.type,
                value: details.value,
                category: details.category || "Não especificado",
                description: details.description || "Não especificado",
                account: details.account,
                tag: "Não especificado",
                userId: details.senderNumber
            };
            await salvarTransacaoNoFirebase(transactionData);

            console.log(`[LOG] Transação salva com sucesso: ${JSON.stringify(transactionData)}\n`);

            // Atualizar saldo da conta
            await atualizarSaldoConta(details.senderNumber, details.account, details.type, details.value);

            // Finalizar o fluxo
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "💰  Transação registrada com sucesso!\n\nSe precisar de mais alguma coisa, é só chamar. 😉"
            });

            await enviarResumoTransacao(sock, chatId, details.senderNumber, details.account, details.type, details.value);



            if (details.category) {
                console.log(`[LOG] Chamando perguntarOrcamento para a categoria "${details.category}" do tipo "${details.type}".`);
                await perguntarOrcamento(sock, chatId, details.category, details.type, details.senderNumber);
                //delete detalhesPendentes[chatId]; // Limpar detalhes pendentes após o processamento
            }
        } else if (messageContent.toLowerCase() === "sim" || messageContent.toLowerCase() === "s" || messageContent.toLowerCase() === "1") {
            console.log("[LOG] Usuário optou por adicionar mais detalhes. Alterando estado para 'analisarDetalhesFaltantes'.\n");
            details.step = "analisarDetalhesFaltantes";
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "📝 Vamos adicionar mais detalhes à sua transação. Vou perguntar as informações que estão faltando, beleza?"
            });
            await tratarDetalhesAdicionais(sock, chatId, messageContent, detalhesPendentes, senderNumber);
        } else {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ Resposta inválida. Por favor, responda com *sim* ou *não*."
            });
        }
        return;
    }

    if (details.step === "analisarDetalhesFaltantes") {
        // Verificar qual informação está faltando
        if (!details.category || details.category === "Não identificada") {
            console.log("[LOG] Solicitando categoria da transação.\n");
            details.step = "aguardandoCategoria";
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "🏷️ Qual é a *categoria* da transação? Exemplo: 'Mercado', ou 'Transporte'."
            });
            return;
        }

        if (!details.description) {
            console.log("[LOG] Solicitando descrição da transação.\n");
            details.step = "aguardandoDescricao";
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "📝 Qual é a *descrição* da transação? Exemplo: 'Compra de frutas no mercado'."
            });
            return;
        }

        if (!details.tag) {
            console.log("[LOG] Solicitando tag da transação.\n");
            details.step = "aguardandoTag";
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "🏷️ Deseja adicionar uma *tag* para a transação? Exemplo: 'Essencial', 'Lazer', ou 'Trabalho'."
            });
            return;
        }

        // Se todas as informações estiverem completas, salvar a transação
        console.log("[LOG] Todas as informações foram preenchidas. Salvando transação.\n");
        // Registrar a transação no Firebase
        const nextId = await gerarProximoIdDeTransacao();
        const transactionData = {
            id: nextId,
            date: details.date,
            type: details.type,
            value: details.value,
            category: details.category,
            description: details.description,
            account: details.account,
            tag: details.tag || "Não especificado",
            userId: details.senderNumber
        };
        await salvarTransacaoNoFirebase(transactionData);
        console.log(`[LOG] Transação salva com sucesso: ${JSON.stringify(transactionData)}\n`);

        // Atualizar saldo da conta
        await atualizarSaldoConta(details.senderNumber, details.account, details.type, details.value);

        await sock.sendMessage(chatId, {
            text: "💰  Transação registrada com sucesso!\n\nSe precisar de mais alguma coisa, é só chamar. 😉"
        });
        await enviarResumoTransacao(sock, chatId, details.senderNumber, details.account, details.type, details.value);

        // Verificar se a categoria já está cadastrada
        const categories = await getCategoriesFromFirebase(details.senderNumber);
        const existingCategory = categories.find(
            category => category.name.toLowerCase() === details.category.toLowerCase()
        );

        if (!existingCategory) {
            console.log(`[LOG] Categoria "${details.category}" não encontrada. Registrando como nova.`);
            await perguntarOrcamento(sock, chatId, details.category, details.type, details.senderNumber);
            return;
        }

        delete detalhesPendentes[chatId];
        return;
    }

    if (details.step === "aguardandoCategoria") {
        console.log(`[LOG] Categoria recebida: ${messageContent}\n`);
        details.category = messageContent;
        details.step = "analisarDetalhesFaltantes"; // Voltar para verificar o próximo detalhe
        await tratarDetalhesAdicionais(sock, chatId, messageContent, detalhesPendentes, senderNumber);
        return;
    }

    if (details.step === "aguardandoDescricao") {
        console.log(`[LOG] Descrição recebida: ${messageContent}\n`);
        details.description = messageContent;
        details.step = "analisarDetalhesFaltantes"; // Voltar para verificar o próximo detalhe
        await tratarDetalhesAdicionais(sock, chatId, messageContent, detalhesPendentes, senderNumber);
        return;
    }

    if (details.step === "aguardandoTag") {
        console.log(`[LOG] Tag recebida: ${messageContent}\n`);
        details.tag = messageContent;
        details.step = "analisarDetalhesFaltantes"; // Voltar para verificar o próximo detalhe
        await tratarDetalhesAdicionais(sock, chatId, messageContent, detalhesPendentes, senderNumber);
        return;
    }

    if (details.step === "setBudget") {
        if (messageContent.toLowerCase() === "não" || messageContent.toLowerCase() === "n" || messageContent.toLowerCase() === "2" || messageContent.toLowerCase() === "nao") {
            console.log("[LOG] Usuário optou por não definir um orçamento. Encerrando o processo.\n");
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "📂 Categoria cadastrada sem orçamento. Se precisar de algo mais, é só chamar! 😉"
            });
            delete detalhesPendentes[chatId];
            console.log("[LOG] Detalhes pendentes removidos após não definir orçamento.\n");
            return;
        }
        else if (messageContent.toLowerCase() === "sim" || messageContent.toLowerCase() === "s" || messageContent.toLowerCase() === "1") {
            console.log("[LOG] Usuário optou por definir um orçamento. Aguardando valor do orçamento.\n");
            details.step = "confirmBudget";
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "💰 Qual é o *valor do orçamento mensal* para essa categoria? Exemplo: `1500,00` ou `1500.00`"
            });
        }
        else {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ Resposta inválida. Por favor, responda com *sim* ou *não*."
            });
        }
        return;
    }

    if (details.step === "confirmBudget") {
        const budgetValue = parseFloat(messageContent.replace(/\./g, "").replace(",", "."));
        if (isNaN(budgetValue)) {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ *Valor inválido!*\n\nPor favor, insira um *valor numérico válido* para o orçamento mensal.\nExemplo: `450.00` ou `1.200,50`"
            });
            details.step = "confirmBudget"; // Manter o passo atual
            return;
        }

        console.log(`[LOG] Orçamento definido para a categoria "${details.newCategory}": R$ ${budgetValue.toFixed(2)}`);
        await updateCategoryInFirebase(details.categoryId, { budget: budgetValue });

        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `🧾 Tudo certo! Defini um orçamento de *R$ ${budgetValue.toFixed(2)}* para a categoria *"${details.newCategory}"*.\n\nSe quiser ajustar isso depois, é só me avisar. 😉`
        });

        // NOVO: Notificar status do orçamento após definir o valor
        await notificarStatusOrcamento(sock, chatId, details.userId, details.newCategory);

        delete detalhesPendentes[chatId];
        console.log("[LOG] Orçamento definido e detalhes pendentes removidos.\n");
    }
}

/**
 * Função para garantir que uma categoria exista na planilha para um perfil específico.
 * Se não existir, ela será adicionada automaticamente.
 * @param {object} sock
 * @param {string} chatId
 * @param {string} category
 * @param {string} type
 * @param {string} senderNumber
 * @returns {Promise<object>} { exists: boolean, id: number }
 */
async function garantirCategoriaNoFirebase(category, userId, type) {
    try {
        const categoryRef = db.collection("categories")
            .where("name", "==", category)
            .where("userId", "==", userId);
        const snapshot = await categoryRef.get();

        if (!snapshot.empty) {
            console.log(`[LOG] Categoria "${category}" já existe no Firebase.`);
            return { exists: true, id: snapshot.docs[0].id };
        }

        const newCategoryRef = db.collection("categories").doc();
        await newCategoryRef.set({
            id: newCategoryRef.id,
            name: category,
            userId,
            type,
            budget: null // Orçamento inicial como nulo
        });

        console.log(`[LOG] Nova categoria criada no Firebase: ${category}`);
        return { exists: false, id: newCategoryRef.id };
    } catch (error) {
        console.error("❌ Erro ao garantir categoria no Firebase:", error);
        throw error;
    }
}


async function updateCategoryInFirebase(categoryId, updates) {
    try {
        const categoryRef = db.collection("categories").doc(categoryId);
        await categoryRef.update(updates);
        console.log(`[LOG] Categoria "${categoryId}" atualizada com sucesso: ${JSON.stringify(updates)}`);
    } catch (error) {
        console.error("❌ Erro ao atualizar categoria no Firebase:", error);
        throw error;
    }
}

async function getCategoriesFromFirebase(userId) {
    try {
        const categoryRef = db.collection("categories").where("userId", "==", userId);
        const snapshot = await categoryRef.get();

        if (snapshot.empty) {
            console.log(`[LOG] Nenhuma categoria encontrada para o usuário "${userId}".`);
            return [];
        }

        const categories = snapshot.docs.map(doc => doc.data());
        console.log(`[LOG] Categorias encontradas: ${JSON.stringify(categories)}`);
        return categories;
    } catch (error) {
        console.error("❌ Erro ao buscar categorias no Firebase:", error);
        throw error;
    }
}

/**
 * Função para perguntar sobre orçamento para uma nova categoria.
 */
async function perguntarOrcamento(sock, chatId, category, type, userId) {
    const { exists, id: categoryId } = await garantirCategoriaNoFirebase(category, userId, type);

    if (exists) {
        console.log(`[LOG] Categoria "${category}" já existe. Não será perguntado sobre orçamento.`);
        delete detalhesPendentes[chatId];
        console.log(`[LOG] Detalhes pendentes removidos após verificar categoria existente.\n`);
        // Notificar status do orçamento mesmo para categorias já existentes
        await notificarStatusOrcamento(sock, chatId, userId, category);
        return;
    }

    if (type === "receita") {
        console.log(`[LOG] Categoria "${category}" do tipo "${type}" registrada sem orçamento.`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `📂 Categoria *"${category}"* adicionada como tipo *${type}* ✅\n\n💡 Como é uma categoria de receita, *não é necessário definir um orçamento*.`
        });
        delete detalhesPendentes[chatId];
        console.log("[LOG] Detalhes pendentes removidos após verificar categoria existente é receita.\n");
        return;
    }

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: `📂 Categoria *"${category}"* adicionada como tipo *${type}* ✅\n\n📊 Deseja definir um *orçamento mensal* para essa categoria?\n\nResponda com *sim* ou *não*.`
    });

    detalhesPendentes[chatId] = detalhesPendentes[chatId] || {};
    detalhesPendentes[chatId].step = "setBudget";
    detalhesPendentes[chatId].newCategory = category;
    detalhesPendentes[chatId].categoryType = type;
    detalhesPendentes[chatId].categoryId = categoryId;
    detalhesPendentes[chatId].userId = userId;
}


/**
 * Função para normalizar a categoria com base em similaridade.
 * Se a categoria não for encontrada, ela será tratada como nova.
 * @param {string} inputCategory
 * @param {string} userId
 * @returns {Promise<string>} Categoria normalizada ou a entrada original
 */
async function normalizarCategoria(inputCategory, userId) {
    console.log(`[LOG] Normalizando categoria: ${inputCategory}`);

    // Ler categorias existentes do Firebase
    const categories = await getCategoriesFromFirebase(userId);
    const categoryNames = categories.map(category => category.name.toLowerCase());

    // Comparar a entrada com as categorias existentes
    let closestCategory = null;
    let minDistance = Infinity;

    for (const category of categoryNames) {
        const distance = levenshtein.get(inputCategory.toLowerCase(), category);
        console.log(`[DEBUG] Comparando "${inputCategory}" com "${category}" - Distância: ${distance}`);
        if (distance < minDistance) {
            minDistance = distance;
            closestCategory = category;
        }
    }

    // Definir um limite para considerar como correspondência válida
    const similarityThreshold = 3; // Ajuste conforme necessário
    if (minDistance <= similarityThreshold) {
        console.log(`[LOG] Categoria normalizada encontrada: ${closestCategory} (distância: ${minDistance})`);
        return closestCategory;
    }

    console.log(`[LOG] Categoria não encontrada. Será tratada como nova: ${inputCategory}`);
    return inputCategory; // Retorna a entrada original se não encontrar correspondência
}

/**
 * Normaliza a mensagem para lidar com preposições e variações de texto,
 * mantendo caracteres como "ç" e acentuações.
 * @param {string} text
 * @returns {string} Texto normalizado
 */
function normalizarMensagem(text) {
    const preposicoes = [
        "na", "uma", "com", "um", "uns", "umas", "no", "de", "do", "em", "da", "das", "dos", "para", "por", "a", "o", "e", "as", "os", "à", "ao", "pela", "pelo"
    ];

    let normalizedText = text.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Removes accents
        .replace(/[^a-z0-9çáéíóúãõâêîôûàèìòùäëïöüñ\s,]/gi, ""); // Remove caracteres especiais

    preposicoes.forEach(prep => {
        const regex = new RegExp(`\\b${prep}\\b`, "g");
        normalizedText = normalizedText.replace(regex, ""); // Remove preposições
    });

    normalizedText = normalizedText.replace(/\s+/g, " ").trim(); // Remove espaços extras
    return normalizedText;
}

/**
 * Salva uma transação no Firebase.
 * @param {object} transaction
 */
async function salvarTransacaoNoFirebase(transaction) {
    try {
        if (!transaction.id) {
            transaction.id = await gerarProximoIdDeTransacao("transactions");
        } else {
            // Se já veio com id, garantir que não existe duplicidade
            const doc = await db.collection("transactions").doc(transaction.id).get();
            if (doc.exists) {
                transaction.id = await gerarProximoIdDeTransacao("transactions");
            }
        }
        const transactionRef = db.collection("transactions").doc(transaction.id);
        await transactionRef.set(transaction);
        console.log(`✅ Transação salva no Firebase com sucesso! ID: ${transaction.id}`);
    } catch (error) {
        console.error("❌ Erro ao salvar transação no Firebase:", error);
        throw error;
    }
}

/**
 * Cria uma nova conta no Firebase para um usuário.
 * @param {string} userId
 * @param {object} accountData
 */
async function createAccountInFirebase(userId, accountData) {
    try {
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            throw new Error(`Usuário ${userId} não encontrado no Firebase.`);
        }

        const userData = userDoc.data();
        const accounts = userData.accounts || [];
        accounts.push(accountData);

        await userRef.update({ accounts });
        console.log(`✅ Nova conta criada no Firebase para usuário ${userId}: ${JSON.stringify(accountData)}`);
    } catch (error) {
        console.error("❌ Erro ao criar conta no Firebase:", error);
        throw error;
    }
}

/**
 * Envia um resumo da transação realizada.
 * @param {object} sock
 * @param {string} chatId
 * @param {string} userId
 * @param {string} account
 * @param {string} type
 * @param {number} value
 */
async function enviarResumoTransacao(sock, chatId, userId, account, type, value) {
    try {
        // Buscar saldo atualizado da conta
        const userDoc = await db.collection("users").doc(userId).get();
        if (!userDoc.exists) {
            console.log("[LOG] Usuário não encontrado para resumo de transação.");
            return;
        }

        const userData = userDoc.data();
        const userAccount = userData.accounts?.find(acc =>
            acc.id === account || acc.name === account
        );

        if (!userAccount) {
            console.log("[LOG] Conta não encontrada para resumo de transação.");
            return;
        }

        const formatCurrency = (value) =>
            new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

        // Definir emoji para receita e despesa
        let operacao, emoji;
        if (type === "receita") {
            operacao = "entrada";
            emoji = "🟢💰"; // Receita: emoji verde + dinheiro
        } else {
            operacao = "saída";
            emoji = "🔴💸"; // Despesa: emoji vermelho + dinheiro saindo
        }

        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `${emoji} *Resumo da transação:*\n\n🏦 *Conta:* ${userAccount.name}\n💵 *${operacao.charAt(0).toUpperCase() + operacao.slice(1)}:* ${formatCurrency(value)}\n💼 *Saldo atual:* ${formatCurrency(userAccount.balance)}`
        });
    } catch (error) {
        console.error("❌ Erro ao enviar resumo da transação:", error);
    }
}

module.exports = {
    tratarDetalhesAdicionais,
    comecarProcessoDeTransacao,
    detalhesPendentes,
    garantirCategoriaNoFirebase,
    enviarResumoTransacao,
    perguntarOrcamento,
    getCategoriesFromFirebase,
    gerarProximoIdDeTransacao,
    normalizarCategoria // Ensure this is included!
};