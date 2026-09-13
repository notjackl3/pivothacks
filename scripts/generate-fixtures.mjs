import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const action = (text, textEnglish, evidenceQuote, dueText = null, isNegation = false) => ({ text, textEnglish, evidenceQuote, dueText, dueAt: null, isNegation, essential: true });
const cases = [
  {
    name: "professor_deadline", sender: "Professor Chen",
    text: "Hi Jack — because Monday is a university closure, the project deadline has moved from Monday at 11:59 PM to Friday at 5:00 PM. Submit the PDF to Quercus, but send your source-code repository link directly to me in Slack. Do not upload the repository archive to Quercus. Let me know by Wednesday if your group needs an extension.",
    title: "项目截止日期已更改", hook: "截止日期变了，请留意提交方式。",
    captionTranslation: {
      language: "en", hook: "The deadline changed. Check where to submit.",
      spokenSegments: ["The project was due Monday at 11:59 PM.", "Now it is due Friday at 5:00 PM.", "Submit the PDF to Quercus.", "Send the source-code repository link in Slack", "directly to the professor.", "Do not upload the repository archive to Quercus.", "If your group needs an extension,", "let the professor know by Wednesday."],
    },
    translation: "Jack，你好——因为 Monday 大学关闭，项目截止时间从 Monday at 11:59 PM 改到 Friday at 5:00 PM。把 PDF 提交到 Quercus，但请通过 Slack 直接把源代码仓库链接发给我。不要把仓库压缩包上传到 Quercus。如果你们小组需要延期，请在 Wednesday 前告诉我。",
    segments: ["项目原定周一晚上11:59截止，", "现改为周五下午5:00。", "将 PDF 提交到 Quercus。", "将源代码仓库链接通过 Slack", "直接发给教授。", "不要把仓库压缩包上传到 Quercus。", "如果小组需要延期，", "请在周三前告知教授。"],
    actions: [
      action("将 PDF 提交到 Quercus。", "Submit the PDF to Quercus", "Submit the PDF to Quercus", "Friday at 5:00 PM"),
      action("将源代码仓库链接通过 Slack 直接发给教授。", "Send the source-code repository link directly to the professor in Slack", "send your source-code repository link directly to me in Slack"),
      action("不要把仓库压缩包上传到 Quercus。", "Do not upload the repository archive to Quercus", "Do not upload the repository archive to Quercus.", null, true),
      action("如果小组需要延期，请在周三前告知教授。", "Let the professor know by Wednesday if an extension is needed", "Let me know by Wednesday if your group needs an extension.", "Wednesday"),
    ],
    facts: [{ label: "old_deadline", value: "Monday at 11:59 PM" }, { label: "new_deadline", value: "Friday at 5:00 PM" }, { label: "extension_request", value: "Wednesday" }],
    ambiguities: ["消息没有给出具体日期；请确认 Friday 和 Wednesday 指哪一周。"],
    mustContain: ["Quercus", "Slack", "11:59 PM", "5:00 PM", "Wednesday"],
  },
  {
    name: "landlord_docs", sender: "Alex, property manager",
    text: "Hi Jack, please send the rent receipt for $1,250 and your signed lease PDF to housing@example.edu by Friday at 4:00 PM. Do not send a photo of your bank card. This is a documentation request, not a new payment request.",
    title: "房租材料需要补交", hook: "补交材料，无需再次付款。",
    translation: "Jack，你好，请在 Friday at 4:00 PM 前把 $1,250 的房租收据和签好的租约 PDF 发到 housing@example.edu。不要发送银行卡照片。这是索要材料，不是再次索要付款。",
    segments: ["这是补交材料的要求，无需再次付款。", "请在周五下午4:00前，", "将 $1,250 的房租收据和签好的租约 PDF", "发送至 housing@example.edu。", "不要发送银行卡照片。"],
    actions: [action("发送 $1,250 的房租收据和签好的租约 PDF。", "Send the $1,250 rent receipt and signed lease PDF", "please send the rent receipt for $1,250 and your signed lease PDF to housing@example.edu by Friday at 4:00 PM", "Friday at 4:00 PM"), action("不要发送银行卡照片。", "Do not send a photo of your bank card", "Do not send a photo of your bank card.", null, true)],
    facts: [{ label: "amount", value: "$1,250" }, { label: "deadline", value: "Friday at 4:00 PM" }, { label: "email", value: "housing@example.edu" }],
    ambiguities: ["Friday 的具体日期未提供。"], mustContain: ["$1,250", "Friday at 4:00 PM", "housing@example.edu"],
  },
  {
    name: "manager_steps", sender: "Sam, shift manager",
    text: "Before your Saturday shift, read the checklist at https://example.com/checklist. Bring your ID to Room B214 at 9:00 AM. Submit the availability form in Slack by Thursday at 6:00 PM. Do not share customer information in the public channel.",
    title: "上班前的准备事项", hook: "到岗前需要完成三项准备。",
    translation: "Saturday 上班前，请阅读 https://example.com/checklist 的清单。9:00 AM 带上 ID 到 Room B214。请在 Thursday at 6:00 PM 前通过 Slack 提交可上班时间表。不要在公开频道分享顾客信息。",
    segments: ["周六上班前，阅读清单：", "https://example.com/checklist。", "上午9:00带上 ID 到 B214。", "周四下午6:00前，", "在 Slack 提交可上班时间表。", "不要在公开频道分享顾客信息。"],
    actions: [action("周六上班前阅读清单。", "Read https://example.com/checklist before Saturday", "Before your Saturday shift, read the checklist at https://example.com/checklist.", "Saturday"), action("上午9:00带上 ID 到 B214。", "Bring ID to B214 at 9:00 AM", "Bring your ID to Room B214 at 9:00 AM.", "9:00 AM"), action("在 Slack 提交可上班时间表。", "Submit the availability form in Slack", "Submit the availability form in Slack by Thursday at 6:00 PM.", "Thursday at 6:00 PM"), action("不要在公开频道分享顾客信息。", "Do not share customer information in the public channel", "Do not share customer information in the public channel.", null, true)],
    facts: [{ label: "checklist", value: "https://example.com/checklist" }, { label: "arrival", value: "9:00 AM" }, { label: "deadline", value: "Thursday at 6:00 PM" }, { label: "room", value: "B214" }],
    ambiguities: ["具体日期未提供。"], mustContain: ["https://example.com/checklist", "9:00 AM", "6:00 PM", "B214"],
  },
  {
    name: "ambiguous_date", sender: "Campus club",
    text: "Please send your RSVP for the workshop by Wednesday. We will meet next Friday in Room 204. I am travelling, so I have not confirmed the time zone or the start time yet.",
    title: "活动日期需要确认", hook: "先回复报名，再确认时间。",
    translation: "请在 Wednesday 前回复是否参加工作坊。我们将于 next Friday 在 Room 204 见面。我正在旅行，所以还没有确认时区或开始时间。",
    segments: ["请在周三前回复 RSVP。", "活动拟于下周五在204室举行。", "开始时间、时区和具体日期仍需确认。"],
    actions: [action("请在周三前回复 RSVP。", "Send RSVP by Wednesday", "Please send your RSVP for the workshop by Wednesday.", "Wednesday")],
    facts: [{ label: "rsvp", value: "Wednesday" }, { label: "meeting", value: "next Friday" }, { label: "room", value: "Room 204" }],
    ambiguities: ["Wednesday 和 next Friday 的具体日期不明确。", "时区和开始时间尚未确认。"], mustContain: ["Wednesday", "next Friday", "204"],
  },
  {
    name: "bilingual", sender: "Residence desk",
    text: "Hi Jack，你好！Please upload your student ID PDF to https://example.com/residence by Tuesday at 3:30 PM. 保留原件。Do not leave the original at the front desk.",
    title: "提交学生证电子版", hook: "上传电子版，请保留原件。",
    translation: "Jack，你好！请在 Tuesday at 3:30 PM 前把学生证 PDF 上传到 https://example.com/residence。保留原件。不要把原件留在前台。",
    segments: ["周二下午3:30前，", "将学生证 PDF 上传到", "https://example.com/residence。", "保留原件。", "不要把原件留在前台。"],
    actions: [action("上传学生证 PDF。", "Upload the student ID PDF to https://example.com/residence", "Please upload your student ID PDF to https://example.com/residence by Tuesday at 3:30 PM.", "Tuesday at 3:30 PM"), action("保留原件。", "Keep the original", "保留原件。"), action("不要把原件留在前台。", "Do not leave the original at the front desk", "Do not leave the original at the front desk.", null, true)],
    facts: [{ label: "url", value: "https://example.com/residence" }, { label: "deadline", value: "Tuesday at 3:30 PM" }],
    ambiguities: ["Tuesday 的具体日期未提供。"], mustContain: ["https://example.com/residence", "3:30 PM", "PDF"],
  },
  {
    name: "negation", sender: "Professor Chen",
    text: "Do not submit the ZIP file to Quercus. Submit only the PDF by Sunday at 11:59 PM. Never include your password in the report. Keep a copy of your submission receipt.",
    title: "只交 PDF，保护密码", hook: "请注意两条禁止事项。",
    translation: "不要把 ZIP 文件提交到 Quercus。请在 Sunday at 11:59 PM 前只提交 PDF。绝不要在报告里写入密码。保留提交回执副本。",
    segments: ["不要把 ZIP 文件提交到 Quercus。", "周日晚上11:59前只提交 PDF。", "不要在报告里写入密码。", "保留提交回执副本。"],
    actions: [action("不要把 ZIP 文件提交到 Quercus。", "Do not submit the ZIP file to Quercus", "Do not submit the ZIP file to Quercus.", null, true), action("周日晚上11:59前只提交 PDF。", "Submit only the PDF", "Submit only the PDF by Sunday at 11:59 PM.", "Sunday at 11:59 PM"), action("不要在报告里写入密码。", "Never include your password in the report", "Never include your password in the report.", null, true), action("保留提交回执副本。", "Keep a copy of the submission receipt", "Keep a copy of your submission receipt.")],
    facts: [{ label: "deadline", value: "Sunday at 11:59 PM" }, { label: "format", value: "PDF" }],
    ambiguities: ["Sunday 的具体日期未提供。"], mustContain: ["11:59 PM", "PDF", "Quercus"],
  },
];

