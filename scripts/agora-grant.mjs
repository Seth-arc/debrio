import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Pinned provider implementation lets us omit video/data privileges entirely.
const { AccessToken2, ServiceRtc } = require("agora-token/src/AccessToken2");

// This is a synthetic CLI fixture, not Debrio's production authorization service.
export function issueAgoraGrant(
  { appId, certificate, channel, uid, publish, authorizedAt, runExpiresAt },
  now = Date.now()
) {
  if (
    !/^[a-f0-9]{32}$/i.test(appId ?? "") ||
    !/^[a-f0-9]{32}$/i.test(certificate ?? "")
  )
    throw new Error("Missing or invalid Agora configuration");
  if (
    !/^p101-[a-f0-9]{16}-[ab]$/.test(channel) ||
    ![101, 102, 103].includes(uid) ||
    typeof publish !== "boolean"
  )
    throw new Error("Invalid synthetic assignment");
  if (
    ![now, authorizedAt, runExpiresAt].every(Number.isSafeInteger) ||
    authorizedAt > now
  )
    throw new Error("Invalid authorization clock");
  const issueSeconds = Math.floor(authorizedAt / 1000);
  const expiresAt =
    Math.floor(Math.min(authorizedAt + 10_000, runExpiresAt) / 1000) * 1000;
  if (expiresAt <= now) throw new Error("Expired authorization");
  const lifetime = expiresAt / 1000 - issueSeconds;
  if (lifetime <= 0 || lifetime > 10)
    throw new Error("Invalid authorization lifetime");
  const token = new AccessToken2(appId, certificate, issueSeconds, lifetime);
  const rtc = new ServiceRtc(channel, uid);
  rtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, lifetime);
  if (publish)
    rtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, lifetime);
  token.add_service(rtc);
  const encoded = token.build();
  if (!encoded) throw new Error("Token creation failed");
  return {
    token: encoded,
    appId,
    channel,
    uid,
    publish,
    authorizedAt,
    expiresAt,
  };
}
