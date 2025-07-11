// Gerenciador de transações pendentes de confirmação
// Este arquivo lida com as respostas dos usuários às propostas de transações automáticas

const db = require("../firebaseFolder/firebase");
const { atualizarSaldoConta } = require("./utilitariosFinanceiros");
const { simularDigitar } = require("../utilitariosComandos");
const { limparPropostaPendente, receberPropostaPendente } = require("./utilitariosProposta");
const {
  normalizarCategoria,
  garantirCategoriaNoFirebase,
  enviarResumoTransacao,
  perguntarOrcamento,
} = require("./adicionarTransacao");
const { tratarComandoPendentes } = require("./visualizarPendentes");
const levenshtein = require("fast-levenshtein");
// Palavras-chave para fallback de categoria
const palavrasChaveCategorias = {
  alimentacao: [
    "ifood", "lanche", "pizza", "restaurante", "sushi", "hamburgueria", "delivery", "cafeteria"
  ],
  servicos: [
    "assinatura", "assinaturas", "serviço de streaming", "seviço", "serviços", "squarecloud",
    "spotify", "netflix", "disney+", "youtube premium", "amazon prime",
    "operadora", "claro", "vivo", "tim", "oi", "streaming", "crédito",
    "apple music", "deezer", "globo play", "hbo max", "paramount+",
    "serviço de email", "nuvem", "dropbox", "google one", "office 365",
    "onlyfans", "twitch", "patreon", "serviço de assinatura", "plano anual",
    "streaming", "hulu", "discovery+", "twitch prime", "vimeo", "playstation plus", "xbox live",
  ],
  mercado: [
    "mercado", "feira", "padaria", "açougue", "quitanda", "empório", "mercadinho", "psiu", "cabral",
    "mercearia", "loja de conveniência", "sacolão", "hipermercado", "varejão",
    "distribuidora", "depósito", "lojinha", "minimercado", "hortifruti", "supermercado online", "bazar", "sushi shop"
  ],
  salario: ["salario", "salário", "renda", "receita", "pagamento",
    "pro-labore", "honorários", "ordenado", "remuneração", "vencimentos",
    "bonificação", "comissão", "gorjeta", "ajuda de custo", "bolsa",
    "benefício", "13º", "férias", "PLR", "participação nos lucros", "salário extra", "bônus de desempenho"
  ],
  casa: [
    "condomínio", "iptu", "gás", "tv a cabo",
    "manutenção", "reforma", "decoração", "jardim", "limpeza",
    "seguro residencial", "faxina", "piscina", "lavanderia", "cuidados domésticos", "encanamento", "elétrica", "pintura"
  ],
  lazer: ["lazer", "diversão", "entretenimento", "cultura", "esporte",
    "viagem", "pub", "parque de diversões", "bar", "balada", "festa", "evento",
    "jogo", "hobby", "passatempo", "museu", "teatro", "zoológico", "aquário", "karaokê", "cinema", "shopping"
  ],
  transporte: [
    "gasolina", "pedágio", "estacionamento", "mecânico", "lavagem",
    "seguro do carro", "ipva", "licenciamento", "oficina", "bicicleta",
    "patinete", "aluguel de carro", "blablacar", "posto", "auto-elétrico", "uber", "uber moto", "99", "indriver", "in driver", "onibus", "carro elétrico", "táxi"
  ],
  saude: [
    "plano de saúde", "médico", "dentista", "fisioterapeuta", "psicólogo",
    "farmácia", "remédio", "exame", "laboratório", "ótica",
    "academia", "nutricionista", "personal trainer", "suplemento", "pilates", "psiquiatra", "tratamento estético", "homeopatia"
  ],
  educacao: [
    "faculdade", "curso", "livro", "material escolar",
    "escola", "universidade", "workshop", "palestra", "seminário",
    "concurso", "certificação", "idiomas", "kumon", "escola de música", "mentoria", "coaching", "aprendizado online"
  ]
};

function buscarCategoriaPorPalavraChave(text) {
  const txt = text.toLowerCase();
  for (const [cat, arr] of Object.entries(palavrasChaveCategorias)) {
    if (arr.some(word => txt.includes(word.toLowerCase()))) {
      return cat.charAt(0).toUpperCase() + cat.slice(1);
    }
  }
  return null;
}

