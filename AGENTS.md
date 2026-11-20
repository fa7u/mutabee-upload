<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Runtime database clients and bearer middleware use the external integration consistently; generated Cloud clients remain untouched. Why: prevents split authentication and reads across two databases.
- First-owner availability checks fail closed on database errors, and the setup SQL page never drops existing tables. Why: connection failures and repeated setup must not open setup or destroy data.

- User accounts (create/edit/delete, roles) go only through server functions in src/lib/users.functions.ts that re-check the caller's role; profiles/user_roles have no client write policies. Why: mirrors the original Firestore rules without exposing admin writes.
- Usernames map to fake emails `<username>@users.mutabee.app`; no real email is ever sent.
- Payment requests and review use authenticated database RPCs; approved totals are protected by triggers and only a project's active supervisor can approve or reject, so status edits and imports cannot bypass review.
- Payment calculations and month-date rules live in a browser-safe helper and are tested independently; payment fields and review lists are separate UI modules to keep tracker changes focused.
- Prebundle dependencies used by lazy-loaded payment controls in Vite optimizeDeps.include to avoid first-use dependency reoptimization invalidating in-flight module requests.
- Project-wide destructive operations (delete an uploaded file's batch, reset all claims to initial state) go through can_manage-guarded RPCs so triggers protecting approved payments are bypassed safely; direct client deletes would fail on those triggers.
- Claim favorites live in claim_favorites (per user+project+claim); users write only their own rows, can_manage roles read all in their projects. Why: employees get quick access while supervisors keep visibility.
- Claim edits (status, note, follow-up date, data columns) go only through the `save_claim_update` RPC and manual moves through `transfer_claims`; employees cannot update `claims` directly (the guard trigger requires the transaction-local `app.claim_write` marker that only those RPCs and `submit_claim_payment` set). Why: the edit history is written by the `claims_audit` trigger, so it cannot be skipped or forged, and clients have no INSERT on `claim_history`.
- `profiles` / `user_roles` reads go through `can_see_user()`: owner/exec see everyone; a supervisor sees self, owner/exec, people in their projects and anyone assigned a claim in them; an employee sees self. Why: supervisors must not read other projects' staff.
- Re-importing with an ID column merges into the stored `data` (`mergeImportRow` in src/lib/mutabee.ts): file columns overwrite, other columns are kept.
- Managers set a user's password with `resetAppUserPassword` (same permission rule as delete, in src/lib/user-permissions.ts). Passwords are intentionally visible to the manager who sets them so a supervisor can hand them over or sign in as the employee; do not add forced-change or masking without asking.
- Exactly one owner (unique index `one_owner`); first-run setup deletes the auth user again if any later step fails. Turn public email sign-up off in the backend auth settings: users are only ever created by the admin API.
- Reminder "seen" state lives in `reminder_seen` (database), not the browser: the assigned employee opening a due claim clears it for everyone; a manager opening it clears it only for himself.
- Sub-statuses: a status entry in `projects.statuses` with `parent` set is a sub-status; claims store the real (sub) id in `claims.status`. The built-in subs s_partial / s_scheduled / s_discount sit under s_paid and drive the payment fields; custom subs are labels only. `stList` = main statuses only, `stAll` = all, `stOf(c)` returns the main status with display name «main · sub».
- Employees edit only columns listed in `projects.added_columns` (enforced in `save_claim_update`). Coded clients («المكودة») are protected from redistribution by the `claims_coded_guard` trigger; only `transfer_claims` (manual move) may move them.
