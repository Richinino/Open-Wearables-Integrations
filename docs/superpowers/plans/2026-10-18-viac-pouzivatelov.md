# Viac používateľov – implementačný plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vlastné účty na webe Zdravie (registrácia, prihlásenie, spárovanie s Open Wearables, admin panel, prezeranie cudzieho účtu) a owi, ktoré počíta pre viac používateľov aj s Apple Health a Suunto.

**Architecture:** Účty žijú doma v `data/accounts/accounts.db`, ktorú spravuje owi. `owi serve` dostane endpointy pre účty a admina volané len serverom webu (zapisovací token); kontajner `api` stále nemá kľúč k Open Wearables, preto zoznam používateľov OW a ich zdroje dát ukladá do `accounts.db` kontajner `owi` pri každom sync. Dáta každého používateľa sú v `data/users/<ow_user_id>/`, zápisy v `data/zapisy/<ow_user_id>/`. Web nesie v podpísanom cookie id účtu, rolu, verziu relácie a prípadné „prezerám účet X“.

**Tech Stack:** Python 3.13 (stdlib sqlite3, hashlib.scrypt, http.server), uv, pytest, ruff; Next.js 16.4 (`web/`, čítaj `web/AGENTS.md`), vitest, Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-10-18-viac-pouzivatelov-design.md`](../specs/2026-10-18-viac-pouzivatelov-design.md)

## Global Constraints

- Verejné repo: žiadne skutočné zdravotné dáta, e-maily, heslá, tokeny, hostname Funnelu ani ID používateľov v kóde, testoch ani dokumentácii. Nikdy nevypisovať hodnoty z `.env` ani `web/.env.local`.
- Heslá: `hashlib.scrypt`, n=2**14, r=8, p=1, dklen=32, soľ 16 B; uložené ako `scrypt$16384$8$1$<soľ b64>$<hash b64>`. Dĺžka hesla 10–256 znakov. Heslo sa nikde neloguje.
- Prihlásenie: po 5 zlých heslách na e-mail za 15 minút odpoveď 429. Registrácia: najviac 5 za hodinu z jednej IP.
- Relácia: so „Zostať prihlásený“ 30 dní, bez neho cookie bez `maxAge` a platnosť najviac 12 h.
- Odkaz na nové heslo je jednorazový a platí 24 h.
- Upozornenie v inboxe „žiadne nové dáta“ po 24 h.
- Prezeranie cudzieho účtu je len na čítanie; zápis zo Samsungu, nastavenia aj akcie server odmietne s 403.
- Posledný admin nemôže zmazať, pozastaviť ani znížiť rolu sám sebe (409 `last_admin`).
- Kontajner `api`: `data` len na čítanie, na zápis len `data/accounts` a `data/zapisy`. Kontajner `api` nedostane `OWI_API_KEY`.
- SQLite súbory zdieľané kontajnermi: žurnál `DELETE`, krátke transakcie, pri `database is locked` opakovať (vzor `src/owi/entries.py`).
- Texty webu po slovensky, krátke, štýl Nočného panela, svetlý aj tmavý režim, mobil 390 px bez vodorovného posúvania.
- Rozhodnutia [A] dopísať do `docs/skore.md`, správanie do `docs/ako-to-funguje.md`.
- TDD, syntetické dáta (`tests/factories.py`, web `src/lib/test-fixtures.ts`). Príkazy: `C:\Users\richa\.local\bin\uv.exe run pytest -q`, `... ruff check .`, `... ruff format --check .`; web `npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Kontrakty (záväzné pre owi aj web)

**Account (JSON):** `{"id", "email", "first_name", "last_name": str|null, "role": "admin"|"user", "status": "pending"|"active"|"suspended", "paired": bool, "birth_date": "YYYY-MM-DD"|null, "sex": "male"|"female"|null, "training_consent": bool, "settings": {"theme": "system"|"light"|"dark", "sleep_score": "performance"|"apple"|"samsung", "overview_mode": "auto"|"morning"}, "has_samsung": bool, "created_at", "last_login_at": str|null, "session_version": int}`. Heslo ani jeho hash sa nikdy nevracia.

**AccountAdmin:** Account + `{"ow_user_id": str|null, "last_data_at": str|null}`.

**Hlavičky:** zapisovacie endpointy `Authorization: Bearer <OWI_WRITE_TOKEN>`; admin endpointy navyše `X-Owi-Acting: <id účtu admina>` (owi overí rolu a stav `active`, inak 403 `forbidden`); registrácia `X-Owi-Client-Ip: <ip>`.

