export const gameplayIds = ["subway-surfers", "minecraft-parkour", "gta-racing"] as const;
export type GameplayId = typeof gameplayIds[number];

type GameplayClip = {
  id: GameplayId;
  label: string;
  file: string;
  durationInFrames: number;
  creator: string;
  creatorUrl: string;
  sourceUrl: string;
  license: string;
};

export const gameplays: Record<GameplayId, GameplayClip> = {
  "subway-surfers": {
    id: "subway-surfers", label: "Subway Surfers", file: "gameplay/subway-surfers.mp4", durationInFrames: 1800,
    creator: "LoopScape Gameplays", creatorUrl: "https://www.youtube.com/@LoopScapeVideos",
    sourceUrl: "https://www.youtube.com/watch?v=Iot_bB8lKgE", license: "Creative Commons Attribution",
  },
  "minecraft-parkour": {
    id: "minecraft-parkour", label: "Minecraft Parkour", file: "gameplay/minecraft-parkour.mp4", durationInFrames: 1800,
    creator: "No Copyright Gameplay", creatorUrl: "https://www.youtube.com/NoCopyrightGameplays",
    sourceUrl: "https://www.youtube.com/watch?v=jN1Se8JPyKs", license: "Creative Commons Attribution",
  },
  "gta-racing": {
    id: "gta-racing", label: "GTA Racing", file: "gameplay/gta-racing.mp4", durationInFrames: 1800,
    creator: "Dope Gameplays", creatorUrl: "https://www.youtube.com/@nocopyrightgameplay4u",
    sourceUrl: "https://www.youtube.com/watch?v=qAI0mrCzDp0", license: "Creative Commons Attribution",
  },
};

export function getGameplay(id = "subway-surfers"): GameplayClip {
  if (!Object.hasOwn(gameplays, id)) throw new Error(`Choose a background: ${gameplayIds.join(", ")}`);
  return gameplays[id as GameplayId];
}

export function gameplayCredit(id?: string): string {
  const clip = getGameplay(id);
  return `${clip.creator} — ${clip.creatorUrl} — ${clip.sourceUrl} — ${clip.license}; cropped, silent excerpt`;
}
