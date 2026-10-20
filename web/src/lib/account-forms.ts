export function accountErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : "unavailable";
  const messages: Record<string, string> = {
    invalid: "Skontroluj vyplnené údaje.", invalid_credentials: "Nesprávny e-mail alebo heslo.",
    email_taken: "Tento e-mail sa už používa.", registration_closed: "Registrácia je momentálne zatvorená.",
    rate_limited: "Priveľa pokusov. Skús to znova neskôr.", too_many_attempts: "Priveľa pokusov. Skús to znova neskôr.",
    suspended: "Tento účet je pozastavený. Kontaktuj správcu.", invalid_token: "Odkaz na nové heslo je neplatný alebo už vypršal.",
    not_found: "Účet sa nenašiel.", forbidden: "Na túto akciu nemáš oprávnenie.", read_only: "Pri prezeraní cudzieho účtu sa nedá zapisovať.",
    last_admin: "Posledný správca musí zostať aktívny.",
  };
  return typeof code === "string" && messages[code] || "Služba je dočasne nedostupná. Skús to znova neskôr.";
}
