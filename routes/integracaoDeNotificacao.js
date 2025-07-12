// Integração para receber transações automáticas do app de detecção de notificações
// Este arquivo implementa endpoints REST para processar transações bancárias detectadas automaticamente

const { gerarProximoIdDeTransacao, atualizarSaldoConta } = require("../commands/movimentacao/utilitariosFinanceiros");
const { simularDigitar } = require("../commands/utilitariosComandos");
const db = require("../commands/firebaseFolder/firebase");
const levenshtein = require("fast-levenshtein");
const { enviarPropostaPendente } = require("../commands/base");

// Função utilitária para log padronizado (agora global)
function registrarComContexto(context, msg, extra = {}) {
  const base = `[${context}] ${msg}`;
  if (Object.keys(extra).length > 0) {
    console.log(base, JSON.stringify(extra));
  } else {
    console.log(base);
  }
}

// Adicionar no topo do arquivo para garantir referência global ao sock
let currentSock = null;

/**
 * Configura os endpoints de integração no servidor Express
 * @param {object} app - Instância do Express
 * @param {object} sock - Conexão WhatsApp
 */
async function configurarEndpointNotificacao(app, sock) {
  registrarComContexto('INTEGRATION', 'Configurando endpoints de integração...');
  currentSock = sock; // Atualiza referência global sempre que o endpoint é reconfigurado
  
  // Middleware para CORS - permitir requisições do app mobile
  app.use('/api/*', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    // Responder a requisições OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
      console.log("[INTEGRATION] Requisição OPTIONS (preflight) recebida");
      return res.status(200).end();
    }
    
    next();
  });

  // Middleware para log de requisições
  app.use('/api/*', (req, res, next) => {
    console.log(`[INTEGRATION] ${req.method} ${req.path} - Origin: ${req.get('Origin') || 'Unknown'}`);
    console.log(`[INTEGRATION] User-Agent: ${req.get('User-Agent') || 'Unknown'}`);
    next();
  });
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    console.log("[INTEGRATION] Health check solicitado");
    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'WhatsApp Financial Bot',
      version: '1.0.0',
      environment: 'squarecloud',
      whatsapp: sock ? 'connected' : 'not_connected',
      endpoints: {
        health: '/health',
        sendMessage: '/api/send-message'
      }
    });
  });

  // Endpoint principal para receber transações do app mobile
  app.post('/api/send-message', async (req, res) => {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    registrarComContexto('INTEGRATION', `[${requestId}] Requisição POST /api/send-message recebida`, { ip: req.ip, userAgent: req.get('User-Agent') });
    // Logar o corpo completo da requisição
    console.log(`[INTEGRATION] [${requestId}] Body recebido:`, JSON.stringify(req.body, null, 2));
    try {
      const { phone, message, type, data } = req.body;
      registrarComContexto('INTEGRATION', `[${requestId}] Dados recebidos`, { phone, type, hasData: !!data, messageLength: message?.length || 0 });
      
      // Validar dados obrigatórios
      if (!phone) {
        registrarComContexto('INTEGRATION', `[${requestId}] ❌ Erro: Telefone não fornecido`);
        return res.status(400).json({ 
          success: false, 
          error: 'Número de telefone é obrigatório',
          requestId
        });
      }

      // Validação do formato do telefone
      const phoneRegex = /^\d{10,15}$/;
      const cleanPhone = phone.replace(/\D/g, '');
      if (!phoneRegex.test(cleanPhone)) {
        registrarComContexto('INTEGRATION', `[${requestId}] ❌ Formato de telefone inválido: ${phone}`);
        return res.status(400).json({ 
          success: false, 
          error: 'Formato de telefone inválido. Use apenas números.',
          requestId
        });
      }

      // Sempre usar currentSock atualizado
      const sockToUse = currentSock;
      if (type === 'transaction' && data) {
        registrarComContexto('INTEGRATION', `[${requestId}] 💰 Processando transação automática`);
        registrarComContexto('INTEGRATION', `[${requestId}] Dados da transação:`, JSON.stringify(data, null, 2));
        let sockReady = sockToUse;
        if (!sockReady && global.tryReconnectWhatsApp) {
          registrarComContexto('INTEGRATION', `[${requestId}] ⚠️ WhatsApp não conectado - tentando reconectar antes de processar...`);
          sockReady = await global.tryReconnectWhatsApp();
          currentSock = sockReady;
        }
        if (!sockReady) {
          registrarComContexto('INTEGRATION', `[${requestId}] ❌ WhatsApp não disponível após tentativa de reconexão. Transação NÃO será processada nem armazenada.`);
          return res.status(503).json({
            success: false,
            error: 'WhatsApp não está conectado. Tente novamente em instantes.',
            requestId
          });
        }
        // Processar transação detectada automaticamente
        const result = await processarTransacaoDetectadaAutomaticamente(cleanPhone, data, sockReady);
        
        const processingTime = Date.now() - startTime;
        
        if (result.success) {
          registrarComContexto(
            'INTEGRATION',
            `[${requestId}] ✅ Transação processada com sucesso`,
            {
              transactionId: result.transactionId,
              account: result.account,
              category: result.category,
              value: result.value,
              status: result.status,
              processingTime: `${processingTime}ms`,
              user: cleanPhone
            }
          );
          res.status(200).json({ 
            success: true, 
            transactionId: result.transactionId,
            account: result.account,
            category: result.category,
            message: 'Transação processada e salva com sucesso',
            requestId,
            processingTime: `${processingTime}ms`
          });
        } else {
          registrarComContexto(
            'INTEGRATION',
            `[${requestId}] ❌ Erro ao processar transação`,
            {
              error: result.error,
              processingTime: `${processingTime}ms`,
              user: cleanPhone,
              data
            }
          );
          res.status(400).json({ 
            success: false, 
            error: result.error,
            requestId,
            processingTime: `${processingTime}ms`
          });
        }
        
      } else if (type === 'test') {
        registrarComContexto('INTEGRATION', `[${requestId}] 🧪 Processando mensagem de teste`);
        
        // Verificar se WhatsApp está conectado
        if (!sockToUse) {
          registrarComContexto('INTEGRATION', `[${requestId}] ⚠️ WhatsApp não conectado - tentando reconectar...`);
          
          // Tentar reconectar (se função estiver disponível)
          if (global.tryReconnectWhatsApp) {
            try {
              registrarComContexto('INTEGRATION', `[${requestId}] 🔄 Iniciando tentativa de reconexão...`);
              currentSock = await global.tryReconnectWhatsApp();
              
              if (!currentSock) {
                registrarComContexto('INTEGRATION', `[${requestId}] ❌ Falha na reconexão - retornando status desconectado`);
                const processingTime = Date.now() - startTime;
                return res.status(200).json({ 
                  success: false, 
                  message: 'WhatsApp desconectado e falha na reconexão automática',
                  whatsappStatus: 'failed_reconnect',
                  requestId,
                  processingTime: `${processingTime}ms`
                });
              }
              
              registrarComContexto('INTEGRATION', `[${requestId}] ✅ Reconexão bem-sucedida!`);
            } catch (reconnectError) {
              registrarComContexto('INTEGRATION', `[${requestId}] ❌ Erro na reconexão`, { error: reconnectError.message });
              const processingTime = Date.now() - startTime;
              return res.status(200).json({ 
                success: false, 
                message: 'WhatsApp desconectado e erro na reconexão',
                whatsappStatus: 'reconnect_error',
                requestId,
                processingTime: `${processingTime}ms`
              });
            }
          } else {
            registrarComContexto('INTEGRATION', `[${requestId}] ⚠️ Função de reconexão não disponível`);
            const processingTime = Date.now() - startTime;
            return res.status(200).json({ 
              success: false, 
              message: 'WhatsApp desconectado e reconexão automática não disponível',
              whatsappStatus: 'disconnected_no_reconnect',
              requestId,
              processingTime: `${processingTime}ms`
            });
          }
        }
        
        // Mensagem de teste para verificar conectividade
        await currentSock.sendMessage(`${cleanPhone}@s.whatsapp.net`, {
          text: "✅ *Conexão estabelecida!*\n\n🤖 Bot financeiro está funcionando corretamente.\n📱 App de detecção conectado com sucesso.\n🌐 Rodando na Squarecloud\n\n🔄 Pronto para receber transações automáticas!"
        });
        
        const processingTime = Date.now() - startTime;
        registrarComContexto('INTEGRATION', `[${requestId}] ✅ Mensagem de teste enviada em ${processingTime}ms`);
        
        res.status(200).json({ 
          success: true, 
          message: 'Mensagem de teste enviada com sucesso',
          requestId,
          processingTime: `${processingTime}ms`
        });
        
      } else {
        registrarComContexto('INTEGRATION', `Tipo de mensagem não suportado: ${type}`);
        res.status(400).json({ 
          success: false, 
          error: `Tipo de mensagem não suportado: ${type}. Use 'transaction' ou 'test'` 
        });
      }
      
    } catch (error) {
      registrarComContexto('INTEGRATION', `[${requestId}] ❌ Erro interno no processamento`, { error: error.message });
      
      const processingTime = Date.now() - startTime;
      
      // Resposta de erro estruturada
      res.status(500).json({ 
        success: false, 
        error: 'Erro interno do servidor. Tente novamente.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        requestId,
        processingTime: `${processingTime}ms`
      });
    }
  });
  registrarComContexto('INTEGRATION', 'Endpoints configurados:', { endpoints: ['/health', '/api/send-message', '/api/register-ip'] });

  // Endpoint para registrar o IP do app no dispositivo do usuário
  app.post('/api/register-ip', async (req, res) => {
    const requestId = `ipreq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { phone, ip } = req.body;
    registrarComContexto('INTEGRATION', `[${requestId}] Requisição POST /api/register-ip recebida`, { phone, ip, userAgent: req.get('User-Agent') });
    if (!phone || !ip) {
      registrarComContexto('INTEGRATION', `[${requestId}] ❌ Erro: Telefone ou IP não fornecido`);
      return res.status(400).json({
        success: false,
        error: 'Número de telefone e IP são obrigatórios',
        requestId
      });
    }
    const cleanPhone = phone.replace(/\D/g, '');
    try {
      // Salvar o IP no documento do usuário no Firebase
      await db.collection('users').doc(cleanPhone).set({
        lastAppIp: ip,
        lastIpUpdatedAt: new Date().toISOString()
      }, { merge: true });
      registrarComContexto('INTEGRATION', `[${requestId}] ✅ IP registrado com sucesso para usuário ${cleanPhone}`);
      res.status(200).json({
        success: true,
        message: 'IP registrado com sucesso',
        requestId
      });
    } catch (error) {
      registrarComContexto('INTEGRATION', `[${requestId}] ❌ Erro ao registrar IP`, { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Erro ao registrar IP',
        details: error.message,
        requestId
      });
    }
  });
}

/**
 * Processa uma transação detectada automaticamente pelo app mobile
 * @param {string} userPhone - Número do telefone do usuário
 * @param {object} transactionData - Dados da transação detectada
 * @param {object} sock - Conexão WhatsApp
 * @returns {object} Resultado do processamento
 */
async function processarTransacaoDetectadaAutomaticamente(userPhone, transactionData, sock) {
  const cleanPhone = userPhone.replace(/\D/g, '');
  registrarComContexto('AUTO-TRANSACTION', `Iniciando processamento para usuário: ${cleanPhone}`);
  registrarComContexto('AUTO-TRANSACTION', 'Dados recebidos', transactionData);
  try {
    // 1. Verificar se usuário existe no sistema
    registrarComContexto('AUTO-TRANSACTION', `Verificando se usuário ${cleanPhone} existe...`);
    const userDoc = await db.collection("users").doc(cleanPhone).get();
    
    if (!userDoc.exists) {
      const errorMsg = `Usuário ${cleanPhone} não encontrado no sistema. Faça o cadastro primeiro.`;
      registrarComContexto('AUTO-TRANSACTION', errorMsg);
      throw new Error(errorMsg);
    }

    const userData = userDoc.data();
    registrarComContexto('AUTO-TRANSACTION', `Usuário encontrado. Contas disponíveis: ${userData.accounts?.length || 0}`);

    // 2. Detectar conta do usuário baseada no banco
    registrarComContexto('AUTO-TRANSACTION', `Detectando conta para o banco: ${transactionData.bank}`);
    const detectedAccount = await detectarContaUsuarioPorBanco(cleanPhone, transactionData.bank, userData.accounts);
    
    if (!detectedAccount) {
      const errorMsg = `Não foi possível detectar uma conta para o banco: ${transactionData.bank}`;
      registrarComContexto('AUTO-TRANSACTION', errorMsg);
      throw new Error(errorMsg);
    }
    
    registrarComContexto('AUTO-TRANSACTION', `Conta detectada: ${detectedAccount.name} (ID: ${detectedAccount.id})`);

    // 3. Detectar categoria baseada no contexto da transação
    registrarComContexto('AUTO-TRANSACTION', `Detectando categoria...`);
    const detectedCategory = await detectarCategoriaTransacaoSmart(transactionData, cleanPhone);
    registrarComContexto('AUTO-TRANSACTION', `Categoria detectada: ${detectedCategory || '(nenhuma)'}`);
    // 4. NÃO criar categoria no Firebase aqui!
    // 5. Gerar ID único para a transação
    const transactionId = generateRandomId();
    registrarComContexto('AUTO-TRANSACTION', `ID da transação gerado: ${transactionId}`);

    // 6. Preparar dados da transação no formato do sistema
    const transactionToSave = {
      id: transactionId,
      date: transactionData.date || new Date().toISOString().split('T')[0],
      type: transactionData.type,
      value: parseFloat(transactionData.amount || transactionData.value || 0),
      description: construirDescricaoTransacao(transactionData),
      account: detectedAccount.name,
      accountId: detectedAccount.id,
      category: detectedCategory || '',
      categoryId: '',
      tag: "Detectado automaticamente",
      userId: cleanPhone,
      originalData: transactionData, // Manter dados originais para referência
      createdAt: new Date().toISOString(),
      source: "mobile-app"
    };

    registrarComContexto('AUTO-TRANSACTION', 'Dados preparados para salvamento', {
      id: transactionToSave.id,
      type: transactionToSave.type,
      value: transactionToSave.value,
      account: transactionToSave.account,
      category: transactionToSave.category
    });

    // 7. Enviar proposta para confirmação
    registrarComContexto('AUTO-TRANSACTION', 'Enviando proposta para confirmação...', { transactionId });
    await enviarPropostaDeTransacao(sock, cleanPhone, transactionToSave, transactionData);
    // Marca o estado pendente para o chatId do WhatsApp
    const chatId = `${cleanPhone}@s.whatsapp.net`;
    enviarPropostaPendente(chatId, { transactionId, transactionToSave });
    registrarComContexto('AUTO-TRANSACTION', `✅ Proposta enviada para ${cleanPhone}`, { transactionId });

    registrarComContexto('AUTO-TRANSACTION', `🎉 Proposta de transação enviada com sucesso!`);
    return {
      success: true,
      transactionId: transactionId,
      account: detectedAccount.name,
      category: detectedCategory,
      value: transactionToSave.value,
      status: 'pending_confirmation'
    };

  } catch (error) {
    registrarComContexto('AUTO-TRANSACTION', 'Erro durante processamento', { error: error.message });
    
    // Enviar mensagem de erro para o usuário via WhatsApp
    try {
      const cleanPhone = userPhone.replace(/\D/g, '');
      const chatId = `${cleanPhone}@s.whatsapp.net`;
      const errorMessage = `❌ *Erro ao processar transação automática*\n\n` +
        `🏦 *Banco:* ${transactionData.bank}\n` +
        `💰 *Valor:* R$ ${transactionData.value?.toFixed(2) || 'N/A'}\n` +
        `📅 *Data:* ${transactionData.date || 'N/A'}\n\n` +
        `*Motivo:* ${error.message}\n\n` +
        `💡 *Solução:* Adicione a transação manualmente usando o comando *transacao*.`;

      await sock.sendMessage(chatId, { text: errorMessage });
      registrarComContexto('AUTO-TRANSACTION', `Mensagem de erro enviada para ${cleanPhone}`);
      
    } catch (msgError) {
      registrarComContexto('AUTO-TRANSACTION', 'Erro ao enviar mensagem de erro', { error: msgError.message });
    }

    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Gera um ID aleatório único para transações e pendências
function generateRandomId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).substr(2, 8)
  );
}


/**
 * Detecta a conta do usuário baseada no nome do banco usando fuzzy matching
 * @param {string} userPhone - Telefone do usuário
 * @param {string} bankName - Nome do banco detectado
 * @param {Array} userAccounts - Contas do usuário
 * @returns {object|null} Conta detectada ou null
 */
async function detectarContaUsuarioPorBanco(userPhone, bankName, userAccounts = null) {
  try {
    registrarComContexto('ACCOUNT-DETECTION', `Detectando conta para banco: ${bankName}`);
    
    // Se não passou as contas, buscar do Firebase
    if (!userAccounts) {
      const userDoc = await db.collection("users").doc(userPhone).get();
      const userData = userDoc.data();
      userAccounts = userData.accounts || [];
    }

    if (userAccounts.length === 0) {
      registrarComContexto('ACCOUNT-DETECTION', `Usuário não possui contas cadastradas`);
      return null;
    }

    registrarComContexto('ACCOUNT-DETECTION', `Contas disponíveis: ${userAccounts.map(acc => acc.name).join(', ')}`);

    // Mapeamento de bancos conhecidos para possíveis variações de nome
    const bankMappings = {
      'C6 Bank': ['c6', 'c6 bank', 'banco c6', 'c6bank'],
      'Nubank': ['nubank', 'nu', 'roxinho', 'banco nu'],
      'Banco Inter': ['inter', 'banco inter', 'bancointer'],
      'Santander': ['santander', 'banco santander'],
      'Bradesco': ['bradesco', 'banco bradesco'],
      'Itaú': ['itau', 'itaú', 'banco itau', 'banco itaú'],
      'Caixa': ['caixa', 'caixa econômica', 'caixa econômica federal', 'cef'],
      'Banco do Brasil': ['bb', 'banco do brasil', 'bancodobrasil'],
      'PicPay': ['picpay', 'pic pay'],
      'Next': ['next', 'banco next'],
      'Neon': ['neon', 'banco neon']
    };

    const bankLower = bankName.toLowerCase().trim();
    registrarComContexto('ACCOUNT-DETECTION', `Procurando matches para: "${bankLower}"`);
    
    let bestMatch = null;
    let bestScore = Infinity;

    // Tentar encontrar conta que corresponde ao banco
    for (const account of userAccounts) {
      const accountNameLower = account.name.toLowerCase().trim();
      registrarComContexto('ACCOUNT-DETECTION', `Testando conta: "${accountNameLower}"`);
      
      // 1. Match direto exato
      if (accountNameLower === bankLower) {
        registrarComContexto('ACCOUNT-DETECTION', `✅ Match exato encontrado: ${account.name}`);
        return account;
      }
      
      // 2. Match por contenção (banco contém nome da conta ou vice-versa)
      if (accountNameLower.includes(bankLower) || bankLower.includes(accountNameLower)) {
        registrarComContexto('ACCOUNT-DETECTION', `✅ Match por contenção: ${account.name}`);
        return account;
      }
      
      // 3. Match usando mapeamentos conhecidos
      for (const [officialBank, variations] of Object.entries(bankMappings)) {
        if (officialBank.toLowerCase() === bankLower) {
          for (const variation of variations) {
            if (accountNameLower.includes(variation) || variation.includes(accountNameLower)) {
              registrarComContexto('ACCOUNT-DETECTION', `✅ Match por mapeamento (${officialBank}): ${account.name}`);
              return account;
            }
          }
        }
      }
      
      // 4. Match por palavras individuais (mais flexível)
      const bankWords = bankLower.split(' ').filter(word => word.length > 2);
      const accountWords = accountNameLower.split(' ').filter(word => word.length > 2);
      
      for (const bankWord of bankWords) {
        for (const accountWord of accountWords) {
          const distance = levenshtein.get(bankWord, accountWord);
          if (distance <= 2 && distance < bestScore) { // Máximo 2 caracteres de diferença
            bestScore = distance;
            bestMatch = account;
            registrarComContexto('ACCOUNT-DETECTION', `Match por palavra similar: "${bankWord}" ≈ "${accountWord}" (distância: ${distance})`);
          }
        }
      }
      
      // 5. Match parcial - se o nome do banco está contido no nome da conta
      if (bankLower.length >= 3 && accountNameLower.includes(bankLower)) {
        registrarComContexto('ACCOUNT-DETECTION', `Match parcial: "${bankLower}" contido em "${accountNameLower}"`);
        if (bestScore > 0) {
          bestScore = 0;
          bestMatch = account;
        }
      }
      
      // 6. Match reverso - se o nome da conta está contido no nome do banco
      if (accountNameLower.length >= 3 && bankLower.includes(accountNameLower)) {
        registrarComContexto('ACCOUNT-DETECTION', `Match reverso: "${accountNameLower}" contido em "${bankLower}"`);
        if (bestScore > 0) {
          bestScore = 0;
          bestMatch = account;
        }
      }
    }

    // Se encontrou um match por similaridade, retornar
    if (bestMatch && bestScore <= 1) {
      registrarComContexto('ACCOUNT-DETECTION', `✅ Melhor match por similaridade: ${bestMatch.name} (score: ${bestScore})`);
      return bestMatch;
    }

    // Se não encontrou match específico e só tem uma conta, usar ela
    if (userAccounts.length === 1) {
      registrarComContexto('ACCOUNT-DETECTION', `⚠️ Usando unica conta disponível: ${userAccounts[0].name}`);
      return userAccounts[0];
    }

    // Se tem múltiplas contas e não encontrou match, tentar usar a primeira conta que não seja "Dinheiro"
    const nonCashAccounts = userAccounts.filter(acc => 
      !acc.name.toLowerCase().includes('dinheiro') && 
      !acc.name.toLowerCase().includes('cash')
    );
    
    if (nonCashAccounts.length > 0) {
      registrarComContexto('ACCOUNT-DETECTION', `⚠️ Usando primeira conta não-dinheiro: ${nonCashAccounts[0].name}`);
      return nonCashAccounts[0];
    }

    registrarComContexto('ACCOUNT-DETECTION', `❌ Nenhuma conta adequada encontrada para o banco: ${bankName}`);
    return null;

  } catch (error) {
    registrarComContexto('ACCOUNT-DETECTION', 'Erro ao detectar conta', { error: error.message });
    return null;
  }
}

/**
 * Detecta a categoria da transação baseada no contexto
 * @param {object} transactionData - Dados da transação
 * @returns {string} Categoria detectada
 */
async function detectarCategoriaTransacao(transactionData) {
  const { type, from, to, merchant, rawText, bank, value, description } = transactionData;

  registrarComContexto('CATEGORY-DETECTION', `Detectando categoria para tipo: ${type}`);
  registrarComContexto('CATEGORY-DETECTION', `Descrição recebida: "${description}"`);

  // Para receitas (dinheiro entrando)
  if (type === 'receita') {
    if (from) {
      const fromLower = from.toLowerCase();
      
      // Verificar se é salário
      if (fromLower.includes('salario') || fromLower.includes('salário') || 
          fromLower.includes('empresa') || fromLower.includes('empregador')) {
        registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Salário (origem: ${from})`);
        return 'Salário';
      }
      
      // Verificar se é freelance/trabalho
      if (fromLower.includes('cliente') || fromLower.includes('servico') || 
          fromLower.includes('freelance') || fromLower.includes('trabalho')) {
        registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Freelance (origem: ${from})`);
        return 'Freelance';
      }
    }
    
    registrarComContexto('CATEGORY-DETECTION', `Categoria padrão para receita: PIX Recebido`);
    return 'PIX Recebido';
  }

  // Para despesas (dinheiro saindo)
  const text = (rawText || description || '').toLowerCase();
  const allText = `${merchant || ''} ${to || ''} ${text}`.toLowerCase();
  
  registrarComContexto('CATEGORY-DETECTION', `Analisando texto completo: "${allText}"`);

  // Categorização por merchant ou destinatário
  if (merchant || to) {
    const target = (merchant || to).toLowerCase();
    
    // Alimentação
    if (target.includes('ifood') || target.includes('uber eats') || target.includes('delivery') ||
        target.includes('restaurant') || target.includes('pizza') || target.includes('burger') ||
        target.includes('lanche') || target.includes('sushi') || target.includes('cafe') ||
        target.includes('padaria') || target.includes('açougue')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Alimentação (${target})`);
      return 'Alimentação';
    }
    
    // Mercado/Supermercado
    if (target.includes('mercado') || target.includes('supermercado') || target.includes('extra') ||
        target.includes('carrefour') || target.includes('pao de acucar') || target.includes('big') ||
        target.includes('walmart') || target.includes('atacadao')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Mercado (${target})`);
      return 'Mercado';
    }
    
    // Transporte
    if (target.includes('posto') || target.includes('gasolina') || target.includes('combustivel') ||
        target.includes('uber') || target.includes('99') || target.includes('taxi') ||
        target.includes('onibus') || target.includes('metro') || target.includes('estacionamento')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Transporte (${target})`);
      return 'Transporte';
    }
    
    // Saúde
    if (target.includes('farmacia') || target.includes('drogaria') || target.includes('medico') ||
        target.includes('hospital') || target.includes('clinica') || target.includes('laboratorio') ||
        target.includes('exame') || target.includes('consulta')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Saúde (${target})`);
      return 'Saúde';
    }
    
    // Compras Online
    if (target.includes('shopee') || target.includes('mercado livre') || target.includes('magazine luiza') ||
        target.includes('magalu') || target.includes('americanas') || target.includes('submarino') ||
        target.includes('casas bahia') || target.includes('extra.com') || target.includes('ponto frio') ||
        target.includes('fastshop') || target.includes('e-commerce') || target.includes('loja online')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Compras Online (${target})`);
      return 'Compras Online';
    }
    
    // Educação
    if (target.includes('faculdade') || target.includes('universidade') || target.includes('escola') ||
        target.includes('curso') || target.includes('udemy') || target.includes('coursera') ||
        target.includes('material escolar') || target.includes('livro') || target.includes('ensino')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Educação (${target})`);
      return 'Educação';
    }
    
    // Vestuário
    if (target.includes('roupa') || target.includes('sapato') || target.includes('tenis') ||
        target.includes('camisa') || target.includes('calça') || target.includes('vestido') ||
        target.includes('moda') || target.includes('zara') || target.includes('c&a') ||
        target.includes('renner') || target.includes('riachuelo') || target.includes('forum')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Vestuário (${target})`);
      return 'Vestuário';
    }
    
    // Casa/Móveis
    if (target.includes('mobilia') || target.includes('moveis') || target.includes('decoracao') ||
        target.includes('casa') || target.includes('lar') || target.includes('construção') ||
        target.includes('material construção') || target.includes('tinta') || target.includes('ferro') ||
        target.includes('madeira') || target.includes('eletrodomestico')) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Casa (${target})`);
      return 'Casa';
    }
  }

  // Categorização por texto da notificação
  if (allText.includes('gasolina') || allText.includes('combustível') || allText.includes('posto')) {
    registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Transporte (texto)`);
    return 'Transporte';
  }
  
  if (allText.includes('ifood') || allText.includes('delivery') || allText.includes('comida') ||
      allText.includes('almoço') || allText.includes('almoco') || allText.includes('jantar') ||
      allText.includes('lanche') || allText.includes('restaurante') || allText.includes('refeição') ||
      allText.includes('refeicao') || allText.includes('café') || allText.includes('food') ||
      allText.includes('meal') || allText.includes('lunch') || allText.includes('dinner')) {
    registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Alimentação (texto: "${allText}")`);
    return 'Alimentação';
  }
  
  if (allText.includes('streaming') || allText.includes('assinatura')) {
    registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Serviços (texto)`);
    return 'Serviços';
  }

  // Categorização por valor (heurística)
  if (value) {
    const numValue = parseFloat(value);
    
    // Valores muito baixos podem ser recarga/transporte
    if (numValue <= 10) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Transporte (valor baixo: R$ ${numValue})`);
      return 'Transporte';
    }
    
    // Valores médios podem ser alimentação
    if (numValue > 10 && numValue <= 100) {
      registrarComContexto('CATEGORY-DETECTION', `Categoria detectada: Alimentação (valor médio: R$ ${numValue})`);
      return 'Alimentação';
    }
  }

  // Categoria padrão para PIX
  registrarComContexto('CATEGORY-DETECTION', `Categoria padrão: PIX Enviado`);
  return 'PIX Enviado';
}

/**
 * Constrói a descrição da transação baseada nos dados disponíveis
 * @param {object} transactionData - Dados da transação
 * @returns {string} Descrição formatada
 */
function construirDescricaoTransacao(transactionData) {
  const { bank, from, to, merchant, type, id } = transactionData;
  
  let description = `[${bank}]`;
  
  if (type === 'receita' && from) {
    description += ` PIX recebido de ${from}`;
  } else if (type === 'despesa' && to) {
    description += ` PIX enviado para ${to}`;
  } else if (merchant) {
    description += ` Pagamento: ${merchant}`;
  } else {
    description += ` Transação automática`;
  }
  
  // Adicionar ID original se disponível
  if (id) {
    description += ` (${id})`;
  }
  
  console.log(`[DESCRIPTION] Descrição gerada: ${description}`);
  return description;
}

/**
 * Garante que uma categoria existe no Firebase para o usuário
 * @param {string} categoryName - Nome da categoria
 * @param {string} userId - ID do usuário
 * @param {string} type - Tipo da transação (receita/despesa)
 * @returns {Promise<object>} { exists: boolean, id: string }
 */
async function garantirCategoriaExiste(categoryName, userId, type) {
  try {
    registrarComContexto('CATEGORY-ENSURE', `Verificando categoria: ${categoryName} para usuário: ${userId}`);
    
    // Buscar categoria existente
    const categoryQuery = db.collection("categories")
      .where("name", "==", categoryName)
      .where("userId", "==", userId);
    
    const snapshot = await categoryQuery.get();

    if (!snapshot.empty) {
      const categoryDoc = snapshot.docs[0];
      registrarComContexto('CATEGORY-ENSURE', `Categoria existente encontrada: ${categoryName} (ID: ${categoryDoc.id})`);
      return { exists: true, id: categoryDoc.id };
    }

    // Criar nova categoria
    registrarComContexto('CATEGORY-ENSURE', `Criando nova categoria: ${categoryName}`);
    const newCategoryRef = db.collection("categories").doc();
    
    const categoryData = {
      id: newCategoryRef.id,
      name: categoryName,
      userId,
      type,
      budget: null,
      createdAt: new Date().toISOString(),
      source: "auto-detection"
    };
    
    await newCategoryRef.set(categoryData);
    registrarComContexto('CATEGORY-ENSURE', `✅ Nova categoria criada: ${categoryName} (ID: ${newCategoryRef.id})`);
    
    return { exists: false, id: newCategoryRef.id };

  } catch (error) {
    registrarComContexto('CATEGORY-ENSURE', 'Erro ao verificar/criar categoria', { error: error.message });
    throw error;
  }
}


/**
 * Envia proposta de transação para confirmação do usuário
 * @param {object} sock - Conexão WhatsApp
 * @param {string} userPhone - Telefone do usuário
 * @param {object} transactionData - Dados da transação preparada
 * @param {object} originalData - Dados originais recebidos do app
 */
async function enviarPropostaDeTransacao(sock, userPhone, transactionData, originalData) {
  try {
    const cleanPhone = userPhone.replace(/\D/g, '');
    const chatId = `${cleanPhone}@s.whatsapp.net`;
    registrarComContexto('WHATSAPP-PROPOSAL', `Enviando proposta para: ${userPhone}`, { transactionId: transactionData.id });
    
    // Emojis mais intuitivos para receita/ganho e despesa/perda
    const emoji = transactionData.type === 'receita' ? '🟢' : '🔴';
    const operacao = transactionData.type === 'receita' ? 'Receita' : 'Despesa';
    const valor = transactionData.value.toFixed(2);
    
    let message = `🤖 *TRANSAÇÃO DETECTADA AUTOMATICAMENTE*\n\n`;
    message += `${emoji} *${operacao}*\n`;
    message += `💵 *Valor:* R$ ${valor}\n`;
    message += `💼 *Conta:* ${transactionData.account}\n`;
    message += `🏷️ *Categoria:* ${transactionData.category ? transactionData.category : '(preencher)'}\n`;
    message += `📅 *Data:* ${transactionData.date}\n`;
    // Adicionar informações específicas do tipo de transação
    if (transactionData.type === 'receita' && originalData.from) {
      message += `👤 *Recebido de:* ${originalData.from}\n`;
    } else if (transactionData.type === 'despesa' && originalData.to) {
      message += `👤 *Enviado para:* ${originalData.to}\n`;
    }
    if (originalData.description) {
      message += `📝 *Descrição:* ${originalData.description}\n`;
    }
    message += `\n❓ *Gostaria de adicionar esta transação?*\n\n`;
    message += `✅ Digite *SIM* para confirmar\n`;
    message += `✏️ Digite *EDITAR* para modificar antes de salvar\n`;
    message += `➡️ Digite *DEPOIS* para decidir outra hora\n`;
    message += `❌ Digite *NÃO* para cancelar\n\n`;
    message += `📱 ID: \`${transactionData.id}\``;

    // Armazenar temporariamente a transação pendente
    await armazenarPropostaDeTransacao(cleanPhone, transactionData, originalData);

    if (sock) {
      await simularDigitar(sock, chatId);
      await sock.sendMessage(chatId, { text: message });
      registrarComContexto('WHATSAPP-PROPOSAL', `✅ Proposta enviada para ${userPhone}`, { transactionId: transactionData.id });
    } else {
      registrarComContexto('WHATSAPP-PROPOSAL', `WhatsApp não conectado, proposta armazenada mas não enviada para ${userPhone}`, { transactionId: transactionData.id });
    }
  } catch (error) {
    registrarComContexto('WHATSAPP-PROPOSAL', 'Erro ao enviar proposta', { error: error.message });
    throw error;
  }
}