/**
 * Processa resposta do usuário a uma proposta de transação
 * @param {object} sock - Conexão WhatsApp
 * @param {string} userPhone - Telefone do usuário
 * @param {string} message - Mensagem do usuário
 * @returns {boolean} - Se a mensagem foi processada como resposta a proposta
 */
async function tratarRespostaDePropostaDeTransacao(sock, userPhone, message) {
  try {
    const messageText = message.toLowerCase().trim();
    const cleanPhone = userPhone.replace(/\D/g, '');
    const chatId = `${cleanPhone}@s.whatsapp.net`;

    // NOVO: Priorizar pendingProposal se existir
    const { receberPropostaPendente, limparPropostaPendente } = require("./utilitariosProposta");
    let pendingData = null;
    const pendingProposal = receberPropostaPendente(chatId);
    if (pendingProposal && pendingProposal.transactionData) {
      pendingData = pendingProposal;
      console.log(`[PROPOSAL-RESPONSE] Usando pendingProposal do chatId ${chatId}: id=${pendingData.id}`);
    } else {
      // Buscar transação pendente com status 'pending_confirmation' OU 'editing'
      const pendingQuery = db.collection("pending_transactions")
        .where("userId", "==", cleanPhone)
        .where("status", "in", ["pending_confirmation", "editing"])
        .orderBy("createdAt", "desc")
        .limit(1);
      const snapshot = await pendingQuery.get();
      if (snapshot.empty) {
        return false; // Não há transação pendente
      }
      const pendingDoc = snapshot.docs[0];
      pendingData = pendingDoc.data();
      pendingData.id = pendingDoc.id;
      console.log(`[PROPOSAL-RESPONSE] Usando transação mais recente do Firestore: id=${pendingData.id}`);
    }

    // Se já está em edição e o usuário manda "editar" de novo, reenviar menu de edição
    if (pendingData.status === 'editing' && (messageText === 'editar' || messageText === 'edit' || messageText === 'modificar')) {
      await iniciarEdicaoTransacao(sock, userPhone, pendingData);
      // Após editar, reenvia lista de pendentes
      return true;
    }

    // Processar resposta normalmente
    if (messageText === 'sim' || messageText === 's' || messageText === 'confirmar' || messageText === 'ok') {
      // CONFIRMAR TRANSAÇÃO
      if (pendingData.recemDetectada) {
        await confirmarTransacaoPendente(sock, userPhone, pendingData);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: "✅ Transação confirmada e salva com sucesso! Quando quiser, digite '/pendentes' para ver suas pendências." });
        limparPropostaPendente(chatId);
        return true;
      } else {
        await confirmarTransacaoPendente(sock, userPhone, pendingData);
        await tratarComandoPendentes(sock, chatId);
      }
    } else if (messageText === 'depois' || messageText === 'later') {
      // Se for uma transação recém-detectada, apenas atualiza o campo e não exibe a lista
      if (pendingData.recemDetectada) {
        await db.collection("pending_transactions").doc(String(pendingData.id)).update({ recemDetectada: false });
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: "🔔 Ok! Você pode confirmar ou editar essa transação depois. Quando quiser, basta digitar '/pendentes'." });
        limparPropostaPendente(chatId);
        return true;
      } else {
        // Verifica se só existe uma pendência
        const pendentesSnap = await db.collection("pending_transactions")
          .where("userId", "==", cleanPhone)
          .where("status", "in", ["pending_confirmation", "editing"])
          .get();
        if (pendentesSnap.size === 1) {
          await simularDigitar(sock, chatId);
          await sock.sendMessage(chatId, { text: "🔔 Ok! Você pode confirmar ou editar essa transação depois. Quando quiser, basta digitar '/pendentes'." });
          limparPropostaPendente(chatId);
          return true;
        }
        // Fluxo normal: exibe lista de pendentes
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: "🔔 Transação adiada. Veja suas pendências abaixo:" });
        await tratarComandoPendentes(sock, chatId);
        limparPropostaPendente(chatId);
        return true;
      }
    } else if (messageText === 'editar' || messageText === 'edit' || messageText === 'modificar') {
      // INICIAR PROCESSO DE EDIÇÃO
      await iniciarEdicaoTransacao(sock, userPhone, pendingData);  
      
      
    } else if (messageText === 'não' || messageText === 'nao' || messageText === 'n' || messageText === 'cancelar' || messageText === 'cancel') {
      // CANCELAR/RECUSAR TRANSAÇÃO inline
      if (pendingData.recemDetectada) {
        await db.collection("pending_transactions").doc(String(pendingData.id)).delete();
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: '❌ Proposta de transação cancelada/recusada. Nenhuma informação foi salva.\n\nQuando quiser, digite \'/pendentes\' para ver suas pendências.' });
        limparPropostaPendente(chatId);
        return true;
      } else {
        await db.collection("pending_transactions").doc(String(pendingData.id)).delete();
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: '❌ Proposta de transação cancelada/recusada. Nenhuma informação foi salva.' });
        limparPropostaPendente(chatId);
        await tratarComandoPendentes(sock, chatId);
      }

    } else if (messageText === 'depois' || messageText === 'later') {
      // ENCERRAR PENDÊNCIA, usuário vai escolher categoria depois
      await simularDigitar(sock, chatId);
      await sock.sendMessage(chatId, { text: '➡️ Você optou por escolher a categoria depois. A transação não foi salva e a pendência foi encerrada. Quando quiser, adicione manualmente pelo menu ou comando apropriado.' });
      limparPropostaPendente(chatId);
      await tratarComandoPendentes(sock, chatId);
    } else {
      // Resposta não reconhecida
      return false;
    }

    return true; // Mensagem foi processada

  } catch (error) {
    console.error('[PROPOSAL-RESPONSE] Erro ao processar resposta:', error);
    return false;
  }
}

