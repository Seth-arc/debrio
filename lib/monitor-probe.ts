import { open, readFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from "livekit-server-sdk";
import {
  authorizeProbe,
  type Assignment,
  type ProbeFixture,
} from "./media-probe";
import { ProbeError } from "./probe-request";
import { probeProviderAllowed, revocationCutoff } from "./probe-provider";

export type Mode = "listen" | "speak" | "join";
type Actor = Assignment & {
  role: "participant" | "facilitator" | "operator";
  name: string;
};
export type MonitorFixture = Omit<ProbeFixture, "assignments"> & {
  assignments: Actor[];
};
type Route = {
  id: number;
  room: string;
  providerRoom: string;
  identity: string;
  mode: Mode;
  phase: "notice" | "active" | "closing" | "failed";
  required: string[];
  acknowledged: string[];
  subscriptions: string[];
};
type Work = { identity: string; revision: number; text: string };
type Event = { at: number; kind: string; route: number; room: string };
export type MonitorState = {
  next: number;
  assignedRoom: string;
  revoked: boolean;
  controlFailure: boolean;
  route: Route | null;
  work: Work[];
  events: Event[];
};
export type MonitorView = {
  revision: number;
  identity: string;
  name: string;
  role: Actor["role"];
  rooms: string[];
  peers: string[];
  assignedRoom: string;
  revoked: boolean;
  controlFailure: boolean;
  route: Route | null;
  work: Work;
  events: Event[];
  expiresAt: number;
};
type Provider = Pick<
  RoomServiceClient,
  "listParticipants" | "removeParticipant" | "updateSubscriptions"
>;

export const initialMonitorState = (): MonitorState => ({
  next: 0,
  assignedRoom: "main",
  revoked: false,
  controlFailure: false,
  route: null,
  work: [],
  events: [],
});

export async function writeMonitorState(path: string, state: MonitorState) {
  // Internal fixed fixture path (or test temp path), never request input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const file = await open(`${path}.tmp`, "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(state));
    await file.sync();
  } finally {
    await file.close();
  }
  // Retry brief Windows replacement locks without deleting the prior committed file.
  for (let attempt = 0; ; attempt++) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same internal fixture path
      await rename(`${path}.tmp`, path);
      return;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (attempt === 3 || (code !== "EPERM" && code !== "EBUSY")) throw error;
      await delay(25 * (attempt + 1));
    }
  }
}

// shortcut: one loopback process owns this disposable fixture; use database transactions before multi-process use.
export class MonitorProbe {
  constructor(
    private fixture: MonitorFixture,
    private state: MonitorState,
    private provider: Provider,
    private persist: (state: MonitorState) => Promise<void>,
    private sign: (actor: Actor, route: Route | null) => Promise<unknown>,
    private cloud = false
  ) {}

  private async event(kind: string) {
    this.state.events.push({
      at: Date.now(),
      kind,
      route: this.state.route?.id ?? 0,
      room: this.state.route?.room ?? "",
    });
    this.state.events = this.state.events.slice(-200);
    await this.persist(this.state);
  }

  private async closeRoute() {
    const route = this.state.route;
    if (!route) return;
    const retry = route.phase === "failed";
    if (!retry) this.state.next++;
    route.phase = "closing";
    await this.event("closing");
    try {
      if (this.state.controlFailure)
        throw new Error("Synthetic control outage");
      const participants = await this.provider.listParticipants(
        route.providerRoom
      );
      if (
        this.cloud ||
        participants.some((p) => p.identity === route.identity)
      ) {
        try {
          await this.provider.removeParticipant(
            route.providerRoom,
            route.identity,
            this.cloud ? { revokeTokenTs: revocationCutoff() } : undefined
          );
        } catch (error) {
          // A local peer can leave between list/remove; Cloud must still confirm token revocation.
          if (this.cloud) throw error;
        }
      }
      if (
        (await this.provider.listParticipants(route.providerRoom)).some(
          (p) => p.identity === route.identity
        )
      )
        throw new Error("Closure unconfirmed");
      await this.event("closed");
      if (retry) this.state.next++;
      this.state.route = null;
      await this.persist(this.state);
    } catch {
      route.phase = "failed";
      await this.event("cleanup-failed");
      throw new ProbeError(
        503,
        "Old route cleanup unconfirmed. Retry Stop before opening another room."
      );
    }
  }

