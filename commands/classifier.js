const natural = require("natural");

// Configurar o classificador Bayesiano
const classifier = new natural.BayesClassifier();

// Adicionar transações - Despesas
classifier.addDocument("gastei 50 reais no mercado", "adicionarTransacao");
classifier.addDocument("paguei a conta de luz", "adicionarTransacao");
classifier.addDocument("gastei 200 com roupas", "adicionarTransacao");
classifier.addDocument("paguei aluguel", "adicionarTransacao");
classifier.addDocument("gastei com comida", "adicionarTransacao");
classifier.addDocument("comprei um presente por 100 reais", "adicionarTransacao");
classifier.addDocument("saquei 200 reais", "adicionarTransacao");
classifier.addDocument("paguei 35 reais no cinema", "adicionarTransacao");
classifier.addDocument("gastei 80 reais na farmácia", "adicionarTransacao");
classifier.addDocument("comprei gasolina por 120 reais", "adicionarTransacao");
classifier.addDocument("paguei 500 reais de condomínio", "adicionarTransacao");
classifier.addDocument("gastei 25 reais no uber", "adicionarTransacao");

// Adicionar transações - Receitas com formatos específicos
classifier.addDocument("recebi 1500 reais do salário", "adicionarTransacao");
classifier.addDocument("recebi 300 reais de presente", "adicionarTransacao");
classifier.addDocument("entrou 1000 reais na conta", "adicionarTransacao");
classifier.addDocument("depositaram 800 reais pra mim", "adicionarTransacao");
classifier.addDocument("recebi 2500 de salário", "adicionarTransacao");
classifier.addDocument("ganhei 400 reais", "adicionarTransacao");
classifier.addDocument("recebi 1200 reais de freelance", "adicionarTransacao");
classifier.addDocument("entrou 500 reais de rendimento", "adicionarTransacao");
classifier.addDocument("recebi 1.445,60 de salário", "adicionarTransacao");
classifier.addDocument("recebi 1445,60 de salário dia 02/07", "adicionarTransacao");
classifier.addDocument("recebi 1.445,60 de salário dia 02/07", "adicionarTransacao");
classifier.addDocument("salário de 2.800 reais caiu na conta", "adicionarTransacao");
classifier.addDocument("recebi o pagamento de 950 reais", "adicionarTransacao");
classifier.addDocument("entrou 1.200,50 de trabalho", "adicionarTransacao");
classifier.addDocument("recebi 800 reais do cliente", "adicionarTransacao");
classifier.addDocument("caiu 1500 reais na conta hoje", "adicionarTransacao");
classifier.addDocument("recebi salário de 1445,60", "adicionarTransacao");
classifier.addDocument("salário 1445 dia 02", "adicionarTransacao");
classifier.addDocument("recebi 1445 de salário", "adicionarTransacao");

// Criar perfil
classifier.addDocument("criar perfil financeiro", "criarPerfil");
classifier.addDocument("quero começar a usar", "criarPerfil");
classifier.addDocument("quero criar meu perfil", "criarPerfil");
classifier.addDocument("iniciar controle financeiro", "criarPerfil");
classifier.addDocument("como começo?", "criarPerfil");
classifier.addDocument("começar agora", "criarPerfil");

// Consultar saldo
classifier.addDocument("qual é o saldo?", "consultarSaldo");
classifier.addDocument("saldo?", "consultarSaldo");
classifier.addDocument("saldo", "consultarSaldo");
classifier.addDocument("me mostre o saldo", "consultarSaldo");
classifier.addDocument("me mostra meu saldo", "consultarSaldo");
classifier.addDocument("qual meu saldo atual?", "consultarSaldo");
classifier.addDocument("quanto tenho na conta?", "consultarSaldo");
classifier.addDocument("meu saldo", "consultarSaldo");
classifier.addDocument("ver saldo", "consultarSaldo");

// Atualizar saldo
classifier.addDocument("atualizar saldo", "atualizarSaldo");
classifier.addDocument("quero mudar meu saldo", "atualizarSaldo");
classifier.addDocument("editar o saldo", "atualizarSaldo");
classifier.addDocument("corrigir meu saldo", "atualizarSaldo");
classifier.addDocument("meu saldo está errado", "atualizarSaldo");
classifier.addDocument("atualize meu saldo", "atualizarSaldo");

// Relatório Mensal
classifier.addDocument("gerar relatório mensal", "relatorioMensal");
classifier.addDocument("quero o relatório do mês", "relatorioMensal");
classifier.addDocument("relatório mensal", "relatorioMensal");
classifier.addDocument("me mostre o relatório mensal", "relatorioMensal");
classifier.addDocument("relatório do mês", "relatorioMensal");

// Rotinas
classifier.addDocument("criar rotina", "criarRotina");
classifier.addDocument("agendar rotina", "criarRotina");
classifier.addDocument("programar rotina", "criarRotina");
classifier.addDocument("definir rotina", "criarRotina");
classifier.addDocument("me lembre de", "criarRotina");
classifier.addDocument("jaja tenho que", "criarRotina");
classifier.addDocument("criar lembrete", "criarRotina");
classifier.addDocument("criar tarefa", "criarRotina");
classifier.addDocument("novo lembrete", "criarRotina");
classifier.addDocument("agendar", "criarRotina");
classifier.addDocument("programar lembrete", "criarRotina");
classifier.addDocument("definir rotina", "criarRotina");

// Ver rotinas
classifier.addDocument("ver rotinas", "verRotinas");
classifier.addDocument("mostrar rotinas", "verRotinas");
classifier.addDocument("listar rotinas", "verRotinas");
classifier.addDocument("ver agenda", "verRotinas");
classifier.addDocument("mostrar agenda", "verRotinas");
classifier.addDocument("ver lembretes", "verRotinas");
classifier.addDocument("mostrar lembretes", "verRotinas");
classifier.addDocument("minhas rotinas", "verRotinas");

// Editar rotinas
classifier.addDocument("editar rotina", "editarRotina");
classifier.addDocument("alterar rotina", "editarRotina");
classifier.addDocument("modificar rotina", "editarRotina");
classifier.addDocument("atualizar rotina", "editarRotina");
classifier.addDocument("mudar rotina", "editarRotina");

// Treinar o modelo
classifier.train();

module.exports = classifier;