/**
 * Confirma e salva uma transação pendente
 * @param {object} sock - Conexão WhatsApp
 * @param {string} userPhone - Telefone do usuário
 * @param {object} pendingData - Dados da transação pendente
 */
async function confirmarTransacaoPendente(sock, userPhone, pendingData) {
  try {
    const cleanPhone = userPhone.replace(/\D/g, '');
    const chatId = `${cleanPhone}@s.whatsapp.net`;
    // Buscar id da conta (sempre salvar o ID, não o nome)
    const accountId = await idPorNomeDaConta(cleanPhone, pendingData.transactionData.account);
    // Normalizar categoria e garantir no Firebase
    let category = pendingData.transactionData.category || '';
    if (category) {
      category = await normalizarCategoria(category, cleanPhone);
    }
    let categoryLine = '';



    if (category) {
      const { exists, id: categoryId } = await garantirCategoriaNoFirebase(category, cleanPhone, pendingData.transactionData.type);
      
      
      if (!exists && pendingData.transactionData.type === 'despesa') {
        await perguntarOrcamento(sock, chatId, category, pendingData.transactionData.type, cleanPhone);
      } 
      
      else if (!exists && pendingData.transactionData.type === 'receita') {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
          text: `📂 Categoria *"${category}"* adicionada como tipo *${pendingData.transactionData.type}* ✅\n\n💡 Como é uma categoria de receita, *não é necessário definir um orçamento*.`
        });
      }


      categoryLine = `🏷️ Categoria: ${category}\n`;
      pendingData.transactionData.category = category;
    } else {
      categoryLine = '';
    }

    
    // Montar objeto de transação padronizado
    const transactionToSave = {
      id: pendingData.id.toString(),
      account: accountId || pendingData.transactionData.account,
      category: category || '',
      date: pendingData.transactionData.date,
      description: pendingData.transactionData.description || '',
      tag: pendingData.transactionData.tag || 'Detectado automaticamente',
      type: pendingData.transactionData.type,
      userId: cleanPhone,
      value: Number(pendingData.transactionData.value)
    };


    // 1. Salvar transação no Firebase


    const transactionRef = db.collection("transactions").doc(pendingData.id.toString());
    await transactionRef.set(transactionToSave);
    console.log(`[CONFIRM-TRANSACTION] ✅ Transação salva: ${pendingData.id}`);


    // 2. Atualizar saldo da conta


    await atualizarSaldoConta(
      cleanPhone,
      transactionToSave.account,
      transactionToSave.type,
      transactionToSave.value
    );

    console.log(`[CONFIRM-TRANSACTION] ✅ Saldo atualizado`);


    // 3. Remover transação pendente


    await db.collection("pending_transactions").doc(String(pendingData.id)).delete();

    console.log(`[CONFIRM-TRANSACTION] ✅ Transação pendente removida da coleção, id: ${pendingData.id}`);


    // 4. Enviar confirmação


    const emoji = transactionToSave.type === 'receita' ? '🟢' : '🔴';
    const operacao = transactionToSave.type === 'receita' ? 'RECEITA' : 'DESPESA';
    const valor = transactionToSave.value.toFixed(2);

    // Buscar nome da conta pelo id
    let contaNome = transactionToSave.account;
    try {
        const userDoc = await db.collection("users").doc(cleanPhone).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            const contaObj = (userData.accounts || []).find(a => a.id === transactionToSave.account || a.name === transactionToSave.account);
            if (contaObj) contaNome = contaObj.name;
        }
    } catch (e) {
        // fallback: mantém o id se não achar o nome
    }

    let confirmMessage = `✅ *Transação confirmada e salva com sucesso!*\n\n`;
    confirmMessage += `${emoji} *${operacao}*\n`;
    confirmMessage += `💵 Valor: R$ ${valor}\n`;
    confirmMessage += `💼 Conta: ${contaNome}\n`;
    if (categoryLine) confirmMessage += categoryLine;
    confirmMessage += `📅 Data: ${transactionToSave.date}\n`;
    confirmMessage += `\n📱 ID: ${transactionToSave.id}\n`;

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: confirmMessage });


    // Enviar mensagem de saldo atualizado


    await enviarResumoTransacao(sock, chatId, cleanPhone, transactionToSave.account, transactionToSave.type, transactionToSave.value);
    console.log(`[PENDING-TRANSACTIONS] ✅ Confirmação enviada para ${userPhone} | id: ${pendingData.id}`);


    // Limpa o estado pendente de proposta
    limparPropostaPendente(chatId);


  } catch (error) {
    console.error('[PENDING-TRANSACTIONS] Erro ao confirmar transação:', error, '| id:', pendingData?.id);
    // Enviar mensagem de erro
    const cleanPhone = userPhone.replace(/\D/g, '');
    const chatId = `${cleanPhone}@s.whatsapp.net`;
    await sock.sendMessage(chatId, { 
      text: `❌ Erro ao confirmar transação [pendingTransactions]. Tente novamente ou adicione manualmente.` 
    });
  }
}