**Endpointy `owi serve`** (chyby vždy `{"error": "<kód>"}`, pri validácii aj `"fields": {pole: správa}`):

| Metóda a cesta | Token | Telo → odpoveď |
|---|---|---|
| `POST /v1/accounts/register` | write | `{email, first_name, last_name?, password}` → 201 Account; 400; 409 `email_taken`; 429 `too_many_attempts`; 403 `registration_closed` |
| `POST /v1/accounts/login` | write | `{email, password}` → 200 Account; 401 `invalid_credentials`; 403 `suspended`; 429 `too_many_attempts` (+ `retry_after_s`) |
| `GET /v1/accounts/{id}` | write | → Account; 404 |
| `PATCH /v1/accounts/{id}` | write | `{first_name?, last_name?, email?, birth_date?, sex?, training_consent?, settings?}` → Account; 400; 409 `email_taken` |
| `POST /v1/accounts/{id}/password` | write | `{current_password, new_password}` → Account (`session_version`+1); 401 `invalid_credentials` |
| `POST /v1/accounts/{id}/logout-all` | write | → Account (`session_version`+1) |
| `DELETE /v1/accounts/{id}` | write | `{password}` → 204; 401; 409 `last_admin` |
| `POST /v1/password-reset/request` | write | `{email}` → 202 vždy (inbox položka len ak účet existuje) |
| `POST /v1/password-reset/confirm` | write | `{token, new_password}` → 200 Account; 400 `invalid_token` |
| `GET /v1/admin/accounts` | write+acting | → `[AccountAdmin]` (čakajúce prvé) |
| `GET /v1/admin/ow-users` | write+acting | → `[{"id", "label", "paired_account_id": str|null}]` |
| `POST /v1/admin/accounts/{id}/pair` | write+acting | `{ow_user_id}` → AccountAdmin (stav `active`); 409 `ow_user_taken` |
| `POST /v1/admin/accounts/{id}/unpair` | write+acting | → AccountAdmin (stav `pending`) |
| `PATCH /v1/admin/accounts/{id}` | write+acting | `{role?, status?}` → AccountAdmin; 409 `last_admin` |
| `DELETE /v1/admin/accounts/{id}` | write+acting | → 204; 409 `last_admin` |
| `POST /v1/admin/accounts/{id}/reset-link` | write+acting | → `{"token", "expires_at"}` |
| `GET /v1/admin/accounts/{id}/sources` | write+acting | → `{"connections": [{"provider", "status", "last_synced_at"}], "types": [{"type", "provider", "arriving": bool}], "updated_at"}` |
| `GET /v1/admin/inbox?resolved=0` | write+acting | → `[{"id", "kind", "account_id", "message", "created_at", "resolved_at"}]` |
| `POST /v1/admin/inbox/{id}/resolve` | write+acting | → položka |
| `GET /v1/admin/system` | write+acting | → `{"ow_api": "ok"|"down", "ow_version", "ow_latest": str|null, "last_sync_at", "funnel": {"last_event_at", "last_event"}, "registration_open": bool}` |
| `PUT /v1/admin/system` | write+acting | `{registration_open}` → ako GET |
| `GET /v1/days?account=<id>` | read | ako dnes, pre `ow_user_id` účtu; 404 `not_paired` |
| `PUT /v1/entries/{day}?account=<id>` | write | ako dnes, pre zápisy účtu |

Inbox `kind`: `pairing`, `stale_data`, `disconnected`, `funnel`, `ow_update`, `password_reset`.

**Relácia webu (cookie `owi_session`):** `<base64url(JSON claims)>.<base64url(HMAC-SHA256(SESSION_SECRET, claims))>`, claims `{"a": accountId, "r": role, "v": sessionVersion, "x": viewAsAccountId|null, "p": persistent, "e": expiresAtMs}`.

**Namerané a odhadnuté hodnoty v `/v1/days`** (nové kľúče popri doterajších `*_est`, ktoré ostávajú): `distance_m`, `active_kcal`, `total_kcal`, `resting_hr`, `hrv_ms` a ku každému `<kľúč>_source`: `"measured"` | `"estimated"` | `null`.

## Review Focus

