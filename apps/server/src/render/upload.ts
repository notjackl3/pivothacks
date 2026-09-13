import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config, dataDir } from "../config.js";
import { getDb } from "../db/client.js";

export async function uploadArtifactFile(userId: string, messageId: string, file: string, kind: "audio" | "video"): Promise<string> {
  z.string().uuid().parse(userId); z.string().uuid().parse(messageId);
  const storagePath = `${userId}/${messageId}.${kind === "audio" ? "mp3" : "mp4"}`;
  const { error } = await getDb().storage.from(config.SUPABASE_STORAGE_BUCKET).upload(storagePath, await readFile(file), { contentType: kind === "audio" ? "audio/mpeg" : "video/mp4", upsert: true });
  if (error) throw Object.assign(new Error("The artifact could not be stored."), { code: "STORAGE" });
  return storagePath;
}
export async function signedArtifactUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await getDb().storage.from(config.SUPABASE_STORAGE_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw Object.assign(new Error("The artifact link could not be created."), { code: "STORAGE" });
  return data.signedUrl;
}
export async function downloadArtifactFile(userId: string, messageId: string, storagePath: string): Promise<string> {
  z.string().uuid().parse(userId); z.string().uuid().parse(messageId);
  if (![`${userId}/${messageId}.mp3`, `${userId}/${messageId}.mp4`].includes(storagePath)) throw new Error("Artifact does not belong to this message.");
  const directory = path.join(dataDir, "restored", userId);
  const file = path.join(directory, path.basename(storagePath));
  const { data, error } = await getDb().storage.from(config.SUPABASE_STORAGE_BUCKET).download(storagePath);
  if (error) throw Object.assign(new Error("The stored artifact could not be downloaded."), { code: "STORAGE" });
  await mkdir(directory, { recursive: true });
  await writeFile(file, Buffer.from(await data.arrayBuffer()));
  return file;
}