/**
 * Inicia processo de edição de transação
 * @param {object} sock - Conexão WhatsApp
 * @param {string} userPhone - Telefone do usuário
 * @param {object} pendingData - Dados da transação pendente
 */
async function iniciarEdicaoTransacao(sock, userPhone, pendingData) {
  try {
    const cleanPhone = userPhone.replace(/\D/g, '');
    const chatId = `${cleanPhone}@s.whatsapp.net`;
    console.log(`[EDIT-TRANSACTION] Iniciando edição para transação: ${pendingData.id}`);

    // Carregar dados para o objeto local de edição
    editingTransactions[chatId] = {
      id: pendingData.id,
      transactionData: { ...pendingData.transactionData }
    };

    // Marcar como em edição no Firestore (apenas status)
    await db.collection("pending_transactions").doc(pendingData.id).update({
      status: 'editing',
      editingStartedAt: new Date().toISOString()
    });

    const transactionData = editingTransactions[chatId].transactionData;

    let editMessage = `✏️ *Edição da transação*\n\n`;
    editMessage += `*Dados atuais:*\n`;
    editMessage += `💵 Valor: R$ ${transactionData.value.toFixed(2)}\n`;
    editMessage += `💼 Conta: ${transactionData.account}\n`;
    editMessage += `🏷️ Categoria: ${transactionData.category}\n`;
    editMessage += `📅 Data: ${transactionData.date}\n`;
    editMessage += `📝 Descrição: ${transactionData.description}\n\n`;
    editMessage += `*Para editar, use os comandos de exemplos:*\n`;
    editMessage += `• \`/valor 150.00\` - Alterar valor\n`;
    editMessage += `• \`/categoria Alimentação\` - Alterar categoria\n`;
    editMessage += `• \`/conta Nubank\` - Alterar conta\n`;
    editMessage += `• \`/descricao Nova descrição\` - Alterar descrição\n`;
    editMessage += `• \`/data 2025-07-08\` - Alterar data\n\n`;
    editMessage += `• \`/confirmar\` - Salvar transação editada\n`;
    editMessage += `• \`/cancelar\` - Cancelar edição\n\n`;
    editMessage += `📱 ID: \`${pendingData.id}\``;

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: editMessage });

    console.log(`[EDIT-TRANSACTION] ✅ Menu de edição enviado para ${userPhone}`);
  } catch (error) {
    console.error('[EDIT-TRANSACTION] Erro ao iniciar edição:', error);
  }
}

