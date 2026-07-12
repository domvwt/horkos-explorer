// Deploy-time legal / operator identity for the Art. 14 privacy notice and the
// per-result disclaimer.
//
// The deploy values are supplied at BUILD TIME via VUE_APP_LEGAL_* environment
// variables (for releases: GitHub Actions repository variables wired into the
// build step of build-and-deploy.yml). They are displayed publicly on the
// deployed notice — that is the notice's legal function — but they are kept
// out of the repo source so personal/operator details never live in the
// public repository. Each read below must stay a STATIC
// `process.env.VUE_APP_LEGAL_*` member expression: webpack's DefinePlugin
// only inlines the value into the client bundle for static access, and the
// same expression reads the real environment when vue.config.js requires
// this module in Node for the build-time guard. A CommonJS module (not the
// ESM Constants.js) so it can serve both.
//
// A PRODUCTION build hard-fails (see validateLegalConfig) if any value below
// resolves to an unfilled [SET AT DEPLOY] placeholder or the contact email is
// malformed, so a broken/incomplete legal notice can never be shipped.

const LEGAL = {
  SERVICE_NAME: "horkos",
  // Controller identity (Art. 14(1)(a)) — a real, nameable legal person.
  OPERATOR_NAME:
    process.env.VUE_APP_LEGAL_OPERATOR_NAME ||
    "[SET AT DEPLOY — operator name]",
  // Contact for data-subject requests / error reports / the child-guardian route.
  CONTACT_EMAIL:
    process.env.VUE_APP_LEGAL_CONTACT_EMAIL ||
    "[SET AT DEPLOY — contact email]",
  HOSTING_PROVIDER:
    process.env.VUE_APP_LEGAL_HOSTING_PROVIDER ||
    "[SET AT DEPLOY — hosting provider]",
  HOSTING_REGION:
    process.env.VUE_APP_LEGAL_HOSTING_REGION ||
    "[SET AT DEPLOY — hosting region + international-transfer basis if outside the UK]",
  EFFECTIVE_DATE:
    process.env.VUE_APP_LEGAL_EFFECTIVE_DATE ||
    "[SET AT DEPLOY — effective date]",
  LAST_REVIEWED: process.env.VUE_APP_LEGAL_LAST_REVIEWED || "June 2026",
  REFRESH_CADENCE:
    process.env.VUE_APP_LEGAL_REFRESH_CADENCE ||
    "[SET AT DEPLOY — refresh cadence, e.g. monthly]",
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
