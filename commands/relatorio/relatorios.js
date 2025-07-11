const db = require("../firebaseFolder/firebase");
const moment = require("moment-timezone");
const { createCanvas } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

/**
 * Gera o relatório de balanço mensal para um usuário.
 * @param {string} userId - ID do usuário.
 * @param {string} month - Mês no formato "YYYY-MM".
 * @returns {object} Relatório contendo receitas, despesas, detalhes por categoria e caminho do gráfico.
 */
async function gerarRelatorioMensal(userId, month) {
    try {
        // Buscar o nome do usuário
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        const userName = userDoc.exists ? userDoc.data().name || "Desconhecido" : "Desconhecido";

        const startOfMonth = moment(`${month}-01`).startOf("month").toISOString();
        const endOfMonth = moment(`${month}-01`).endOf("month").toISOString();

        // Buscar transações do usuário no Firebase
        const transactionsRef = db.collection("transactions")
            .where("userId", "==", userId)
            .where("date", ">=", startOfMonth)
            .where("date", "<=", endOfMonth);

        const snapshot = await transactionsRef.get();
        if (snapshot.empty) {
            return { message: "Nenhuma transação encontrada para o período." };
        }

        const transactions = snapshot.docs.map(doc => doc.data());

        // Calcular receitas, despesas e saldo
        let totalReceitas = 0;
        let totalDespesas = 0;
        const categorias = {};

        transactions.forEach(({ type, value, category }) => {
            if (type === "receita") {
                totalReceitas += value;
            } else if (type === "despesa") {
                totalDespesas += value;
            }

            if (!categorias[category]) {
                categorias[category] = { receita: 0, despesa: 0 };
            }
            categorias[category][type] += value;
        });

        const saldoFinal = totalReceitas - totalDespesas;

        // Calcular percentual por categoria
        const categoriasDetalhadas = Object.entries(categorias).map(([categoria, valores]) => ({
            categoria,
            receita: valores.receita,
            despesa: valores.despesa,
            percentualReceita: ((valores.receita / totalReceitas) * 100).toFixed(2) || 0,
            percentualDespesa: ((valores.despesa / totalDespesas) * 100).toFixed(2) || 0,
        }));

        const despesasDetalhadas = categoriasDetalhadas.filter(cat => cat.despesa > 0); // Somente categorias com despesas

        // Gerar gráfico de pizza apenas para despesas
        const graficoPizzaPath = await gerarGraficoPizza(despesasDetalhadas, month);

        // Gerar gráfico de colunas para receitas e despesas
        const graficoColunasPath = await gerarGraficoColunas(totalReceitas, totalDespesas, month);

        return {
            userName, // Incluído o nome do usuário
            totalReceitas,
            totalDespesas,
            saldoFinal,
            categoriasDetalhadas,
            graficoPizzaPath,
            graficoColunasPath,
        };
    } catch (error) {
        console.error("❌ Erro ao gerar relatório mensal:", error);
        throw error;
    }
}

/**
 * Gera um gráfico de pizza com as categorias e salva como imagem.
 * @param {Array} categoriasDetalhadas - Detalhes das categorias.
 * @param {string} month - Mês do relatório.
 * @returns {string} Caminho do arquivo do gráfico gerado.
 */