// Objeto local para armazenar transações em edição por chatId
const editingTransactions = {};

// Função auxiliar para buscar o id da conta pelo nome
async function idPorNomeDaConta(userId, accountName) {
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) return null;
  const userData = userDoc.data();
  const acc = (userData.accounts || []).find(a => a.name === accountName || a.id === accountName);
  return acc ? acc.id : null;
}

// Refatorado: comandos de edição alteram apenas o objeto local
async function tratarComandoDeEdicao(sock, userPhone, command, value) {
  try {
    const cleanPhone = userPhone.replace(/\D/g, '');
    const chatId = `${cleanPhone}@s.whatsapp.net`;
    // Sempre prioriza a pendência selecionada pelo usuário (pendingProposal)
    if (!editingTransactions[chatId]) {
      const pendingProposal = receberPropostaPendente(chatId);
      if (pendingProposal && pendingProposal.transactionData) {
        editingTransactions[chatId] = {
          id: pendingProposal.id || pendingProposal.transactionId || pendingProposal.transactionData.id,
          transactionData: { ...pendingProposal.transactionData }
        };
        // Limpa o pendingProposal após iniciar edição
        require("./utilitariosProposta").limparPropostaPendente(chatId);
      } else {
        // Fallback: busca do Firestore (apenas se não há pendingProposal)
        const editingQuery = db.collection("pending_transactions")
          .where("userId", "==", cleanPhone)
          .where("status", "==", "editing")
          .orderBy("editingStartedAt", "desc")
          .limit(1);
        const snapshot = await editingQuery.get();
        if (snapshot.empty) return false;
        const pendingDoc = snapshot.docs[0];
        editingTransactions[chatId] = {
          id: pendingDoc.id,
          transactionData: { ...pendingDoc.data().transactionData }
        };
      }
    } else {
      console.log(`[EDIT] Edição já em andamento para chatId: ${chatId} | id: ${editingTransactions[chatId].id}`);
    }
    const transactionData = editingTransactions[chatId].transactionData;
    let updateMessage = '';
    switch (command.toLowerCase()) {
      case 'valor': {
        // Aceita tanto vírgula quanto ponto como separador decimal
        const valorLimpo = value.replace(',', '.');
        const newValue = parseFloat(valorLimpo);
        if (isNaN(newValue) || newValue <= 0) {
          await sock.sendMessage(chatId, { text: '❌ Valor inválido. Use apenas números (ex: 150.50 ou 150,50)' });
          return true;
        }
        transactionData.value = newValue;
        updateMessage = `✅ Valor atualizado para R$ ${newValue.toFixed(2)}`;
        break;
      }
      case 'categoria': {
        // Verifica se o valor informado é uma palavra-chave de categoria
        let keywordCategory = buscarCategoriaPorPalavraChave(value);
        if (!keywordCategory) {
          keywordCategory = await normalizarCategoria(value, cleanPhone);
        }
        transactionData.category = keywordCategory;
        updateMessage = `✅ Categoria atualizada para: ${keywordCategory}`;
        break;
      }
      case 'conta':
        transactionData.account = value;
        updateMessage = `✅ Conta atualizada para: ${value}`;
        break;
      case 'descricao':
      case 'descriçao':
      case 'descrição':
        transactionData.description = value;
        updateMessage = `✅ Descrição atualizada para: ${value}`;
        break;
      case 'data':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          await sock.sendMessage(chatId, { text: '❌ Data inválida. Use o formato AAAA-MM-DD (ex: 2025-07-08)' });
          return true;
        }
        transactionData.date = value;
        updateMessage = `✅ Data atualizada para: ${value}`;
        break;
      case 'confirmar': {
        // Ao confirmar, salva em transactions, remove de pending_transactions e limpa local
        const { id } = editingTransactions[chatId];
        const t = editingTransactions[chatId].transactionData;

        // Buscar id da conta (sempre salvar o ID, não o nome)
        const accountId = await idPorNomeDaConta(cleanPhone, t.account);

        // Normalizar categoria e garantir no Firebase

        let category = t.category || '';
        if (category) {
          category = await normalizarCategoria(category, cleanPhone);
        }
        let categoryLine = '';
        if (category) {
          const { exists, id: categoryId } = await garantirCategoriaNoFirebase(category, cleanPhone, t.type);
          if (!exists && t.type === 'despesa') {
            await perguntarOrcamento(sock, chatId, category, t.type, cleanPhone);
          } else if (!exists && t.type === 'receita') {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
              text: `📂 Categoria *"${category}"* adicionada como tipo *${t.type}* ✅\n\n💡 Como é uma categoria de receita, *não é necessário definir um orçamento*.`
            });
          }
          categoryLine = `🏷️ Categoria: ${category}\n`;
        }

        
        // Montar objeto de transação padronizado


        const transactionToSave = {
          id: id.toString(),
          account: accountId || t.account,
          category: category || '',
          date: t.date,
          description: t.description || '',
          tag: t.tag || 'Detectado automaticamente',
          type: t.type,
          userId: cleanPhone,
          value: Number(t.value)
        };

        await db.collection("transactions").doc(id.toString()).set(transactionToSave);

        await atualizarSaldoConta(cleanPhone, transactionToSave.account, transactionToSave.type, transactionToSave.value);
        
        await db.collection("pending_transactions").doc(String(id)).delete();

        console.log(`[EDIT-COMMAND] ✅ Transação editada e salva: ${id}`);

        // Enviar confirmação
        const emoji = transactionToSave.type === 'receita' ? '🟢' : '🔴';
        const operacao = transactionToSave.type === 'receita' ? 'Receita' : 'Despesa';
        const valor = transactionToSave.value.toFixed(2);

        // Buscar nome da conta pelo id
        let contaNome = transactionToSave.account;
        try {
            const userDoc = await db.collection("users").doc(cleanPhone).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const contaObj = (userData.accounts || []).find(a => a.id === transactionToSave.account || a.name === transactionToSave.account);
                if (contaObj) contaNome = contaObj.name;
            }
        } catch (e) {
            // fallback: mantém o id se não achar o nome
        }

        let confirmMessage = `✅ *A transação foi confirmada e salva com sucesso!*\n\n`;
        confirmMessage += `${emoji} *${operacao}*\n`;
        confirmMessage += `💵 Valor: R$ ${valor}\n`;
        confirmMessage += `💼 Conta: ${contaNome}\n`;
        if (categoryLine) confirmMessage += categoryLine;
        confirmMessage += `📅 Data: ${transactionToSave.date}\n`;
        confirmMessage += `\n📱 ID: ${transactionToSave.id}\n`;
        confirmMessage += `✅ Saldo atualizado com sucesso!`;


        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: confirmMessage });


        await enviarResumoTransacao(sock, chatId, cleanPhone, transactionToSave.account, transactionToSave.type, transactionToSave.value);
        delete editingTransactions[chatId];

        limparPropostaPendente(chatId);
        await tratarComandoPendentes(sock, chatId);
        return true;
      }
      
      case 'cancelar': {
        // Cancela edição, remove do local e marca como cancelada no Firestore
        const { id } = editingTransactions[chatId];
        await db.collection("pending_transactions").doc(String(id)).delete();
        await sock.sendMessage(chatId, { text: '❌ Proposta de transação cancelada/recusada. Nenhuma informação foi salva.\n\nQuando quiser, digite \'/pendentes\' para ver suas pendências.' });
        delete editingTransactions[chatId];
        limparPropostaPendente(chatId);
        return true;
      }
      default:
        return false;
    }
    // Apenas envia confirmação da alteração local
    await sock.sendMessage(chatId, { text: updateMessage });
    return true;
  } catch (error) {
    console.error('[EDIT-COMMAND] Erro ao processar comando de edição:', error);
    return false;
  }
}

module.exports = {
  tratarRespostaDePropostaDeTransacao,
  tratarComandoDeEdicao,
  confirmarTransacaoPendente,
  iniciarEdicaoTransacao // Adicionado para permitir uso externo
};
