# Find Personal Emails (Gmail/Yahoo) by Phone Number

## Goal
Add a second, separate email lookup on the Leads page that searches the web for **personal** email addresses (e.g. Gmail, Yahoo, Outlook) connected to a business's phone number. The existing business-email lookup stays unchanged, and both emails are kept side by side in separate columns.

## What gets built

### 1. Database
- Add column `personal_email text` to `public.leads` (nullable, like `email`).

### 2. Server lookup (src/lib/leads.functions.ts)
- New server function `findPersonalEmailsForLeads` (mirrors the existing `findEmailsForLeads`):
  - Accepts up to 10 lead IDs.
  - Skips leads that already have a `personal_email`.
  - Calls ScrapeGraphAI SearchScraper with a prompt tuned for personal inboxes, e.g.: "Find any personal email address (Gmail, Yahoo, Outlook, etc.) publicly connected to the phone number `<phone>` belonging to the business `<name>` at `<address>` — owner or staff personal inboxes listed on Facebook, directories or other public pages."
  - Extracts the email with the existing `extractEmails` helper and saves it to `personal_email` (never touches `email`).
  - Returns per-lead results and a found count.

### 3. Leads page UI (src/routes/leads.tsx)
- New **Personal email** column next to the existing Email column.
- Per row: a "Find personal" button when the cell is empty (same pattern as "Find email").
- Batch: a "Find personal emails (N)" toolbar button for selected leads that are missing a personal email, with the same chunked progress display (chunks of 5).
- Search box also matches against `personal_email`.

### 4. Export (src/lib/export.ts)
- Add `personal_email` to `LeadRow` so CSV and Excel exports include both email columns.

### 5. Types
- Regenerate the Supabase types so `personal_email` is typed in the client.

## Verification
- Typecheck passes.
- Column exists in the database; a real lookup on one lead with a phone number saves a personal email (or returns nothing cleanly if none is public).