  private async syncSubscriptions() {
    const route = this.state.route;
    if (!route || route.phase !== "active" || this.state.controlFailure) return;
    const participants = await this.provider.listParticipants(
      route.providerRoom
    );
    if (!participants.some((p) => p.identity === route.identity)) {
      route.phase = "failed";
      await this.event("connection-lost");
      return;
    }
    const tracks = participants
      .filter((p) => route.acknowledged.includes(p.identity))
      .flatMap((p) => p.tracks)
      .filter(
        (t) =>
          t.source === TrackSource.MICROPHONE ||
          (route.mode === "join" && t.source === TrackSource.CAMERA)
      )
      .map((t) => t.sid);
    const added = tracks.filter((sid) => !route.subscriptions.includes(sid));
    if (added.length) {
      await this.provider.updateSubscriptions(
        route.providerRoom,
        route.identity,
        added,
        true
      );
      route.subscriptions = tracks;
      await this.event("tracks-authorized");
    }
  }

  private async connectedAudience(providerRoom: string) {
    const present = await this.provider.listParticipants(providerRoom);
    return this.fixture.assignments
      .filter(
        (a) =>
          a.role === "participant" &&
          a.providerRoom === providerRoom &&
          present.some((p) => p.identity === a.identity)
      )
      .map((a) => a.identity);
  }

