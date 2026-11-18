---
name: debrio-access-and-data
description: Implement or review Debrio identities, permissions, resource allocation, publication approval, persistence, and exports. Use for Debrio data or access changes; not as a general authentication policy for other projects.
---

# Debrio access and data

Read the relevant requirements in [PRD v0.5](../../docs/Debrio_PRD_v0.5.md), especially sections 3, 7, 9, 11, 13, and 16. Read the accepted architecture and glossary when present. Use their chosen technologies; this skill does not select an auth provider, database, or retention period.

## Rules that change implementation

- Require two-factor authentication for the platform operator, workspace owners and billing/data administrators, with secure recovery and reauthentication for sensitive actions. Privileged-role assignment cannot bypass enrollment. Prove host recovery/session invalidation separately from guest recovery; closure resolves ownership and billing per workspace without deleting unrelated shared work.
- Restored data stays inaccessible until deletions, revocations, absolute expiry, linked storage and current billing are reconciled; backup restore must not resurrect access or erased evidence.
- Platform-owner permanent free use is an explicit billing entitlement, not ordinary workspace ownership or a permission bypass. Bind it server-side to the verified operator account and designated owner workspace under ordinary technical capacity limits; customer ownership transfer cannot mint or carry it. Workspace transfer needs recipient acceptance and cannot leave an ownerless workspace. Creator departure does not delete workspace-owned reusable content.
- A workspace can belong to an individual trainer/consultant or an organisation. Support one-person onboarding without company details, a corporate email domain or additional staff. Workspace ownership/billing and session facilitation remain distinct capabilities even when one person holds both; personal workspaces require the same isolation as organisation workspaces.
- One account may belong to multiple workspaces with an explicit switcher. Authorize each request and active connection in its workspace; never carry content, billing authority or an exemption across a switch. Test stale requests and revoked membership.
- Keep organization, session, media-room membership, group/role assignment, and resource assignment distinct. Moving a person into a video room cannot grant that group's private resources. Preserve jigsaw home/expert mappings separately.
- Authenticate facilitators; scoped guest invitations admit identifiable participants without requiring paid accounts. An organization administrator has no automatic listening entitlement. Enforce authorization on the server, existing connections, subscriptions, file URLs, captions, playback, previews, and exports.
- An individual/group/role resource grant and its release state both have to permit access. Unreleased titles and previews are private. Test overlapping grants and explicit reassignment; a room visit alone changes neither resource ownership nor assignment.
- Private individual answers are visible to their author and authorized facilitator. Observer feedback follows its explicit author/subject/facilitator allocation. Group work follows the sharing rule disclosed before contribution.
- Identifiable individual publication needs author approval for the exact proposed item/version and audience. A changed publication requires a new approval. Pending or declined approval never blocks participation and never becomes permission through an export or alternate view.
- Expanded publication of identifiable feedback additionally needs the subject's approval for that exact version/audience. Both author and subject must approve; either withdrawal stops the expanded access. Within-workshop group sharing is disclosed before contribution and does not grant external-client publication.
- External group-submission publication needs every required contributor's approval for the exact version/client audience; recorder consent is not sufficient. Snapshot everyone assigned to the group at submission, including verbal contributors, and preserve those required approvers across membership changes.
- Participants retain contributed submitted group snapshots after reassignment, subject to revocation/retention; former private resources and ongoing/future drafts need an independent grant.
- Post-session review/export uses the private participant identity within 90-day session retention, subject to current permissions and earlier deletion/revocation. Lost access requires facilitator-verified recovery; a shared link never unlocks history.
- Shared session links lead to a controlled lobby, not saved private work. Facilitator-verified identity recovery revokes the previous active endpoint. Client-summary contacts verify the invited email: seven-day invitation redemption, 30-day grant, earlier revocation/source expiry/withdrawal enforced without automatic deadline resets.
- Freeze submitted attempts and group membership attribution. A retry creates a linked revision; concurrent writes cannot silently overwrite accepted work. Stable participant identity must survive reconnect and media-provider identity changes.
- Revocation applies to active media/data access. A short token lifetime alone is insufficient. Acknowledged saves must survive reconnect; pending edits and conflicting changes must remain visible.
- Verified early-deletion requests require the workspace owner or delegated data administrator acting within scope. Remove affected personal evidence and dependent publications, preserve separable contributions where possible and explicitly review inseparable joint records. Immediate publication withdrawal remains independent.
- Validate uploads and render untrusted content safely. External video links retain their external availability/authorization limits. Do not promise recall of downloaded copies.
- Copying a workshop copies configuration and authorized resource references, not prior participant records, live state, or publication approvals. Do not invent statutory retention periods from another project's policy.

## Required proof for an affected path

Use a real persistence integration test for transaction/concurrency behavior. Exercise an authorized caller, another participant/group, another session, and another organization where applicable. Include revoked access, unreleased content, copied direct URLs, retry, and reconnect for the changed mechanism. For publication, prove an approved revision works and a changed or declined revision is denied through both live views and export.

Record criteria, commands, evidence, and unverified limits using [the engineering workflow](../../docs/engineering/WORKFLOW.md). Do not claim a production security review from these focused tests.
