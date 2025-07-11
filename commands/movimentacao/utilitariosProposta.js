// Utilitário para controle de propostas pendentes
const pendingProposals = {};

function enviarPropostaPendente(chatId, proposalData) {
    pendingProposals[chatId] = proposalData;
}

function limparPropostaPendente(chatId) {
    delete pendingProposals[chatId];
}

function receberPropostaPendente(chatId) {
    return pendingProposals[chatId];
}

module.exports = {
    enviarPropostaPendente,
    limparPropostaPendente,
    receberPropostaPendente,
    pendingProposals
};
