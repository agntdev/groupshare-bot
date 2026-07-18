# Group File Share Manager — Bot specification

**Archetype:** custom

**Voice:** professional and warm — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that lets group/channel admins upload files and generate shareable links restricted to group members. Admins can configure link expiration, download limits, passwords, and manage access logs. Files are stored securely with automatic cleanup after expiration.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Telegram group/channel admins
- Group members needing secure file access

## Success criteria

- Admins can create and revoke links with configurable restrictions
- Members can download files only if they are current group members
- Access logs are maintained for auditing

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open admin onboarding menu or main dashboard
- **Upload Files** (button, actor: admin, callback: upload:start) — Begin file upload process for link creation
  - inputs: file(s), expiry settings, password
  - outputs: confirmation message with management controls
- **Manage Active Links** (button, actor: admin, callback: links:list) — View and manage all active file links for the group
- **View Access Logs** (button, actor: admin, callback: logs:view) — Display download attempts and success rates

## Flows

### Admin Onboarding
_Trigger:_ Bot added to group + /start

1. Verify admin status in group
2. Register admin for file uploads
3. Confirm permissions

_Data touched:_ Group, Admin user

### Link Creation
_Trigger:_ Admin uploads files via DM

1. Receive files
2. Configure options (expiry, password)
3. Generate link token
4. Post link to group
5. Send admin management card

_Data touched:_ File record, Bundle/Link, Access log

### File Download
_Trigger:_ Member clicks group link

1. Validate group membership
2. Check password/expiration/download limits
3. Serve files (ZIP or individual)
4. Log access attempt

_Data touched:_ Bundle/Link, Access log

### Link Management
_Trigger:_ Admin interacts with management card

1. Revoke link
2. Adjust expiry/download limits
3. View usage stats

_Data touched:_ Bundle/Link, Access log

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Group** _(retention: persistent)_ — Telegram group/channel with verified admin list
  - fields: telegram_id, title, admin_user_ids
- **Admin user** _(retention: persistent)_ — Verified group administrator with upload permissions
  - fields: user_id, telegram_username, group_ids
- **File record** _(retention: persistent)_ — Metadata for uploaded files
  - fields: file_id, original_name, size, mime_type, storage_path
- **Bundle/Link** _(retention: persistent)_ — Shareable link with file references and access controls
  - fields: token, group_id, admin_id, expiry_time, max_downloads, password_hash, file_ids
- **Access log** _(retention: persistent)_ — Download attempt records
  - fields: timestamp, user_id, success, ip_address

## Integrations

- **Telegram Bot API** (required) — Messaging, file handling, and group membership validation
- **Storage Backend** (required) — File storage and retrieval
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure admin permissions per group
- Set default expiry options (1h/1d/7d)
- Adjust access log retention period (default 90 days)

## Notifications

- DM confirmation when link is created
- Group/channel message with shareable link
- Expiry warning notifications (24h before)

## Permissions & privacy

- Only group admins can upload files
- Link access requires current group membership
- Password protection for sensitive bundles

## Edge cases

- Non-admin users attempting to upload files
- Expired links with pending downloads
- Password reset requests for active links

## Required tests

- End-to-end link creation and download flow with membership validation
- Admin revocation of active link
- Expiry handling with warning notifications

## Assumptions

- Admin-only uploads prevent unauthorized sharing
- ZIP bundling is default for multi-file downloads
- Automatic garbage collection after retention period
