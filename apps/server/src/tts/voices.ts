import { z } from "zod";

const VoiceListSchema = z.object({ voices: z.array(z.object({ voice_id: z.string().min(1), name: z.string() })) });

/** Choose from ElevenLabs' stock voices when the account has no configured voice ID. */
export async function defaultVoiceId(apiKey: string, request: typeof fetch = fetch): Promise<string> {
  const response = await request("https://api.elevenlabs.io/v2/voices?voice_type=default&page_size=100&include_total_count=false", {
    headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Object.assign(new Error("Could not load ElevenLabs stock voices."), { code: `TTS_VOICE_HTTP_${response.status}` });
  const { voices } = VoiceListSchema.parse(await response.json());
  const voice = voices.find((item) => /^(sarah|rachel|george)\b/i.test(item.name)) ?? voices[0];
  if (!voice) throw Object.assign(new Error("No stock voice is available. Set ELEVENLABS_VOICE_ID."), { code: "TTS_VOICE_MISSING" });
  return voice.voice_id;
}
