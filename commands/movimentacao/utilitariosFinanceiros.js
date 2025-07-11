const { obterRotinas, atualizarRotinas } = require("../firebaseFolder/rotinasFirebase");
const moment = require("moment-timezone");
const { simularDigitar } = require("../utilitariosComandos");
const db = require("../firebaseFolder/firebase");
const levenshtein = require("fast-levenshtein");

const lembretesAtivos = {}; // Estado para rastrear lembretes ativos

// Função para validar o formato de horário
function validarFormatoHora(time) {
    const regex = /^\d{2}:\d{2}$/;
    return regex.test(time);
}

// Função para obter todas as transações do Firebase
async function obterTransacoes(userId) {
    try {
        const transactionsRef = db.collection("transactions").where("userId", "==", userId);
        const snapshot = await transactionsRef.get();

        if (snapshot.empty) {
            console.log("[DEBUG] Nenhuma transação encontrada no Firebase para o usuário:", userId);
            return [];
        }

        const transactions = snapshot.docs.map(doc => doc.data());
        console.log("[DEBUG] Transações retornadas do Firebase:", transactions);

        return transactions;
    } catch (error) {
        console.error("[ERRO] Falha ao buscar transações no Firebase:", error);
        return [];
    }
}

// Função para obter o próximo ID baseado nas transações existentes
async function gerarProximoIdDeTransacao() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 5);
}

// Função para formatar a resposta das transações
function formatarRespostaTransacao(transactions) {
    if (!transactions || transactions.length === 0) {
        return "Nenhuma transação encontrada.";
    }

    let response = "📋 Transações Registradas:\n";
    transactions.forEach((transaction, index) => {
        const { id, date, type, value } = transaction;
        response += `${index + 1}. ID: ${id} | Data: ${date} | Tipo: ${type} | Valor: R$ ${parseFloat(value).toFixed(2)}\n`;
    });

    return response;
}


/**
 * Atualiza o saldo de uma conta no Firebase após uma transação.
 * @param {string} userId
 * @param {string} accountNameOrId - Nome ou ID da conta
 * @param {string} type - "receita" ou "despesa"
 * @param {number} value
 */
async function atualizarSaldoConta(userId, accountNameOrId, type, value) {
    try {
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            throw new Error(`Usuário ${userId} não encontrado no Firebase.`);
        }

        const userData = userDoc.data();
        const accounts = userData.accounts || [];

        // Procurar conta por ID primeiro, depois por nome
        const accountIndex = accounts.findIndex(acc =>
            acc.id === accountNameOrId || acc.name === accountNameOrId
        );

        if (accountIndex === -1) {
            throw new Error(`Conta "${accountNameOrId}" não encontrada para o usuário ${userId}.`);
        }

        // Atualizar saldo baseado no tipo de transação
        const currentBalance = parseFloat(accounts[accountIndex].balance) || 0;
        const newBalance = type === "receita"
            ? currentBalance + value
            : currentBalance - value;

        accounts[accountIndex].balance = newBalance;

        await userRef.update({ accounts });

        console.log(`✅ Saldo da conta "${accounts[accountIndex].name}" atualizado: ${currentBalance} → ${newBalance}`);
    } catch (error) {
        console.error("❌ Erro ao atualizar saldo da conta no Firebase:", error);
        throw error;
    }
}

const { NlpManager } = require("node-nlp");

