import { MessageInterpretationSchema, type MessageInterpretation } from "../../packages/shared/src/interpretation.js";

/** Synthetic message, authored translations; these do not claim live LLM coverage. */
export const languageSource = "Please submit the PDF to Quercus by Friday at 5:00 PM. Do not upload the ZIP file.";
export const languageSamples = [
  { id: "zh-CN", label: "Simplified Chinese", hook: "请留意截止时间和提交要求。", segments: ["请在周五下午5:00前，", "将 PDF 提交到 Quercus。", "不要上传 ZIP 文件。"], english: ["By Friday at 5:00 PM,", "submit the PDF to Quercus.", "Do not upload the ZIP file."], action: "请在周五下午5:00前将 PDF 提交到 Quercus。", negation: "不要上传 ZIP 文件。", reply: "我会在截止时间前提交 PDF，不会上传 ZIP 文件。" },
  { id: "vi", label: "Vietnamese", hook: "Chú ý hạn nộp và loại tệp.", segments: ["Vui lòng nộp tệp PDF lên Quercus", "trước 17:00 thứ Sáu.", "Đừng tải lên tệp ZIP."], english: ["Please submit the PDF to Quercus", "by Friday at 5:00 PM.", "Do not upload the ZIP file."], action: "Vui lòng nộp tệp PDF lên Quercus trước 17:00 thứ Sáu.", negation: "Đừng tải lên tệp ZIP.", reply: "Tôi sẽ nộp tệp PDF trước hạn và không tải lên tệp ZIP." },
  { id: "ko", label: "Korean", hook: "마감 시간과 제출 파일을 확인하세요.", segments: ["금요일 오후 5:00까지", "PDF 파일을 Quercus에 제출하세요.", "ZIP 파일은 업로드하지 마세요."], english: ["By Friday at 5:00 PM,", "submit the PDF to Quercus.", "Do not upload the ZIP file."], action: "금요일 오후 5:00까지 PDF 파일을 Quercus에 제출하세요.", negation: "ZIP 파일은 업로드하지 마세요.", reply: "마감 전에 PDF를 제출하고 ZIP 파일은 업로드하지 않겠습니다." },
  { id: "es", label: "Spanish", hook: "Revisa el plazo y el tipo de archivo.", segments: ["Envía el PDF a Quercus", "antes del viernes a las 17:00.", "No subas el archivo ZIP."], english: ["Submit the PDF to Quercus", "by Friday at 5:00 PM.", "Do not upload the ZIP file."], action: "Envía el PDF a Quercus antes del viernes a las 17:00.", negation: "No subas el archivo ZIP.", reply: "Enviaré el PDF antes del plazo y no subiré el archivo ZIP." },
  { id: "fr", label: "French", hook: "Vérifiez le délai et le type de fichier.", segments: ["Déposez le PDF sur Quercus", "avant vendredi à 17 h.", "Ne téléversez pas le fichier ZIP."], english: ["Submit the PDF to Quercus", "by Friday at 5:00 PM.", "Do not upload the ZIP file."], action: "Déposez le PDF sur Quercus avant vendredi à 17 h.", negation: "Ne téléversez pas le fichier ZIP.", reply: "Je déposerai le PDF avant la date limite et ne téléverserai pas le fichier ZIP." },
] as const;

export function sampleInterpretation(sample: typeof languageSamples[number]): MessageInterpretation {
  return MessageInterpretationSchema.parse({
    sourceLanguage: "en", targetLanguage: sample.id,
    faithfulTranslation: sample.action + " " + sample.negation,
    hook: sample.hook, shortTitle: sample.hook, senderIntent: sample.hook,
    spokenSegments: [...sample.segments],
    captionTranslation: { language: "en", hook: "Check the deadline and what to upload.", spokenSegments: [...sample.english] },
    urgency: "medium", isSensitive: false,
    actionItems: [
      { text: sample.action, textEnglish: "Submit the PDF to Quercus by Friday at 5:00 PM", evidenceQuote: "Please submit the PDF to Quercus by Friday at 5:00 PM.", dueText: "Friday at 5:00 PM", dueAt: null, essential: true, isNegation: false },
      { text: sample.negation, textEnglish: "Do not upload the ZIP file", evidenceQuote: "Do not upload the ZIP file.", dueText: null, dueAt: null, essential: true, isNegation: true },
    ],
    preservedFacts: [{ label: "deadline", value: "Friday at 5:00 PM" }],
    ambiguities: ["The message does not specify a calendar date or timezone."], suggestedClarifyingQuestions: [],
  });
}