  async handle(input: unknown) {
    const actor = authorizeProbe(input, this.fixture) as Actor | undefined;
    if (!actor || !input || typeof input !== "object")
      throw new ProbeError(403, "Invalid or expired synthetic invitation.");
    const request = input as Record<string, unknown>;
    const facilitator = actor.role === "facilitator";
    const operator = actor.role === "operator";
    const ownWork = () =>
      this.state.work.find((work) => work.identity === actor.identity) ?? {
        identity: actor.identity,
        revision: 0,
        text: "",
      };
    const view = (): MonitorView => ({
      revision: this.state.next,
      identity: actor.identity,
      name: actor.name,
      role: actor.role,
      peers: this.fixture.assignments
        .filter(
          (a) =>
            a.role === "participant" && a.providerRoom === actor.providerRoom
        )
        .map((a) => a.identity),
      rooms: [
        ...new Set(
          this.fixture.assignments
            .filter(
              (a) => a.session === actor.session && a.role === "participant"
            )
            .map((a) => a.room)
        ),
      ],
      assignedRoom: facilitator ? this.state.assignedRoom : actor.room,
      revoked: this.state.revoked,
      controlFailure: this.state.controlFailure,
      route:
        facilitator ||
        operator ||
        (this.state.route?.room === actor.room && actor.session === "a")
          ? this.state.route
          : null,
      work: ownWork(),
      events: facilitator || operator ? this.state.events : [],
      expiresAt: this.fixture.expiresAt,
    });
    if (request.action === "read") {
      try {
        await this.syncSubscriptions();
      } catch {
        // Unknown provider state must attempt cleanup and retain a failed notice.
        try {
          await this.closeRoute();
        } catch {
          /* closeRoute persists failure. */
        }
      }
      return view();
    }
    if (request.action === "save") {
      if (typeof request.text !== "string" || request.text.length > 2000)
        throw new ProbeError(400, "Use at most 2000 characters.");
      const work = ownWork();
      if (request.revision !== work.revision)
        throw new ProbeError(
          409,
          "Saved work changed. Reload saved text before retrying; your edit was not overwritten."
        );
      if (!this.state.work.includes(work)) this.state.work.push(work);
      work.text = request.text;
      work.revision++;
      await this.persist(this.state);
      return view();
    }
    if (request.action === "fault") {
      if (!operator || typeof request.enabled !== "boolean")
        throw new ProbeError(403, "Operator permission required.");
      this.state.controlFailure = request.enabled;
      await this.event(
        request.enabled ? "control-unavailable" : "control-restored"
      );
      if (request.enabled) {
        try {
          await this.closeRoute();
        } catch {
          /* Injected failure remains visible. */
        }
      }
      return view();
    }
    if (request.action === "revoke") {
      if (!operator) throw new ProbeError(403, "Operator permission required.");
      this.state.revoked = true;
      await this.event("revoked");
      await this.closeRoute();
      return view();
    }
    if (request.action === "stop") {
      if (!facilitator && !operator)
        throw new ProbeError(403, "Facilitator permission required.");
      if (request.revision !== this.state.next)
        throw new ProbeError(
          409,
          "Route changed. Refresh status before retrying Stop."
        );
      this.state.next++;
      await this.event("stop-requested");
      await this.closeRoute();
      return view();
    }
    if (request.action === "request") {
      if (!facilitator || this.state.revoked)
        throw new ProbeError(403, "Facilitator permission denied.");
      if (request.revision !== this.state.next)
        throw new ProbeError(
          409,
          "Route changed. Refresh status before retrying the transfer."
        );
      if (!["listen", "speak", "join"].includes(String(request.mode)))
        throw new ProbeError(400, "Invalid mode.");
      const target = this.fixture.assignments.find(
        (a) =>
          a.session === actor.session &&
          a.role === "participant" &&
          a.room === request.target
      );
      if (!target) throw new ProbeError(403, "Room outside your session.");
      await this.closeRoute();
      if (this.state.controlFailure)
        throw new ProbeError(503, "Provider control unavailable.");
      const required = await this.connectedAudience(target.providerRoom);
      if (!required.length)
        throw new ProbeError(
          409,
          "Room unavailable: no connected synthetic participants."
        );
      this.state.route = {
        id: ++this.state.next,
        room: target.room,
        providerRoom: target.providerRoom,
        identity: `monitor-${this.state.next}-${randomUUID()}`,
        mode: request.mode as Mode,
        phase: "notice",
        required,
        acknowledged: [],
        subscriptions: [],
      };
      await this.event("notice-established");
      return view();
    }
    const route = this.state.route;
    if (request.action === "ack") {
      if (
        actor.role !== "participant" ||
        actor.session !== "a" ||
        !route ||
        actor.room !== route.room ||
        request.route !== route.id
      )
        throw new ProbeError(409, "Notice is no longer current.");
      if (!route.acknowledged.includes(actor.identity)) {
        route.acknowledged.push(actor.identity);
        await this.event("notice-acknowledged");
      }
      return view();
    }
    if (request.action === "grant") {
      if (operator) throw new ProbeError(403, "Operator cannot join media.");
      if (
        facilitator &&
        (this.state.revoked ||
          !route ||
          request.route !== route.id ||
          !["notice", "active"].includes(route.phase))
      )
        throw new ProbeError(403, "Route permission denied.");
      if (facilitator && route) {
        const current = await this.connectedAudience(route.providerRoom);
        if (!current.length)
          throw new ProbeError(
            409,
            "Room unavailable: no connected synthetic participants."
          );
        if (
          current.length !== route.required.length ||
          current.some((identity) => !route.required.includes(identity))
        ) {
          route.required = current;
          await this.event("notice-audience-updated");
        }
      }
      if (
        facilitator &&
        route &&
        !route.required.every((identity) =>
          route.acknowledged.includes(identity)
        )
      )
        throw new ProbeError(409, "Waiting for participant notice.");
      if (
        !facilitator &&
        route?.room === actor.room &&
        actor.session === "a" &&
        !route.acknowledged.includes(actor.identity)
      )
        throw new ProbeError(
          409,
          "Display and acknowledge the room notice first."
        );
      if (this.state.controlFailure)
        throw new ProbeError(503, "Provider control unavailable.");
      await this.event(facilitator ? "route-granted" : "participant-granted");
      return {
        ...view(),
        grant: await this.sign(actor, facilitator ? route : null),
      };
    }
    if (request.action === "connected") {
      if (
        !facilitator ||
        this.state.revoked ||
        !route ||
        request.route !== route.id ||
        route.phase !== "notice"
      )
        throw new ProbeError(409, "Stale route confirmation.");
      if (
        this.state.controlFailure ||
        !(await this.provider.listParticipants(route.providerRoom)).some(
          (p) => p.identity === route.identity
        )
      )
        throw new ProbeError(409, "Provider connection not confirmed.");
      route.phase = "active";
      if (route.mode === "join") this.state.assignedRoom = route.room;
      await this.event("connected");
      await this.syncSubscriptions();
      return view();
    }
    throw new ProbeError(400, "Unknown probe command.");
  }
}