const palavrasChave = {
    tipo: {
        despesa: [
            "gastei", "paguei", "comprei", "investi", "desembolsei", "despesa",
            "debitou", "saquei", "fiz compra", "contraí dívida", "fiz pagamento",
            "queimei dinheiro", "saiu", "retirei", "adicionei custo", "tive gasto"
        ],
        receita: [
            "recebi", "ganhei", "lucrei", "rendeu", "faturei", "receita",
            "obtive", "arrecadei", "me pagaram", "entrou grana", "caiu na conta",
            "conquistei", "adquiri", "herdei", "consegui", "fiz venda"
        ]
    },
    categorias: {
        alimentacao: [
            "iFood", "lanche", "pizza", "restaurante", "sushi", "hamburgueria", "delivery", "cafeteria"
        ],
        serviços: ["assinatura", "assinaturas", "serviço de streaming", "seviço", "serviços", "squarecloud",
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
            "condomínio", "IPTU", "gás", "tv a cabo",
            "manutenção", "reforma", "decoração", "jardim", "limpeza",
            "seguro residencial", "faxina", "piscina", "lavanderia", "cuidados domésticos", "encanamento", "elétrica", "pintura"
        ],
        lazer: ["lazer", "diversão", "entretenimento", "cultura", "esporte", "bebida",
            "viagem", "pub", "parque de diversões", "bar", "balada", "festa", "evento",
            "jogo", "hobby", "passatempo", "museu", "teatro", "zoológico", "aquário", "karaokê", "cinema", "shopping"
        ],
        transporte: [
            "gasolina", "pedágio", "estacionamento", "mecânico", "lavagem", 
            "seguro do carro", "IPVA", "licenciamento", "oficina", "bicicleta",
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
    },
    contas: [
        "inter", "next", "picpay", "meliuz", "banco digital",
        "banco tradicional", "conta corrente", "poupança", "investimento", "CDB",
        "criptomoeda", "conjunta", "empresarial", "paypal", "conta salário", "nuconta", "bradesco", "itau", "caixa econômica"
    ]
};

const manager = new NlpManager({ languages: ["pt"], forceNER: true });

async function treinarGerenciadorNLP() {
    for (const [tipo, palavras] of Object.entries(palavrasChave.tipo)) {
        manager.addNamedEntityText("tipo", tipo, ["pt"], palavras);
    }
    for (const [categoria, palavras] of Object.entries(palavrasChave.categorias)) {
        manager.addNamedEntityText("categoria", categoria, ["pt"], palavras);
    }
    manager.addNamedEntityText("conta", "conta", ["pt"], palavrasChave.contas);

    const valores = [
        "10 reais", "15", "99,90", "120.00", "200", "300,50",
        "R$400", "500 reais", "mil reais", "1000", "2.000,00",
        "20 reais", "30", "50,00", "100.00"
    ];
    manager.addNamedEntityText("valor", "valor", ["pt"], valores);

    await manager.train();
    await manager.save();
}

/**
 * Notifica o usuário sobre o status do orçamento da categoria após uma despesa.
 * Mostra quanto já foi gasto, porcentagem do orçamento, quanto falta ou excedente.
 * @param {object} sock - Instância do WhatsApp sock
 * @param {string} chatId - ID do chat do usuário
 * @param {string} userId - ID do usuário
 * @param {string} category - Nome da categoria
 */
async function notificarStatusOrcamento(sock, chatId, userId, category) {
    try {
        const moment = require("moment-timezone");
        const db = require("../firebaseFolder/firebase");
        const { simularDigitar } = require("../utilitariosComandos");

        // Buscar categoria no Firebase
        const categories = await db.collection("categories").where("userId", "==", userId).get();
        const categoriaAtual = categories.docs.map(doc => doc.data()).find(cat =>
            cat.name.toLowerCase() === category.toLowerCase()
        );

        if (categoriaAtual && categoriaAtual.budget && !isNaN(categoriaAtual.budget)) {
            // Buscar todas as despesas do usuário nessa categoria no mês atual
            const now = moment().tz("America/Sao_Paulo");
            const primeiroDia = now.clone().startOf("month").format("YYYY-MM-DD");
            const ultimoDia = now.clone().endOf("month").format("YYYY-MM-DD");

            const despesasSnapshot = await db.collection("transactions")
                .where("userId", "==", userId)
                .where("category", "==", category)
                .where("type", "==", "despesa")
                .where("date", ">=", primeiroDia)
                .where("date", "<=", ultimoDia)
                .get();

            let totalGasto = 0;
            despesasSnapshot.forEach(doc => {
                const data = doc.data();
                totalGasto += Number(data.value) || 0;
            });

            // Calcular porcentagem e quanto falta
            const orcamento = Number(categoriaAtual.budget);
            const porcentagem = (totalGasto / orcamento) * 100;
            const falta = orcamento - totalGasto;

            let aviso = `📊 *Orçamento da categoria "${category}":*\n`;
            aviso += `• Orçamento mensal: R$ ${orcamento.toFixed(2)}\n`;
            aviso += `• Gasto até agora: R$ ${totalGasto.toFixed(2)}\n`;

            if (porcentagem < 100) {
                aviso += `• Você já usou *${porcentagem.toFixed(1)}%* do seu orçamento.\n`;
                aviso += `• Ainda pode gastar *R$ ${falta.toFixed(2)}* neste mês nessa categoria.`;
            } else {
                aviso += `🚨 *Atenção!* Você já passou *${(porcentagem - 100).toFixed(1)}%* do seu planejamento para essa categoria.\n`;
                aviso += `• Excedente: R$ ${(Math.abs(falta)).toFixed(2)}`;
            }

            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, { text: aviso });
        }
    } catch (error) {
        console.error("[ERRO] Falha ao notificar orçamento da categoria:", error);
    }
}

