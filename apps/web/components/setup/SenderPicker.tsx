"use client";

import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import type { EntitiesResponse, EntityPerson, SenderRelationship, SlackIntegrationState, TrackedEntity } from "@reelrelay/shared";
import { describeError, getEntities, putTrackedEntity } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { RELATIONSHIP_OPTIONS } from "@/lib/status";
import { Banner, Button, Card, Chip, Input, Label, Select } from "@/components/ui";

export interface SenderPickerProps {
  slack: SlackIntegrationState | null;
  tracked: TrackedEntity[] | null;
  onChanged: () => Promise<unknown>;
  index?: number;
}

const EMPTY_PEOPLE: EntitiesResponse = { people: [] };

export function SenderPicker({ slack, tracked, onChanged, index = 0 }: SenderPickerProps) {
  const connected = Boolean(slack?.connected);
  const botMode = slack?.mode === "bot_token";
  const connectionId = connected ? slack?.connectionId ?? null : null;
  const current = useMemo(() => (tracked ?? []).find((entity) => entity.enabled) ?? null, [tracked]);

  const statusChip = current ? (
    <Chip tone="success" size="md">
      Tracking
    </Chip>
  ) : (
    <Chip tone="neutral" size="md">
      Nothing tracked
    </Chip>
  );

  return (
    <Card
      eyebrow="Step 3"
      title={botMode ? "Channel to track" : "Sender to track"}
      description={botMode ? "Bot mode: messages in this channel are relayed." : "Only DMs from this one person are relayed; everything else is dropped before storage."}
      action={statusChip}
      index={index}
    >
      <div className="space-y-4">
        {current && (
          <div className="space-y-3 rounded-xl border border-success/30 bg-success-soft px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-success">Currently tracking</p>
                <p className="truncate text-base font-medium text-ink">
                  {current.displayName}
                  <span className="ml-2 font-mono text-xs text-ink-muted">{current.externalEntityId}</span>
                </p>
              </div>
              <span className="text-xs text-ink-muted">{current.entityType === "channel" ? "Channel" : "Person"}</span>
            </div>
            <RelationshipPicker current={current} onChanged={onChanged} />
          </div>
        )}

        {!connected ? (
          <p className="text-sm text-ink-muted">Connect Slack first — the people list comes from your workspace.</p>
        ) : botMode ? (
          <ChannelForm connectionId={connectionId as string} current={current} onChanged={onChanged} />
        ) : (
          <PeoplePicker connectionId={connectionId as string} current={current} onChanged={onChanged} />
        )}
      </div>
    </Card>
  );
}

