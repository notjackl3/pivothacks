import type { Metadata } from "next";
import { MessageDetail } from "@/components/history/MessageDetail";

export const metadata: Metadata = { title: "Message" };

// Next 15+ passes route params as a Promise; typed explicitly (no reliance on the generated PageProps global).
export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MessageDetail id={id} />;
}