/**
 * Armazena uma transação pendente de confirmação no Firebase
 * @param {string} userPhone - Telefone do usuário
 * @param {object} transactionData - Dados da transação
 * @param {object} originalData - Dados originais
 */
async function armazenarPropostaDeTransacao(userPhone, transactionData, originalData) {
  try {
    const cleanPhone = userPhone.replace(/\D/g, '');
    registrarComContexto('FIREBASE', 'Armazenando transação pendente', { transactionId: transactionData.id, userPhone: cleanPhone });
    // Corrige: garante que o ID é string
    const pendingRef = db.collection("pending_transactions").doc(String(transactionData.id));
    const pendingData = {
      id: transactionData.id,
      userId: cleanPhone,
      transactionData: transactionData,
      originalData: originalData,
      status: 'pending_confirmation',
      createdAt: new Date().toISOString(),
      recemDetectada: true // Indica que veio da integração de notificação
    };
    await pendingRef.set(pendingData);
    registrarComContexto('FIREBASE', '✅ Transação pendente armazenada', { transactionId: transactionData.id, userPhone: cleanPhone });
  } catch (error) {
    registrarComContexto('FIREBASE', 'Erro ao armazenar transação pendente', { error: error.message });
    throw error;
  }
}

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

// Busca fuzzy de categoria no Firebase
async function procurarCategoriaNoFirebase(userId, text) {
  const categoriesSnap = await db.collection("categories").where("userId", "==", userId).get();
  if (categoriesSnap.empty) return null;
  const categories = categoriesSnap.docs.map(doc => doc.data().name);
  let best = null, bestScore = 3;
  for (const cat of categories) {
    const dist = levenshtein.get(text.toLowerCase(), cat.toLowerCase());
    if (dist < bestScore) {
      best = cat;
      bestScore = dist;
    }
  }
  return best;
}