/**
 * Função para encontrar conta por aproximação usando fuzzy matching
 * @param {string} accountHint - Nome parcial ou abreviação da conta mencionada pelo usuário
 * @param {Array} availableAccounts - Array com as contas disponíveis do usuário
 * @param {number} threshold - Limite de similaridade (menor valor = mais similar)
 * @returns {Object|null} - Conta encontrada ou null se não houver match
 */
function buscarContaComFuzzy(accountHint, availableAccounts, threshold = 3) {
    if (!accountHint || !availableAccounts || availableAccounts.length === 0) {
        return null;
    }
    const normalizedHint = accountHint.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = threshold + 1;
    for (const account of availableAccounts) {
        const accountName = account.name.toLowerCase();
        if (accountName === normalizedHint) return account;
        if (accountName.includes(normalizedHint)) return account;
        if (accountName.startsWith(normalizedHint)) return account;
        const distance = levenshtein.get(normalizedHint, accountName);
        if (distance < bestScore) {
            bestScore = distance;
            bestMatch = account;
        }
        const accountWords = accountName.split(' ');
        for (const word of accountWords) {
            if (word.includes(normalizedHint) || normalizedHint.includes(word)) {
                return account;
            }
        }
    }
    if (bestScore <= threshold) return bestMatch;
    return null;
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
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9çáéíóúãõâêîôûàèìòùäëïöüñ\s,]/gi, "");
    preposicoes.forEach(prep => {
        const regex = new RegExp(`\\b${prep}\\b`, "g");
        normalizedText = normalizedText.replace(regex, "");
    });
    normalizedText = normalizedText.replace(/\s+/g, " ").trim();
    return normalizedText;
}

/**
 * Função para extrair data de uma mensagem de transação.
 * @param {string} message - Mensagem original
 * @returns {string} Data no formato YYYY-MM-DD
 */
function extrairDiaDaMensagem(message) {
    const anoAtual = moment().tz("America/Sao_Paulo").year();
    const dataAtual = moment().tz("America/Sao_Paulo");
    const padroesDeData = [
        /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/,
        /\b(\d{1,2})\/(\d{1,2})\b/,
        /\b(\d{1,2})-(\d{1,2})-(\d{4})\b/,
        /\b(\d{1,2})-(\d{1,2})\b/,
        /\bdia\s+(\d{1,2})(?:\/(\d{1,2}))?\b/i,
        /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i
    ];
    const mapaDeMeses = {
        janeiro: 1, fevereiro: 2, março: 3, abril: 4,
        maio: 5, junho: 6, julho: 7, agosto: 8,
        setembro: 9, outubro: 10, novembro: 11, dezembro: 12
    };
    const palavrasChavesRelativas = {
        hoje: 0,
        ontem: -1,
        anteontem: -2,
        "semana passada": -7,
        "mês passado": -30
    };
    for (const [keyword, daysOffset] of Object.entries(palavrasChavesRelativas)) {
        if (message.toLowerCase().includes(keyword)) {
            const dataAlvo = dataAtual.clone().add(daysOffset, 'days');
            return dataAlvo.format("YYYY-MM-DD");
        }
    }
    for (const pattern of padroesDeData) {
        const match = message.match(pattern);
        if (match) {
            let day, month, year;
            if (pattern === padroesDeData[0]) {
                day = parseInt(match[1]);
                month = parseInt(match[2]);
                year = parseInt(match[3]);
            } else if (pattern === padroesDeData[1]) {
                day = parseInt(match[1]);
                month = parseInt(match[2]);
                year = anoAtual;
            } else if (pattern === padroesDeData[2]) {
                day = parseInt(match[1]);
                month = parseInt(match[2]);
                year = parseInt(match[3]);
            } else if (pattern === padroesDeData[3]) {
                day = parseInt(match[1]);
                month = parseInt(match[2]);
                year = anoAtual;
            } else if (pattern === padroesDeData[4]) {
                day = parseInt(match[1]);
                month = match[2] ? parseInt(match[2]) : dataAtual.month() + 1;
                year = anoAtual;
            } else if (pattern === padroesDeData[5]) {
                day = parseInt(match[1]);
                month = mapaDeMeses[match[2].toLowerCase()];
                year = anoAtual;
            }
            if (day && month && year) {
                return moment.tz({ year, month: month - 1, day }, "America/Sao_Paulo").format("YYYY-MM-DD");
            }
        }
    }
    return dataAtual.format("YYYY-MM-DD");
}


/**
 * Função para interpretar a mensagem e extrair os dados básicos da transação.
 * @param {string} message
 * @param {object} sock
 * @param {string} chatId
 * @param {string} senderNumber
 * @returns {object|null} { date, type, value, category, account, senderNumber }
 */