await mkdir(path.join(root, "fixtures/slack"), { recursive: true });
await mkdir(path.join(root, "fixtures/expected"), { recursive: true });
for (const [index, item] of cases.entries()) {
  const ts = `${1789308000 + index}.000200`;
  const envelope = {
    token: "PLACEHOLDER_VERIFICATION_TOKEN", team_id: "T0000EXAMPLE", api_app_id: "A0000EXAMPLE",
    type: "event_callback", event_id: `Ev0000EXAMPLE${index + 1}`, event_time: 1789308000 + index,
    event_context: "1-message-T0000EXAMPLE-D0000EXAMPLE",
    authorizations: [{ enterprise_id: null, team_id: "T0000EXAMPLE", user_id: "U0000STUDENT", is_bot: false, is_enterprise_install: false }],
    event: { type: "message", channel: "D0000EXAMPLE", channel_type: "im", user: "U0000PROFESSOR", text: item.text, ts, event_ts: ts },
  };
  const interpretation = {
    sourceLanguage: item.name === "bilingual" ? "en,zh-CN" : "en", targetLanguage: "zh-CN",
    faithfulTranslation: item.translation, hook: item.hook, spokenSegments: item.segments,
    ...(item.captionTranslation ? { captionTranslation: item.captionTranslation } : {}),
    shortTitle: item.title, senderIntent: item.translation, urgency: "high", isSensitive: true,
    actionItems: item.actions, preservedFacts: item.facts, ambiguities: item.ambiguities,
    suggestedClarifyingQuestions: ["请问这里指的是哪一个具体日期？"],
  };
  await writeFile(path.join(root, `fixtures/slack/${item.name}.json`), `${JSON.stringify(envelope, null, 2)}\n`);
  await writeFile(path.join(root, `fixtures/expected/${item.name}.interpretation.json`), `${JSON.stringify(interpretation, null, 2)}\n`);
  await writeFile(path.join(root, `fixtures/expected/${item.name}.json`), `${JSON.stringify({ senderDisplayName: item.sender, mustContain: item.mustContain }, null, 2)}\n`);
}
console.info(`Wrote ${cases.length} Slack fixtures and expected interpretations.`);