// Busca por palavras-chave
function buscarCategoriaPorPalavraChave(text) {
  const txt = text.toLowerCase();
  for (const [cat, arr] of Object.entries(palavrasChaveCategorias)) {
    if (arr.some(word => txt.includes(word.toLowerCase()))) {
      return cat.charAt(0).toUpperCase() + cat.slice(1);
    }
  }
  return null;
}

// Refatora detecção de categoria para não criar categoria antes da confirmação
async function detectarCategoriaTransacaoSmart(transactionData, userId) {
  const { description = '', rawText = '', merchant = '', to = '', from = '' } = transactionData;
  const baseText = `${description} ${rawText} ${merchant} ${to} ${from}`.toLowerCase();
  // 1. Buscar no Firebase
  const found = await procurarCategoriaNoFirebase(userId, baseText);
  if (found) return found;
  // 2. Buscar nas palavras-chave
  const byKeyword = buscarCategoriaPorPalavraChave(baseText);
  if (byKeyword) return byKeyword;
  // 3. Não encontrou
  return '';
}

module.exports = {
  configurarEndpointNotificacao,
  processarTransacaoDetectadaAutomaticamente,
  detectarContaUsuarioPorBanco,
  detectarCategoriaTransacao,
  garantirCategoriaExiste,
  construirDescricaoTransacao,
  enviarPropostaDeTransacao,
  armazenarPropostaDeTransacao,
  generateRandomId,
};