async function interpretarMensagemTransacao(message, sock, chatId, senderNumber, userAccounts = []) {
    console.log("[LOG] Iniciando interpretação da mensagem com NLP (financeiroUtils)...\n");

    const normalizedMessage = normalizarMensagem(message);
    console.log(`[DEBUG] Mensagem normalizada: ${normalizedMessage}`);

    // Extrair data da mensagem original (antes da normalização)
    const extractedDate = extrairDiaDaMensagem(message);
    console.log(`[DEBUG] Data extraída da mensagem: ${extractedDate}`);

    // Processar a mensagem com o NLP centralizado
    const response = await manager.process("pt", normalizedMessage);
    //console.log(`[DEBUG NLP] Resposta completa do NLP: ${JSON.stringify(response, null, 2)}`);

    // Identificar tipo de transação
    let type = null;
    const tipoEntity = response.entities.find(e => e.entity === "tipo");
    if (tipoEntity) {
        type = tipoEntity.option || tipoEntity.sourceText;
    } else if (response.intent === "despesa" || response.intent === "receita") {
        type = response.intent;
    }

    // Identificar valor
    let value = null;
    const valueEntity = response.entities.find(e => e.entity === "valor");
    if (valueEntity) {
        const raw = valueEntity.sourceText.replace(/[^\d,\.]/g, "");
        // Se tem vírgula, trata como centavos. Se não, é valor inteiro.
        if (raw.includes(",")) {
            value = parseFloat(raw.replace(".", "").replace(",", "."));
        } else {
            value = parseFloat(raw.replace(".", ""));
        }
    }

    // Fallback para valor
    if (!value) {
        // Procura valores acompanhados de "reais", "r$", ou com vírgula/ponto decimal
        const valueRegex = /(\d+(?:[.,]\d{2})?)\s*(reais|real|r\$)?/gi;
        let match;
        let bestMatch = null;
        while ((match = valueRegex.exec(normalizedMessage)) !== null) {
            // Se for "99" e a palavra "99" também for categoria, ignore como valor
            if (
                match[1] === "99" &&
                Object.values(palavrasChave.categorias).some(arr => arr.includes("99")) &&
                normalizedMessage.includes("99")
            ) {
                continue; // Pula esse match
            }
            // Se tem vírgula, trata como centavos. Se não, é valor inteiro.
            if (match[1].includes(",")) {
                bestMatch = parseFloat(match[1].replace(".", "").replace(",", "."));
            } else {
                bestMatch = parseFloat(match[1].replace(".", ""));
            }
            break;
        }
        if (bestMatch) value = bestMatch;
    }

    // Identificar categoria (usando entidades do NLP)
    let category = null;
    const categoryEntities = response.entities.filter(e => e.entity === "categoria");
    if (categoryEntities.length > 0) {
        let bestCategory = null;
        let bestScore = 0;
        for (const entity of categoryEntities) {
            const accuracy = entity.accuracy || 0;
            const sourceLength = entity.sourceText ? entity.sourceText.length : 0;
            const score = accuracy + (sourceLength * 0.1);
            if (score > bestScore) {
                bestScore = score;
                bestCategory = entity;
            }
        }
        if (bestCategory) {
            category = bestCategory.option || bestCategory.sourceText;
        }
    }

    // Identificar conta
    let account = null;
    const accountEntity = response.entities.find(e => e.entity === "conta");
    if (accountEntity) {
        account = accountEntity.option || accountEntity.sourceText;
    }

    // Fallback manual para tipo
    if (!type) {
        for (const [tipo, palavras] of Object.entries(palavrasChave.tipo)) {
            for (const palavra of palavras) {
                if (normalizedMessage.includes(palavra)) {
                    type = tipo;
                    break;
                }
            }
            if (type) break;
        }
    }

    // Fallback manual para categoria usando palavrasChave
    if (!category) {
        const originalWords = message.toLowerCase().split(/\s+/);
        let bestCategory = null;
        let maxScore = 0;
        for (const [categoryName, keywords] of Object.entries(palavrasChave.categorias)) {
            let score = 0;
            for (const keyword of keywords) {
                for (const word of originalWords) {
                    if (word.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(word)) {
                        const similarity = Math.min(word.length, keyword.length) / Math.max(word.length, keyword.length);
                        const wordScore = keyword.length * similarity;
                        score += wordScore;
                    }
                }
            }
            if (score > maxScore) {
                maxScore = score;
                bestCategory = categoryName;
            }
        }
        if (maxScore > 0) {
            category = bestCategory;
        }
    }

    // Fallback para valor
    if (!value) {
        const valueMatch = normalizedMessage.match(/\d+([.,]\d{1,2})?/);
        if (valueMatch) value = parseFloat(valueMatch[0].replace(",", "."));
    }

    // Fuzzy matching para conta
    let detectedAccount = null;
    if (userAccounts && userAccounts.length > 0) {
        // Se só existe uma conta, associe automaticamente
        if (userAccounts.length === 1) {
            detectedAccount = userAccounts[0];
        } else {
            const possibleAccountHints = [];
            const words = message.toLowerCase().split(/\s+/);
            for (const word of words) {
                if (word.length >= 2 && !['do', 'da', 'no', 'na', 'com', 'para', 'por', 'em', 'de', 'um', 'uma', 'que', 'foi', 'ser', 'ter', 'seu', 'sua'].includes(word)) {
                    possibleAccountHints.push(word);
                }
            }
            for (const hint of possibleAccountHints) {
                const matchedAccount = buscarContaComFuzzy(hint, userAccounts);
                if (matchedAccount) {
                    detectedAccount = matchedAccount;
                    break;
                }
            }
            if (!detectedAccount && account) {
                detectedAccount = buscarContaComFuzzy(account, userAccounts);
            }
        }
    }

    if (!type || !value) {
        console.log("[ERRO] Dados insuficientes mesmo após NLP e fallback.");
        return null;
    }

    return {
        date: extractedDate,
        type,
        value,
        category,
        account,
        detectedAccount,
        senderNumber
    };
}