let pending: Promise<unknown> = Promise.resolve();
export function handleMonitor(input: unknown): Promise<unknown> {
  const run = pending.then(async () => {
    const cloud = process.env.MEDIA_PROBE_CLOUD === "1";
    if (
      !probeProviderAllowed(
        process.env.LIVEKIT_URL,
        cloud,
        process.env.LIVEKIT_PROBE_CONFIRMED === "1",
        !!process.env.CI || !!process.env.VERCEL
      )
    )
      throw new ProbeError(
        503,
        "Provider is not authorized for this probe run."
      );
    const fixture: MonitorFixture = JSON.parse(
      await readFile(".artifacts/media-probe/monitor-fixture.json", "utf8")
    );
    const path = ".artifacts/media-probe/monitor-state.json";
    const state: MonitorState = JSON.parse(await readFile(path, "utf8"));
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!key || !secret)
      throw new ProbeError(503, "Missing local provider configuration.");
    const provider = new RoomServiceClient(
      process.env.LIVEKIT_URL!,
      key,
      secret,
      { requestTimeout: 2, failover: false }
    );
    return new MonitorProbe(
      fixture,
      state,
      provider,
      (value) => writeMonitorState(path, value),
      async (actor, route) => {
        const ttl = Math.min(
          30,
          Math.floor((fixture.expiresAt - Date.now()) / 1000)
        );
        if (ttl < 1) throw new ProbeError(403, "Run expired.");
        const publish = !route || route.mode !== "listen";
        const token = new AccessToken(key, secret, {
          identity: route?.identity ?? actor.identity,
          name: actor.name,
          ttl,
        });
        token.addGrant({
          roomJoin: true,
          room: route?.providerRoom ?? actor.providerRoom,
          // Room scope is enforced by the SFU; track selection is not a narrower grant.
          canSubscribe: true,
          canPublish: publish,
          canPublishSources:
            !route || route.mode === "join"
              ? [TrackSource.MICROPHONE, TrackSource.CAMERA]
              : [TrackSource.MICROPHONE],
          canPublishData: false,
          canUpdateOwnMetadata: false,
          hidden: false,
          roomAdmin: false,
          roomCreate: false,
          roomList: false,
          roomRecord: false,
        });
        if (cloud) {
          const ledger = await open(
            ".artifacts/media-probe/issued.jsonl",
            "a",
            0o600
          );
          try {
            await ledger.writeFile(
              JSON.stringify({
                room: route?.providerRoom ?? actor.providerRoom,
                identity: route?.identity ?? actor.identity,
              }) + "\n"
            );
            await ledger.sync();
          } finally {
            await ledger.close();
          }
        }
        return {
          token: await token.toJwt(),
          url: process.env.LIVEKIT_URL,
          identity: route?.identity ?? actor.identity,
          room: route?.room ?? actor.room,
        };
      },
      cloud
    ).handle(input);
  });
  pending = run.catch(() => {});
  return run;
}
