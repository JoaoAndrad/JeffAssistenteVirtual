const admin = require("firebase-admin");
const { type } = require("os");
const path = require("path");

const tokenfcm = "dDHn4lqwTFGx9lz-7WhsxX:APA91bFeNIkVnekk3eSvF8iT1RoEV0OihOF-x0SVXlYCRWmw8m0HBzz7-LDa829oVrftKnzHKKkhg69SAXHF16jduFASRdHrRqBDeUQXab3pfDFIqDcIEYw";


// Inicializa Firebase Admin se ainda não estiver inicializado
if (!admin.apps.length) {
  const serviceAccount = require(path.resolve(__dirname, "../../firebaseFolder/serviceAccountKey.json"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/**
 * Envia um alarme/lembrete para o app Android via FCM
 * @param {string} mensagem - Mensagem do alarme/lembrete
 * @param {string} horario - Horário do alarme (ISO string)
 */
async function enviarAlarmeFCM(mensagem, horario) {
  // Garante que todos os valores em data são strings
  const payload = {
    token: tokenfcm,
    data: {
      type: "alarm",
      message: String(mensagem),
      horario: String(horario),
      mensagem: String(mensagem),
    }
  };
  console.log("Dados:", JSON.stringify(payload, null, 2));
  try {
    const response = await admin.messaging().send(payload);
    console.log("[ALARME] Notificação enviada com sucesso:", response);
    console.log("\n\n[ALARME] Dados enviados:", JSON.stringify(payload, null, 2));
    return { success: true, response };
  } catch (error) {
    console.error("[ALARME] Erro ao enviar notificação:", error);
    return { success: false, error };
  }
}

module.exports = { enviarAlarmeFCM };
