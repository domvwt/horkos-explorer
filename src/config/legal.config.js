// Deploy-time legal / operator identity for the Art. 14 privacy notice and the
// per-result disclaimer.
//
// This is the SINGLE place to complete the values marked [SET AT DEPLOY] before
// public launch. A CommonJS module (not the ESM Constants.js) so it can be the
// one source of truth for both the app bundle and the build-time guard in
// vue.config.js, which is CommonJS and cannot require() an ESM module.
//
// A plain constant is used deliberately rather than VUE_APP_* env vars: env vars
// are inlined into the client bundle in plaintext, so they hide nothing over a
// constant. The contact address's privacy comes from it being a dedicated inbox.
//
// A PRODUCTION build hard-fails (see validateLegalConfig) if any value below is
// still an unfilled [SET AT DEPLOY] placeholder or the contact email is malformed,
// so a broken/incomplete legal notice can never be shipped to the public.

const LEGAL = {
  SERVICE_NAME: "horkos",
  // Controller identity (Art. 14(1)(a)) — a real, nameable legal person.
  OPERATOR_NAME: "Dominic Thorn",
  // Contact for data-subject requests / error reports / the child-guardian route.
  CONTACT_EMAIL: "horkos.data@gmail.com",
  HOSTING_PROVIDER: "[SET AT DEPLOY — hosting provider]",
  HOSTING_REGION: "[SET AT DEPLOY — hosting region + international-transfer basis if outside the UK]",
  EFFECTIVE_DATE: "[SET AT DEPLOY — effective date]",
  LAST_REVIEWED: "June 2026",
  REFRESH_CADENCE: "[SET AT DEPLOY — refresh cadence, e.g. monthly]",
  ICO_URL: "https://ico.org.uk",
  COMPANIES_HOUSE_URL: "https://www.gov.uk/government/organisations/companies-house",
};

// Every LEGAL key that must hold a real value before the notice may go live,
// paired with its Art. 14 basis (surfaced in the failure message so the operator
// knows exactly what to complete).
const REQUIRED_FOR_DEPLOY = [
  ["OPERATOR_NAME", "controller identity — Art. 14(1)(a)"],
  ["CONTACT_EMAIL", "contact for data-subject requests — Art. 14(1)(a)/(b)"],
  ["HOSTING_PROVIDER", "recipient / processor — Art. 14(1)(e)"],
  ["HOSTING_REGION", "international transfers, if any — Art. 14(1)(f)"],
  ["EFFECTIVE_DATE", "effective date of the notice"],
  ["REFRESH_CADENCE", "retention / currency — Art. 14(2)(a)"],
];

const PLACEHOLDER_SENTINEL = "[SET AT DEPLOY";
// Deliberately conservative — just enough to catch an obviously unfilled/invalid
// address; not a full RFC 5322 validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Return the list of legal-config problems that must block a production deploy.
 * Empty array means the config is complete and the notice is safe to ship.
 * Pure (no throw / no process access) so it is unit-testable.
 */
function findLegalConfigProblems(legal = LEGAL) {
  const problems = [];
  for (const [key, basis] of REQUIRED_FOR_DEPLOY) {
    const value = legal[key];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`${key} is empty (${basis})`);
      continue;
    }
    if (value.includes(PLACEHOLDER_SENTINEL)) {
      problems.push(`${key} still holds the [SET AT DEPLOY] placeholder (${basis})`);
    }
  }
  if (
    typeof legal.CONTACT_EMAIL === "string" &&
    !legal.CONTACT_EMAIL.includes(PLACEHOLDER_SENTINEL) &&
    !EMAIL_RE.test(legal.CONTACT_EMAIL.trim())
  ) {
    problems.push(`CONTACT_EMAIL "${legal.CONTACT_EMAIL}" is not a valid email address`);
  }
  return problems;
}

/**
 * Hard-fail a production build if the legal notice is incomplete. Intended to be
 * called from vue.config.js ONLY when NODE_ENV === 'production'. Throws with a
 * message listing every unfilled value; a dev build/serve never calls this.
 */
function assertLegalConfigDeployable(legal = LEGAL) {
  const problems = findLegalConfigProblems(legal);
  if (problems.length > 0) {
    throw new Error(
      "Refusing to build: the Art. 14 privacy notice has unfilled deploy values.\n" +
        "Complete these in src/config/legal.config.js before a production build:\n" +
        problems.map((p) => `  - ${p}`).join("\n") + "\n"
    );
  }
}

module.exports = {
  LEGAL,
  findLegalConfigProblems,
  assertLegalConfigDeployable,
};