1. Pozastavený účet alebo zmenené heslo s otvorenou reláciou na inom zariadení → ďalšia požiadavka na dáta ho odhlási (overenie `status` a `session_version`) – test v Task 9.
2. Admin prezerá účet X a pošle zápis, zmenu nastavení alebo akciu → 403, nič sa nezapíše – testy v Task 9 a Task 12.
3. E-mail s veľkými písmenami alebo medzerami pri registrácii a prihlásení → ten istý účet (normalizácia na malé písmená a orezanie) – test v Task 1.
4. Spárovanie OW používateľa, ktorý už patrí inému účtu → 409, žiadny účet nevidí cudzie dáta – test v Task 4.
5. Migrácia Richardových dát spustená dvakrát alebo po čiastočnom zlyhaní → nič sa neprepíše ani nestratí – test v Task 2.

---

## Fáza A – owi (Python)

### Task 1: Úložisko účtov

**Files:** Create `src/owi/accounts.py`, `tests/test_accounts.py`.

**Interfaces – Produces:**
- `accounts_path(data_dir: Path) -> Path` → `data_dir / "accounts" / "accounts.db"`
- `@dataclass(frozen=True) class Account` s poľami kontraktu Account + `ow_user_id: str | None`, `password_hash: str`
- `class Accounts` (context manager, `Accounts(path)`): `register(email, first_name, last_name, password, ip, now) -> Account`, `login(email, password, now) -> Account`, `get(account_id) -> Account | None`, `update(account_id, changes: Mapping[str, Any]) -> Account`, `change_password(account_id, current, new) -> Account`, `bump_session(account_id) -> Account`, `delete(account_id) -> None`, `pair(account_id, ow_user_id) -> Account`, `unpair(account_id) -> Account`, `set_role_status(account_id, role, status) -> Account`, `paired() -> list[Account]`, `all() -> list[Account]`, `create_reset_token(account_id, now) -> tuple[str, datetime]`, `confirm_reset(token, new_password, now) -> Account`, `request_reset(email, now) -> None`, `inbox_add(kind, account_id, message, key, now) -> None`, `inbox_list(resolved: bool) -> list[InboxItem]`, `inbox_resolve(item_id, now)`, `system_get(key) -> str | None`, `system_set(key, value)`, `ow_users_replace(users: list[OwUser])`, `ow_users() -> list[OwUser]`, `sources_replace(ow_user_id, sources_json: str, now)`, `sources(ow_user_id) -> dict | None`, `last_data_set(ow_user_id, at)`, `last_data(ow_user_id) -> datetime | None`, `deletions_add(ow_user_id, now)`, `deletions_pending() -> list[str]`, `deletions_done(ow_user_id)`
- Výnimky: `AccountError(code: str, fields: dict | None = None, retry_after_s: int | None = None)` s kódmi z kontraktu.
- `hash_password(password: str, salt: bytes | None = None) -> str`, `verify_password(password: str, stored: str) -> bool`

- [ ] **Step 1: Testy** v `tests/test_accounts.py`: `test_register_normalizes_email_and_starts_pending` (e-mail `"  Mama@Email.SK "` → `"mama@email.sk"`, `status == "pending"`, `role == "user"`, `training_consent is True`, settings predvolené `{"theme": "system", "sleep_score": "performance", "overview_mode": "auto"}`); `test_register_rejects_mismatched_rules` (heslo 9 znakov → `AccountError("invalid", fields={"password": ...})`, prázdne meno → fields `first_name`); `test_duplicate_email_is_taken`; `test_login_with_any_case_finds_the_account`; `test_five_failed_logins_lock_the_email_for_15_minutes` (6. pokus → `too_many_attempts`, po 15 min opäť `invalid_credentials`/úspech); `test_sixth_registration_from_one_ip_within_an_hour_is_refused`; `test_password_hash_format_and_verification` (začína `"scrypt$16384$8$1$"`, iné heslo → False); `test_change_password_bumps_session_version`; `test_reset_token_is_single_use_and_expires_after_24_h`; `test_pair_refuses_an_ow_user_of_another_account` (`ow_user_taken`); `test_last_admin_cannot_demote_suspend_or_delete_self`; `test_inbox_key_deduplicates_until_resolved`; `test_suspended_login_is_refused`.
- [ ] **Step 2:** `uv run pytest tests/test_accounts.py -q` → FAIL (modul neexistuje).
- [ ] **Step 3:** Implementácia v `src/owi/accounts.py`. Schéma: tabuľky `accounts`, `login_attempts(email, at)`, `registration_attempts(ip, at)`, `reset_tokens(token_hash PRIMARY KEY, account_id, created_at, expires_at, used_at)` (ukladať len SHA-256 tokenu, token = `secrets.token_urlsafe(32)`), `inbox(id INTEGER PRIMARY KEY, kind, account_id, message, key, created_at, resolved_at)` s jedinečným `key` medzi nevybavenými, `system(key PRIMARY KEY, value)`, `ow_users(id PRIMARY KEY, label, updated_at)`, `sources(ow_user_id PRIMARY KEY, json, updated_at)`, `last_data(ow_user_id PRIMARY KEY, at)`, `deletions(ow_user_id PRIMARY KEY, requested_at)` (fronta priečinkov na zmazanie: `api` ich zmazať nemôže, robí to `owi` v Task 3). Žurnál DELETE a opakovanie pri zamknutí ako v `entries.py`. Prvý registrovaný účet nedostane admina automaticky (admina vytvára Task 8).
- [ ] **Step 4:** testy PASS, ruff čistý.
- [ ] **Step 5:** commit `Accounts store: registration, login, reset links, inbox`.