async function gerarGraficoPizza(categoriasDetalhadas, month) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext("2d");

    // Ordenar categorias por valor decrescente
    const categoriasOrdenadas = [...categoriasDetalhadas].sort((a, b) => parseFloat(b.despesa) - parseFloat(a.despesa));

    // Fundo cinza suave
    ctx.fillStyle = "#f5f5f7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Configurações do gráfico (usando dados ordenados)
    const total = categoriasOrdenadas.reduce((sum, cat) => sum + parseFloat(cat.despesa), 0);
    const cores = ["#4BC0C0", "#FF9F40", "#9966FF", "#36A2EB", "#FF6384", "#FFCE56"];
    let startAngle = 0;

    // Desenhar gráfico de pizza (com categorias ordenadas)
    categoriasOrdenadas.forEach((cat, index) => {
        const sliceAngle = (parseFloat(cat.despesa) / total) * 2 * Math.PI;

        // Fatia principal
        ctx.fillStyle = cores[index % cores.length];
        ctx.beginPath();
        ctx.moveTo(400, 300);
        ctx.arc(400, 300, 200, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fill();

        // Efeito de profundidade
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(400, 300, 200, startAngle, startAngle + sliceAngle);
        ctx.stroke();

        // Percentuais
        const midAngle = startAngle + sliceAngle / 2;
        const textX = 400 + Math.cos(midAngle) * 140;
        const textY = 300 + Math.sin(midAngle) * 140;

        ctx.fillStyle = "#2c3e50";
        ctx.font = "bold 16px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeText(`${((cat.despesa / total) * 100).toFixed(1)}%`, textX, textY);
        ctx.fillText(`${((cat.despesa / total) * 100).toFixed(1)}%`, textX, textY);

        startAngle += sliceAngle;
    });

    // Título
    ctx.fillStyle = "#212529";
    ctx.font = "bold 28px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Relatório de Gastos - ${month}`, canvas.width / 2, 70);

    // Linha decorativa
    ctx.strokeStyle = "#4BC0C0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 120, 85);
    ctx.lineTo(canvas.width / 2 + 120, 85);
    ctx.stroke();

    // Legenda ordenada (já está ordenada por causa do sort anterior)
    const legendaX = 600;
    let legendaY = 120;

    categoriasOrdenadas.forEach((cat, index) => {
        // Ícone colorido
        ctx.fillStyle = cores[index % cores.length];
        ctx.beginPath();
        ctx.arc(legendaX + 10, legendaY + 10, 8, 0, Math.PI * 2);
        ctx.fill();

        // Texto da categoria
        ctx.fillStyle = "#495057";
        ctx.font = "14px 'Segoe UI', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${cat.categoria}:`, legendaX + 25, legendaY + 15);

        // Valor
        ctx.font = "bold 14px 'Segoe UI', sans-serif";
        ctx.fillText(`R$ ${cat.despesa.toFixed(2)}`, legendaX + 120, legendaY + 15);

        legendaY += 30;
    });

    // Total geral
    ctx.fillStyle = "#212529";
    ctx.font = "bold 16px 'Segoe UI', sans-serif";
    ctx.fillText(`Total: R$ ${total.toFixed(2)}`, legendaX, legendaY + 20);

    // Salvar imagem
    const tempDir = path.join(__dirname, "../../temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const graficoPath = path.join(tempDir, `relatorio_${month}.png`);
    const buffer = canvas.toBuffer("image/png");
    fs.writeFileSync(graficoPath, buffer);

    return graficoPath;
}

/**
 * Gera um gráfico de colunas comparando receitas e despesas e salva como imagem.
 * @param {number} receitas - Total de receitas.
 * @param {number} despesas - Total de despesas.
 * @param {string} month - Mês do relatório.
 * @returns {string} Caminho do arquivo do gráfico gerado.
 */
async function gerarGraficoColunas(receitas, despesas, month) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext("2d");

    // Tradução dos meses para PT-BR
    const mesesPTBR = {
        'January': 'Janeiro', 'February': 'Fevereiro', 'March': 'Março',
        'April': 'Abril', 'May': 'Maio', 'June': 'Junho',
        'July': 'Julho', 'August': 'Agosto', 'September': 'Setembro',
        'October': 'Outubro', 'November': 'Novembro', 'December': 'Dezembro'
    };
    const mesTraduzido = mesesPTBR[month] || month;

    // Configurações do gráfico
    const labels = ["Receitas", "Despesas"];
    const valores = [receitas, despesas];
    const cores = ["#4BC0C0", "#FF9F40"];
    const coresSombra = ["#36A2A2", "#E68A36"];

    // Fundo cinza suave
    ctx.fillStyle = "#f5f5f7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Parâmetros do gráfico
    const larguraColuna = 120;
    const espacamento = 180;
    const baseY = 520; // Aumentei de 500 para 520 para abaixar a linha de base
    const alturaMaxima = 350;
    const margemSegura = 50;

    // Calcular alturas primeiro
    const maxValor = Math.max(...valores);
    const alturas = valores.map(valor => (valor / maxValor) * alturaMaxima);

    // Linha de base mais baixa
    ctx.strokeStyle = '#6c757d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margemSegura, baseY);
    ctx.lineTo(canvas.width - margemSegura, baseY);
    ctx.stroke();

    // Desenhar colunas
    valores.forEach((valor, index) => {
        const altura = alturas[index];
        const x = margemSegura + 100 + index * espacamento;
        const y = baseY - altura;

        // Sombra da coluna (agora não ultrapassa a linha de base)
        ctx.fillStyle = coresSombra[index];
        ctx.fillRect(
            Math.min(x + 4, canvas.width - margemSegura - larguraColuna),
            y + 4,
            larguraColuna,
            altura - 4 // Reduzi a altura da sombra para não passar da base
        );

        // Coluna principal com gradiente
        const columnGradient = ctx.createLinearGradient(x, y, x, y + altura);
        columnGradient.addColorStop(0, cores[index]);
        columnGradient.addColorStop(1, coresSombra[index]);
        ctx.fillStyle = columnGradient;
        ctx.fillRect(x, y, larguraColuna, altura);

        // Borda sutil
        ctx.strokeStyle = '#495057';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, larguraColuna, altura);

        // Rótulo do valor
        ctx.fillStyle = "#2c3e50";
        ctx.font = "bold 18px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`R$ ${valor.toFixed(2)}`, x + larguraColuna / 2, y - 10);

        // Rótulo da categoria
        ctx.fillStyle = "#495057";
        ctx.font = "bold 16px 'Segoe UI', sans-serif";
        ctx.fillText(labels[index], x + larguraColuna / 2, baseY + 30);
    });

    // Título corrigido (removendo o ano duplicado)
    ctx.fillStyle = "#212529";
    ctx.font = "bold 28px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    const anoAtual = new Date().getFullYear();
    ctx.fillText(`Balanço: Receitas vs Despesas - ${month}`, canvas.width / 2, 70);


    // Linha decorativa
    ctx.strokeStyle = "#4BC0C0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 120, 85);
    ctx.lineTo(canvas.width / 2 + 120, 85);
    ctx.stroke();

    // Salvar imagem
    const tempDir = path.join(__dirname, "../../temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const graficoPath = path.join(tempDir, `colunas_${month}.png`);
    const buffer = canvas.toBuffer("image/png");
    fs.writeFileSync(graficoPath, buffer);

    return graficoPath;
}

module.exports = { gerarRelatorioMensal };