/**
 * Função para encontrar conta por aproximação usando fuzzy matching
 * @param {string} accountHint - Nome parcial ou abreviação da conta mencionada pelo usuário
 * @param {Array} availableAccounts - Array com as contas disponíveis do usuário
 * @param {number} threshold - Limite de similaridade (menor valor = mais similar)
 * @returns {Object|null} - Conta encontrada ou null se não houver match
 */
function buscarContaComFuzzy(accountHint, availableAccounts, threshold = 3) {
    if (!accountHint || !availableAccounts || availableAccounts.length === 0) {
        return null;
    }

    const normalizedHint = accountHint.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = threshold + 1; // Inicializar com valor acima do threshold

    console.log(`[LOG FUZZY] Procurando conta para: "${normalizedHint}"`);
    console.log(`[LOG FUZZY] Contas disponíveis: ${availableAccounts.map(acc => acc.name).join(', ')}`);

    for (const account of availableAccounts) {
        const accountName = account.name.toLowerCase();

        // 1. Verificar match exato
        if (accountName === normalizedHint) {
            console.log(`[LOG FUZZY] Match exato encontrado: ${account.name}`);
            return account;
        }

        // 2. Verificar se o hint está contido no nome da conta
        if (accountName.includes(normalizedHint)) {
            console.log(`[LOG FUZZY] Match por substring encontrado: ${account.name}`);
            return account;
        }

        // 3. Verificar se o nome da conta começa com o hint
        if (accountName.startsWith(normalizedHint)) {
            console.log(`[LOG FUZZY] Match por prefixo encontrado: ${account.name}`);
            return account;
        }

        // 4. Verificar similaridade usando Levenshtein distance
        const distance = levenshtein.get(normalizedHint, accountName);
        console.log(`[LOG FUZZY] Distância entre "${normalizedHint}" e "${accountName}": ${distance}`);

        if (distance < bestScore) {
            bestScore = distance;
            bestMatch = account;
        }

        // 5. Verificar palavras individuais (para casos como "C6" em "C6 Bank")
        const accountWords = accountName.split(' ');
        for (const word of accountWords) {
            if (word.includes(normalizedHint) || normalizedHint.includes(word)) {
                console.log(`[LOG FUZZY] Match por palavra encontrado: ${account.name} (palavra: ${word})`);
                return account;
            }
        }
    }

    // Retornar o melhor match se estiver dentro do threshold
    if (bestScore <= threshold) {
        console.log(`[LOG FUZZY] Melhor match encontrado: ${bestMatch.name} (score: ${bestScore})`);
        return bestMatch;
    }

    console.log(`[LOG FUZZY] Nenhum match encontrado para "${normalizedHint}"`);
    return null;
}

module.exports = {
    validarFormatoHora,
    obterTransacoes,
    gerarProximoIdDeTransacao,
    formatarRespostaTransacao,
    atualizarSaldoConta,
    palavrasChave,
    manager,
    treinarGerenciadorNLP,
    notificarStatusOrcamento,
    buscarContaComFuzzy,
    normalizarMensagem,
    extrairDiaDaMensagem,
    interpretarMensagemTransacao
};