### Task 2: Priečinky per používateľ a migrácia Richardových dát

**Files:** Modify `src/owi/config.py`, `src/owi/cli.py`; Create `src/owi/users.py`, `tests/test_users.py`; Modify `docker/compose.yml`.

**Interfaces – Produces:**
- `@dataclass(frozen=True) class UserPaths: ow_user_id: str; data_dir: Path` s vlastnosťami `db_path`, `params_path`, `score_weights_path` (v `data/users/<id>/`) a `entries_path` (`data/zapisy/<id>/zapisy.db`)
- `user_paths(data_dir: Path, ow_user_id: str) -> UserPaths`
- `migrate_legacy(data_dir: Path, ow_user_id: str) -> list[str]` – presunie `owi.db`, `params.json`, `score_weights.json` do `data/users/<id>/` a `zapisy/zapisy.db` do `zapisy/<id>/zapisy.db`; vráti zoznam presunutých súborov; ak cieľ existuje, nič neprepíše a vyhodí `FileExistsError`; ak zdroj neexistuje, preskočí ho.
- CLI: `owi users migrate --ow-user <id>` (pred presunom vytvorí kópiu `data/` do `data-backup-<čas>/` vedľa repa, mimo gitu).

- [ ] **Step 1: Testy:** `test_user_paths_layout`; `test_migrate_moves_files_once_and_keeps_contents` (obsah bajtovo rovnaký, druhé spustenie → nič sa nezmení, žiadna výnimka ak už je presunuté a starý súbor chýba); `test_migrate_refuses_to_overwrite_an_existing_target`; `test_migrate_cli_makes_a_backup_first`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementácia; `Settings` dostane `accounts_path`. Compose: `api` mounty `../data:/data:ro`, `../data/accounts:/data/accounts`, `../data/zapisy:/data/zapisy` (odstrániť len-`zapisy` variant). Priečinky vytvárať z kódu, ak chýbajú.
- [ ] **Step 4:** PASS. **Step 5:** commit `Per-user data folders and migration of the existing data`.

### Task 3: Sync pre všetkých spárovaných používateľov

**Files:** Modify `src/owi/cli.py`, `src/owi/tuning.py`; Test `tests/test_cli.py`, `tests/test_tuning.py`.

**Interfaces:** Consumes Task 1 `Accounts.paired()`, Task 2 `user_paths`. Produces `_sync_user(settings, account, paths, days, now)`; profil `Person(age=vek z birth_date k dňu, sex=account.sex)`; bez `birth_date`/`sex` pre účet so starým `OWI_USER_ID` záloha z `.env`.