/** Pivot 03: who the sender is to the student. Saves immediately; changes narration register and the default reply tone. */
function RelationshipPicker({ current, onChanged }: { current: TrackedEntity; onChanged: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const option = RELATIONSHIP_OPTIONS.find((o) => o.value === current.relationship) ?? RELATIONSHIP_OPTIONS[RELATIONSHIP_OPTIONS.length - 1]!;

  async function save(relationship: SenderRelationship) {
    setBusy(true);
    setError(null);
    try {
      await putTrackedEntity({ connectionId: current.connectionId, externalEntityId: current.externalEntityId, displayName: current.displayName, entityType: current.entityType, relationship });
      await onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
      <Label htmlFor={`${id}-relationship`} hint="changes tone and priority">
        Who is this to you?
      </Label>
      <Select id={`${id}-relationship`} value={current.relationship} disabled={busy} onChange={(event) => void save(event.target.value as SenderRelationship)}>
        {RELATIONSHIP_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <p className="text-xs text-ink-faint">{option.hint}.</p>
    </div>
  );
}

function PeoplePicker({ connectionId, current, onChanged }: { connectionId: string; current: TrackedEntity | null; onChanged: () => Promise<unknown> }) {
  const loader = useCallback(() => (connectionId ? getEntities(connectionId) : Promise.resolve(EMPTY_PEOPLE)), [connectionId]);
  const people = useResource(loader);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EntityPerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const all = people.data?.people ?? [];
    const q = query.trim().toLowerCase();
    const list = q ? all.filter((person) => person.name.toLowerCase().includes(q) || person.id.toLowerCase().includes(q)) : all;
    return list.slice(0, 200);
  }, [people.data, query]);

  const choice = selected ?? (filtered.length === 1 ? filtered[0] : null);
  const alreadyTracked = choice !== null && current?.externalEntityId === choice.id && current.entityType === "person";

  async function track(person: EntityPerson) {
    setBusy(true);
    setError(null);
    try {
      await putTrackedEntity({ connectionId, externalEntityId: person.id, displayName: person.name, entityType: "person" });
      await onChanged();
      setSelected(null);
      setQuery("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (choice && !alreadyTracked) void track(choice);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
      {people.error ? (
        <Banner tone="danger">
          Could not load people: {describeError(people.error)}{" "}
          <button type="button" onClick={() => void people.refresh()} className="font-medium underline underline-offset-2">
            Retry
          </button>
        </Banner>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${listId}-search`} hint={people.data ? `${people.data.people.length} people` : undefined}>
          Search people
        </Label>
        <Input
          id={`${listId}-search`}
          type="search"
          placeholder="Type a name…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
          }}
          disabled={people.loading}
          aria-controls={listId}
          autoComplete="off"
        />
      </div>

      <div id={listId} role="listbox" aria-label="People" className="max-h-56 overflow-y-auto rounded-lg border border-line bg-surface">
        {people.loading ? (
          <p className="px-3 py-3 text-sm text-ink-muted">Loading people…</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-3 text-sm text-ink-muted">{query ? "No one matches." : "No people found in this workspace."}</p>
        ) : (
          filtered.map((person) => {
            const isChoice = choice?.id === person.id;
            const isTracked = current?.externalEntityId === person.id;
            return (
              <button
                key={person.id}
                type="button"
                role="option"
                aria-selected={isChoice}
                onClick={() => setSelected(person)}
                className={`flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left text-sm last:border-b-0 ${
                  isChoice ? "bg-accent-soft text-accent-strong" : "text-ink hover:bg-surface-muted"
                }`}
              >
                <span className="truncate font-medium">{person.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {isTracked && <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-success">tracked</span>}
                  <span className="font-mono text-xs text-ink-faint">{person.id}</span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {choice ? (
            <>
              Selected: <span className="font-medium text-ink">{choice.name}</span>
            </>
          ) : (
            "Pick a person from the list."
          )}
        </p>
        <Button type="submit" size="lg" disabled={!choice || alreadyTracked} loading={busy}>
          {alreadyTracked ? "Already tracked" : current ? "Track this sender instead" : "Track this sender"}
        </Button>
      </div>
    </form>
  );
}

function ChannelForm({ connectionId, current, onChanged }: { connectionId: string; current: TrackedEntity | null; onChanged: () => Promise<unknown> }) {
  const [channelId, setChannelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = channelId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await putTrackedEntity({
        connectionId,
        externalEntityId: id,
        displayName: displayName.trim() || id,
        entityType: "channel",
      });
      await onChanged();
      setChannelId("");
      setDisplayName("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-channel`} hint="e.g. C0123ABCDEF">
            Channel ID
          </Label>
          <Input
            id={`${ids}-channel`}
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            placeholder="C…"
            className="font-mono"
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-name`} hint="shown in History">
            Display name
          </Label>
          <Input id={`${ids}-name`} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="#demo-class" autoComplete="off" />
        </div>
      </div>
      <p className="text-xs text-ink-faint">
        Invite the bot to the channel first. In Slack: channel details → About → Channel ID.
      </p>
      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={busy} disabled={!channelId.trim()}>
          {current ? "Track this channel instead" : "Track this channel"}
        </Button>
      </div>
    </form>
  );
}