- [ ] **Step 1: Testy:** `test_sync_runs_for_every_paired_active_account` (dva účty, každý svoj priečinok, pozastavený preskočený); `test_sync_without_accounts_db_keeps_the_single_user_behaviour` (len `OWI_USER_ID`, starý layout po migrácii); `test_age_comes_from_birth_date`; `test_consent_off_skips_tuning_and_uses_defaults` (žiadny `params_history` záznam, `params.json` predvolené); `test_sync_stores_ow_users_sources_and_last_data_in_accounts` (fake klient vráti 2 OW používateľov, pripojenia a typy); `test_sync_deletes_queued_folders_of_unpaired_users` (priečinok `data/users/<id>/` zmizne, spárovaný používateľ s rovnakým ID sa nezmaže a zostane vo fronte).
- [ ] **Step 2:** FAIL. **Step 3:** Implementácia: jeden beh = načítať OW používateľov (`GET /api/v1/users`) do `ow_users` (`label` = meno + e-mail z OW), pre každý spárovaný aktívny účet sync jeho dní, uložiť `last_data` (najnovší `created_at` dát nie je v API – použiť najnovší čas vzorky dňa), `sources` z `GET /api/v1/users/{id}/connections` a `GET /api/v1/users/{id}/summaries/data` (typ „arriving“ = má záznam za posledných 7 dní; ak `summaries/data` neposkytuje čas, použiť `timeseries` pre zoznam typov za 7 dní). Klient dostane metódy `users()`, `connections(user_id)`, `data_summary(user_id)`.
- [ ] **Step 4:** PASS. **Step 5:** commit `Sync every paired account into its own folder`.

### Task 4: Endpointy účtov a admina v `owi serve`

**Files:** Modify `src/owi/serve.py`, `src/owi/cli.py` (`_cmd_serve`); Create `tests/test_serve_accounts.py`.

**Interfaces:** Consumes Task 1, Task 2. Produces endpointy z kontraktu. `respond(...)` dostane `accounts_path` a `data_dir`; `/v1/days` a `/v1/entries` berú `account` z query a nájdu `UserPaths`; bez `account` a bez `accounts.db` správanie ako dnes (kompatibilita kým web nie je nasadený).

- [ ] **Step 1: Testy** (cez `respond`, ako `tests/test_serve.py`): `test_register_login_and_me_round_trip`; `test_account_json_never_contains_the_password_hash`; `test_admin_endpoints_need_an_active_admin_acting_header` (bez hlavičky, user, pozastavený admin → 403); `test_pair_conflict_is_409`; `test_days_for_a_pending_account_is_404_not_paired`; `test_days_for_account_reads_its_own_folder` (dva účty, každý dostane svoje dni); `test_entries_go_to_the_accounts_folder`; `test_reset_request_always_answers_202_and_adds_inbox_only_for_known_email`; `test_registration_closed_is_403`; `test_system_reports_registration_and_last_sync`; `test_deleting_an_account_removes_its_entries_and_queues_its_folder` (zápisy v `data/zapisy/<id>/` zmazané hneď, `ow_user_id` vo fronte `deletions`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementácia; telo JSON max 4 KB ako dnes; `X-Owi-Client-Ip` pre registráciu; všetky chyby `AccountError` → status podľa kódu (`invalid` 400, `invalid_credentials` 401, `forbidden`/`suspended`/`registration_closed` 403, `not_found` 404, `email_taken`/`ow_user_taken`/`last_admin` 409, `too_many_attempts` 429).
- [ ] **Step 4:** PASS. **Step 5:** commit `owi serve: accounts, admin and per-account data`.

### Task 5: Inbox a stav systému

**Files:** Create `src/owi/inbox.py`, `tests/test_inbox.py`; Modify `src/owi/cli.py` (volanie po každom sync).

**Interfaces:** Produces `refresh_inbox(accounts: Accounts, data_dir: Path, ow_version: str | None, ow_latest: str | None, now: datetime) -> None`; `latest_ow_release(http) -> str | None` (GitHub `GET https://api.github.com/repos/the-momentum/open-wearables/releases/latest`, `tag_name`, raz za 24 h, výsledok v `system`); bežiaca verzia OW z jeho API (staviteľ nájde endpoint, napr. `/api/v1/meta` alebo hlavička; ak nejde, `null`).

- [ ] **Step 1: Testy:** `test_pending_account_adds_one_pairing_item`; `test_no_data_for_24_hours_adds_stale_item_and_new_data_does_not_repeat_it`; `test_inactive_connection_adds_disconnected_item`; `test_watchdog_reconnect_line_adds_funnel_item_once` (riadok `"... Tailscale reconnected"` z `data/funnel-watchdog.log`); `test_newer_ow_release_adds_update_item`; `test_github_failure_is_silent`.
- [ ] **Step 2–4** ako vyššie. **Step 5:** commit `Admin inbox from sync: pairing, stale data, sources, Funnel, updates`.

### Task 6: Namerané pred odhadom

**Files:** Modify `src/owi/models.py`, `src/owi/pipeline.py`, `src/owi/client.py`, `src/owi/serve.py`; Test `tests/test_pipeline.py`, `tests/test_serve.py`, `tests/test_client.py`.

**Interfaces:** Produces `DayResult` polia `distance_m`, `active_kcal`, `total_kcal`, `resting_hr_measured`, `hrv_ms` a `*_source`; API kľúče z kontraktu. Doterajšie `*_est` sa počítajú ďalej (dolaďovanie ich potrebuje).

- [ ] **Step 1: Testy:** `test_device_distance_wins_over_the_stride_estimate` (`distance_m_source == "measured"`); `test_without_device_distance_the_estimate_fills_in` (`"estimated"`); `test_device_active_energy_wins_and_total_adds_basal` (aktívne zo zariadenia + bazál; ak zariadenie pošle `total_energy`, použije sa to); `test_device_resting_heart_rate_is_reported_separately`; `test_nightly_hrv_rmssd_or_sdnn_is_reported`; `test_no_value_at_all_is_null_with_null_source`; `test_client_fetches_resting_hr_and_hrv_series`.
- [ ] **Step 2–4.** Zdroj hodnôt: súčty sérií `distance_walking_running`, `active_energy`, `total_energy`, `basal_energy`, posledný `resting_heart_rate` dňa, nočný priemer `heart_rate_variability_rmssd` (inak `_sdnn`, s poznámkou typu); pri viacerých zdrojoch rovnaké poradie ako Task 7.
- [ ] **Step 5:** commit `Measured values before estimates`.

### Task 7: Apple Health, Suunto a HRV v Readiness

**Files:** Modify `src/owi/models.py` (poradie zdrojov), `src/owi/sleep.py`, `src/owi/workouts.py`, `src/owi/steps.py`, `src/owi/features.py`, `src/owi/readiness.py`, `src/owi/serve.py` (`has_samsung`); Test príslušné `tests/test_*.py`; Docs `docs/skore.md`.

**Interfaces:** Produces `source_rank(source) -> int` (nižšie = lepšie): `health_connect` 0, `samsung` 1, `apple` 2, `suunto` 3, ostatné 5; v rámci providera hodinky pred telefónom (`device_type == "watch"`). `readiness` dostane zložku `hrv_balance` s váhou 0,12 (ostatné váhy prenormované), krivka `resting_hr_score(-z)` z HRV oproti 60-dňovému priemeru; bez HRV ostáva poznámka `estimate` a správanie ako dnes.

- [ ] **Step 1: Testy:** `test_apple_sleep_session_with_stages_is_the_main_sleep`; `test_watch_session_beats_phone_session_of_the_same_night`; `test_suunto_workout_dedupes_with_the_same_workout_from_apple`; `test_samsung_rules_do_not_touch_apple_or_suunto_data` (automatické zápisy a `samsung_health_total` len pre Samsung zdroje); `test_without_minute_heart_rate_strain_and_zones_are_null_not_zero`; `test_readiness_with_hrv_uses_hrv_balance_and_drops_estimate_note`; `test_readiness_without_hrv_is_unchanged`; `test_has_samsung_is_true_for_any_samsung_source`.
- [ ] **Step 2–4.** Tvary dát Apple/Suunto podľa OW dokumentácie (`C:\Users\richa\open-wearables\docs\providers\`), mená providerov `apple`, `suunto`; v `docs/skore.md` doplniť HRV zložku ako [A].
- [ ] **Step 5:** commit `Apple Health, Suunto and HRV in Readiness`.

### Task 8: Admin z príkazového riadka

**Files:** Modify `src/owi/cli.py`; Test `tests/test_cli.py`.

**Interfaces:** `owi accounts create-admin --email E --first-name M --ow-user ID` vytvorí aktívny účet s rolou admin spárovaný s ID a náhodným heslom, ktoré nikto nepozná, a vypíše len token na nové heslo (web z neho poskladá `/nove-heslo/<token>`); `owi accounts list` vypíše e-mail, rolu, stav, spárovanie (bez hesla).

- [ ] **Step 1: Testy:** `test_create_admin_prints_only_a_reset_token`; `test_create_admin_refuses_a_taken_email_or_ow_user`; `test_accounts_list_has_no_password_data`.
- [ ] **Step 2–4.** **Step 5:** commit `CLI: create the admin account and list accounts`.

## Fáza B – web (Next.js), paralelne s Fázou A podľa kontraktov

### Task 9: Relácia v2 a ochrana stránok

**Files:** Modify `web/src/lib/session.ts`, `web/src/lib/auth.ts`, `web/src/proxy.ts`; Create `web/src/lib/owi-accounts.ts`; Tests `web/src/lib/session.test.ts`, `web/src/lib/auth.test.ts`, `web/src/proxy.test.ts`.

**Interfaces – Produces:** `type SessionClaims = { a: string; r: "admin" | "user"; v: number; x: string | null; p: boolean; e: number }`; `createSessionToken(secret, claims: Omit<SessionClaims, "e">, now, lifetimeMs) -> Promise<string>`; `verifySessionToken(secret, token, now) -> Promise<SessionClaims | null>`; `currentSession() -> Promise<{ account: Account; claims: SessionClaims } | null>` (overí `status === "active"` alebo `"pending"`, `session_version === claims.v` cez `GET /v1/accounts/{id}`; inak zmaže cookie a vráti null); `dataAccountId(claims) = claims.x ?? claims.a`; `assertWritable(claims)` hodí 403 pri `claims.x`. `owi-accounts.ts`: typované volania všetkých endpointov z kontraktu so zapisovacím tokenom, `X-Owi-Acting`, `X-Owi-Client-Ip` (z `x-forwarded-for`), timeout 10 s, žiadne logovanie tela, URL ani tokenu.

- [ ] **Step 1: Testy:** `createSessionToken`/`verify` round trip s claims; pozmenené claims → null; expirácia; `proxy` pustí bez relácie len `/login`, `/registracia`, `/zabudnute-heslo`, `/nove-heslo/*` a statické súbory; `pending` účet presmeruje na `/cakanie` (okrem `/ucet` a odhlásenia); `currentSession` s inou `session_version` alebo `suspended` → null a zmazané cookie; `assertWritable` s `x` → 403.
- [ ] **Step 2–4.** `SITE_PASSWORD` sa prestane používať (odstrániť z kódu a `.env.example`).
- [ ] **Step 5:** commit `Web sessions carry the account, role and view-as`.

### Task 10: Prihlásenie, registrácia, čakanie, zabudnuté a nové heslo

**Files:** Modify `web/src/app/login/*`; Create `web/src/app/registracia/*`, `web/src/app/cakanie/page.tsx`, `web/src/app/zabudnute-heslo/*`, `web/src/app/nove-heslo/[token]/*`, `web/src/lib/account-forms.ts` (+ test).

**Interfaces:** Consumes Task 9. Server actions volajú `owi-accounts.ts`; formuláre podľa schváleného náčrtu: prihlásenie (e-mail, heslo, „Zostať prihlásený“, odkazy „Zaregistruj sa“, „Zabudnuté heslo“); registrácia (meno, priezvisko (nepovinné), e-mail, heslo, heslo znova); čakanie („Účet je vytvorený. Čaká sa na spárovanie účtu.“ + odhlásiť); zabudnuté heslo (e-mail → vždy „Ak účet existuje, admin dostal žiadosť o nové heslo.“); nové heslo (dvakrát, po úspechu prihlásenie).

- [ ] **Step 1: Testy** `account-forms.test.ts`: zhoda hesiel, dĺžka 10–256, e-mail formát, mapovanie chýb owi (`email_taken` → „Tento e-mail už má účet.“, `too_many_attempts` → „Priveľa pokusov, skús to o 15 minút.“, `registration_closed`, `invalid_token`).
- [ ] **Step 2–4.** Screenshoty 390/1280, svetlý/tmavý (demo režim). **Step 5:** commit `Login, registration, waiting and password pages`.

### Task 11: Ikonka účtu, Nastavenia účtu a Nastavenia

**Files:** Modify `web/src/components/shell/shell.tsx`, `web/src/components/shell/nav.ts`; Create `web/src/components/shell/account-menu.tsx`, `web/src/app/(app)/ucet/*`, `web/src/app/(app)/nastavenia/*`; tests k logike menu a formulárom.

**Interfaces:** Menu: Nastavenia účtu (`/ucet`), Nastavenia (`/nastavenia`), Prepnúť účet (len admin, zoznam aktívnych účtov → nastaví `x`), Admin panel (len admin, `/admin`), Odhlásiť sa. `/ucet`: meno, priezvisko, e-mail, dátum narodenia, pohlavie, súhlas s trénovaním, zmena hesla, odhlásenie všade, zmazanie účtu (heslom). `/nastavenia`: vzhľad, predvolené skóre spánku, režim prehľadu – uloží `settings` a web ich použije (prepínač témy a skóre spánku čítajú najprv `settings`, `localStorage` len ako rýchla kópia). Stránka Zápis v menu len pri `has_samsung`.

- [ ] **Step 1: Testy:** položky menu pre admina vs používateľa; `/ucet` server action odmietne pri prezeraní (403); nastavenia sa premietnu do predvoleného skóre spánku; Zápis skrytý bez `has_samsung`.
- [ ] **Step 2–4.** **Step 5:** commit `Account menu, account settings and settings`.

### Task 12: Admin panel a prezeranie cudzieho účtu

**Files:** Create `web/src/app/(app)/admin/*`, `web/src/components/admin/*`, `web/src/components/shell/view-as-banner.tsx`; Modify `web/src/app/api/data/route.ts`, `web/src/app/api/entries/[date]/route.ts`.

**Interfaces:** `/admin`: karty Inbox (nevybavené, „Vybavené“), Účty (čakajúce prvé; detail: údaje bez hesla, posledné prihlásenie a dáta, zdroje a typy dát „chodia / nechodia“, akcie Spárovať (výber z `ow-users`, upozornenie „Spáruj len účet, o ktorom vieš, že patrí tomuto človeku“), Zrušiť spárovanie, Zobraziť jeho stránku, Odkaz na nové heslo (zobrazí URL `/nove-heslo/<token>` s tlačidlom Kopírovať), Rola, Pozastaviť, Zmazať (potvrdenie)), Systém (stav, prepínač registrácie). Prezeranie: „Zobraziť jeho stránku“ nastaví `x` a presmeruje na `/`; pruh „Prezeráš účet <meno> · Späť na môj účet“ na každej stránke; `/api/data` číta `dataAccountId(claims)`; zápisy a akcie pri `x` → 403 a tlačidlá skryté.

- [ ] **Step 1: Testy:** route `/api/data` posiela `account=x` pri prezeraní; `/api/entries` pri `x` → 403 bez volania owi; bežný používateľ na `/admin` → presmerovanie/403; párovanie mapuje `ow_user_taken` na „Tento používateľ Open Wearables už patrí inému účtu.“.
- [ ] **Step 2–4.** Screenshoty s demo dátami (demo režim dostane 3 účty, inbox a zdroje). **Step 5:** commit `Admin panel and viewing another account`.

### Task 13: Namerané vs odhadnuté, HRV a lokálny prístup pre kontrolu

**Files:** Modify `web/src/lib/types.ts`, komponenty s ≈ (aktivita, kroky, deň, prehľad), `web/src/components/detail/readiness/*`; Create `web/src/lib/dev-view.ts`.

**Interfaces:** ≈ len pri `*_source === "estimated"`; Readiness s HRV bez označenia „odhad“ a so zložkou HRV; `dev-view.ts`: len pri `NODE_ENV === "development"` a požiadavke z `localhost` umožní `?ucet=<id>` zobraziť dáta účtu bez prihlásenia (pre kontrolu Claude na Richardov pokyn); v produkcii kód nič nerobí.

- [ ] **Step 1: Testy:** ≈ podľa zdroja; `dev-view` v produkcii vždy null, v dev len z `localhost`.
- [ ] **Step 2–4.** **Step 5:** commit `Measured values without the estimate mark; local check view`.

## Fáza C – integrácia (koordinátor)

### Task 14: Prechod na skutočných dátach a nasadenie

- [ ] Záloha celého `data/` mimo repa.
- [ ] `owi users migrate --ow-user <Richardov OWI_USER_ID>`; overiť, že `/v1/days?account=` po vytvorení admina vracia rovnaké dni ako predtým (počet dní, posledný deň, skóre posledného dňa).
- [ ] `owi accounts create-admin` pre Richarda; odkaz na nové heslo mu dať do chatu (token sa nikde inde neukladá).
- [ ] Rebuild kontajnerov owi, kontrola mountov (`api`: `/data` ro, `/data/accounts` a `/data/zapisy` rw).
- [ ] Vercel: `SITE_PASSWORD` už nepotrebný (odstrániť až po overení prihlásenia novým účtom).
- [ ] Push → nasadenie; overiť: prihlásenie, prezeranie (s dočasným testovacím účtom, ktorý sa potom zmaže), admin panel, odhlásenie; bez relácie 307/401 ako dnes.
- [ ] Commit dokumentácie (`docs/ako-to-funguje.md`: účty, admin, prechod).
