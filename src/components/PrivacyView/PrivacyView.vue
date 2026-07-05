<template>
  <div
    class="privacy-view"
    @click.self="$emit('dismiss')"
  >
    <button
      type="button"
      class="btn-close privacy-view__close"
      aria-label="Close"
      @click="$emit('dismiss')"
    >
      <i class="fa-solid fa-times" />
    </button>
    <div class="privacy-view__content">
      <h1>Privacy &amp; Data Notice — {{ legal.SERVICE_NAME }}</h1>
      <p class="privacy-view__meta">
        <strong>Effective date:</strong> {{ legal.EFFECTIVE_DATE }} ·
        <strong>Last reviewed:</strong> {{ legal.LAST_REVIEWED }}
      </p>

      <hr>

      <section>
        <h2>1. What this service is — and where the information comes from</h2>
        <p>
          {{ legal.SERVICE_NAME }} re-publishes public information from
          <strong>UK Companies House</strong> and the
          <strong>Register of People with Significant Control (PSC register)</strong>
          as a searchable, navigable graph of companies, the people connected to them, and
          registered addresses. It exists to support public-interest corporate transparency,
          investigative journalism, and academic research.
        </p>
        <p>
          <strong>We are not the author of this information.</strong> We did not create the
          underlying facts and we do not independently verify them. We aim to be an accurate
          reflection of those official public sources. Where the source registers are wrong,
          incomplete, or out of date, our copy will reflect that.
        </p>
        <p>
          <strong>Please treat what you see as a starting point, not a settled fact.</strong>
          Records are grouped into entities by an automated matching process, and many people
          and companies share the same or similar names — so this matching can be wrong. The
          control type and ownership band we show are our own interpretation of the register's
          nature-of-control text and may be misread. The data also reflects the source register
          only as at our last refresh. Always confirm anything you rely on against the underlying
          Companies House or PSC filing.
        </p>
      </section>

      <section>
        <h2>2. Accuracy &amp; uncertainty — please read before relying on anything here</h2>
        <ul>
          <li>
            <strong>We make no guarantee of accuracy or completeness.</strong> The data is shown
            as published by the source registers at a point in time and may be incomplete,
            superseded, or changed since.
          </li>
          <li>
            <strong>Entities are linked by a probabilistic matching process.</strong> We group
            together records that <em>appear</em> to describe the same real-world person, company,
            or address. This matching can be wrong — two different people can be merged, or one
            person split across entries.
          </li>
          <li>
            <strong>Many people and companies share the same or similar names.</strong> Where our
            matching is uncertain we show a confidence indicator and alternative possible matches.
            Always confirm an identity against the underlying source filing, registered address,
            or other identifiers before relying on it.
          </li>
          <li>
            We show, for every entity, the source records it was built from, so you can trace each
            fact back to the originating Companies House or PSC filing.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Why we publish this — our lawful basis</h2>
        <p>
          We process this personal data on the basis of our <strong>legitimate interests</strong>
          under <strong>Article 6(1)(f) of the UK GDPR</strong>: enabling transparency of corporate
          ownership and control, supporting accountability, and providing a research and journalism
          aid. We have assessed that these interests are not overridden by the rights and freedoms of
          the individuals concerned, taking into account that this information is published by the
          source registers specifically for transparency purposes.
        </p>
        <p>
          Where we process personal data with a view to publication of journalistic, academic or
          research material that we reasonably believe is in the public interest, we additionally
          rely on the <strong>special-purposes provisions of the Data Protection Act 2018
            (Schedule 2, Part 5)</strong>. We believe that publishing this data is in the public
          interest.
        </p>
      </section>

      <section>
        <h2>4. What data we hold, where it comes from, and how long we keep it</h2>
        <ul>
          <li>
            <strong>Source:</strong> UK Companies House and the PSC register — both publicly
            accessible official registers.
          </li>
          <li>
            <strong>Categories of personal data:</strong> names; month and year of birth (we do
            <strong>not</strong> hold or publish the day of birth); nationality; country of
            residence; addresses as published by the source register; and the ownership / control
            relationships recorded in the registers.
          </li>
          <li>
            <strong>Recipients:</strong> the information is openly accessible to the public.
            Technical hosting is provided by {{ legal.HOSTING_PROVIDER }} ({{ legal.HOSTING_REGION }}).
          </li>
          <li>
            <strong>Retention &amp; currency:</strong> we aim to reflect the source registers and
            refresh our copy approximately {{ legal.REFRESH_CADENCE }}. Between refreshes our copy
            may lag the source — so a record corrected or removed at Companies House persists with
            us until the next refresh. If you need a correction reflected urgently (for example a
            fraudulently-filed entry you have had removed), contact us (§8) and we can temporarily
            remove the affected entry in the meantime.
          </li>
          <li>
            <strong>Automated processing:</strong> we use automated matching to group records into
            entities. We do <strong>not</strong> consider this to be an automated decision that
            produces a legal or similarly significant effect on you — it is a data-organisation
            step, not a decision <em>about</em> you — and we show its uncertainty (§2). If you
            believe an automated grouping has significantly affected you, contact us (§8).
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Your rights</h2>
        <p>
          You have the right to: <strong>access</strong> the personal data we hold about you; ask
          us to <strong>rectify</strong> or <strong>erase</strong> it, or <strong>restrict</strong>
          its processing; and <strong>object</strong> to our processing of it (including by
          exercising your right to object under Article 21). You also have the right to lodge a
          complaint with the UK supervisory authority, the
          <strong>Information Commissioner's Office (ICO)</strong> —
          <a
            :href="legal.ICO_URL"
            target="_blank"
            rel="noopener noreferrer"
          >ico.org.uk</a>.
        </p>
        <p>
          Because we publish this information in the public interest, and because some of it is
          processed for journalism, academic or research purposes, we may decline a request where
          the law allows us to — for example, where complying would undermine a publication we
          reasonably believe is in the public interest, or where the request concerns the data of
          other people. We will always explain our decision.
        </p>
      </section>

      <section>
        <h2>6. Correcting or removing data — two routes</h2>
        <p>There are two different "this is wrong" situations, and they are handled differently:</p>
        <p>
          <strong>(a) The underlying register information is wrong</strong> (e.g. an incorrect date
          of birth or address on a Companies House / PSC filing). We cannot change the official
          register, and changing only our copy would make us <em>less</em> accurate. Please correct
          it at source with
          <a
            :href="legal.COMPANIES_HOUSE_URL"
            target="_blank"
            rel="noopener noreferrer"
          >Companies House</a>. Once the register is updated or the information is suppressed, our
          copy will reflect that change after our next refresh.
        </p>
        <p>
          <strong>(b) The register is correct, but we have linked or merged the wrong records</strong>
          (a false match — e.g. two different people shown as one). This one is ours to fix. Please
          tell us (§8) and we will review the cluster and, where appropriate, split it or correct
          the link.
        </p>
      </section>

      <section>
        <h2>7. Personal safety</h2>
        <p>
          If you are at risk of violence or intimidation, Companies House operates a protection
          regime that can suppress your information from the public register. Because the
          information would otherwise remain public at source, the most effective step is to apply
          to Companies House for protection (gov.uk — "Restricting the disclosure of your
          information"). Tell us as well: we will mirror that suppression promptly and can
          temporarily remove the relevant entry from this service while the source register is
          updated.
        </p>
        <p>
          <strong>Please be aware of an important limitation.</strong> Suppressing your own entry
          does <strong>not</strong> necessarily remove all information that could help locate or
          identify you. Because this is a connected graph, details about you may still be inferable
          from records that are <strong>not</strong> yours and remain public — for example a company
          you control, people connected to it, or an address shared with others. If you have a
          safety concern, contact us (§8) and describe it specifically, so we can consider what more
          can reasonably be done — but we cannot guarantee that removing your own record removes
          every trace, since the connected public records are outside our control. For comprehensive
          protection, raising the matter with Companies House (and, where relevant, the police) is
          essential.
        </p>
      </section>

      <section>
        <h2>8. Contact</h2>
        <p>
          You can reach us at <strong>{{ legal.CONTACT_EMAIL }}</strong>. Use whichever of the
          links below matches your request — each opens a message with the right subject:
        </p>
        <ul>
          <li>
            <a :href="mailto('Data-subject / personal-safety request')">Make a data-subject or
              personal-safety request</a> (access / rectification / erasure / objection).
          </li>
          <li>
            <a :href="mailto('Error / wrong-match report')">Report an error or a wrong match</a>.
          </li>
          <li>
            <a :href="mailto('Child / guardian request')">Contact us about a child's records</a> —
            if the records concern a child (for example a young company director), the child or their
            parent / guardian / representative can contact us and we will treat the request as a
            priority.
          </li>
        </ul>
        <p>
          We aim to acknowledge requests promptly. Please include enough detail for us to find the
          records (for a removal/objection request: the relevant page links, your relationship to
          the company, and the reasons); we may need to ask for more information to deal with your
          request. The controller for this service is <strong>{{ legal.OPERATOR_NAME }}</strong>.
        </p>
      </section>

      <section>
        <h2>9. When you use this service (visitor data)</h2>
        <p>
          Separately from the register data above, when you <em>use</em> this website we briefly
          process your <strong>IP address</strong> to apply rate limits and protect the service
          from abuse. Our basis for this is our legitimate interest in keeping the service secure
          and available. We do not use it to track or profile you, we do not sell it, and we keep
          it only as long as needed for that purpose. We do not currently run analytics or require
          an account. (If an account or analytics is later added, this section and our basis will
          be updated.)
        </p>
      </section>

      <section>
        <h2>10. Cookies &amp; local storage</h2>
        <p>
          This service stores your <strong>display settings</strong> (such as your theme preference)
          in your browser's cookies and local storage so the interface remembers your preferences.
          These are stored <strong>on your device only</strong>, are <strong>not</strong> used to
          track you, and are not shared. We do not set non-essential or advertising cookies and we
          do not run analytics. (If analytics or other non-essential storage is added, this section
          will be updated and consent obtained as required by PECR.)
        </p>
      </section>
    </div>
  </div>
</template>

<script>
import { LEGAL } from "../../utils/Constants";

export default {
  name: "PrivacyView",
  props: {
    // Whether the panel is currently shown. The parent keeps this mounted with
    // v-show, so the document-level Esc handler must ignore keystrokes while hidden.
    visible: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["dismiss"],
  data() {
    return {
      legal: LEGAL,
    };
  },
  mounted() {
    document.addEventListener("keydown", this.handleKeyDown);
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this.handleKeyDown);
  },
  methods: {
    // Dismiss on Esc so the panel is keyboard-reachable (click-away is mouse-only).
    // The listener lives on document for the whole session (v-show keeps us mounted),
    // so ignore Esc unless the panel is actually visible.
    handleKeyDown(event) {
      if (!this.visible) return;
      if (event.key === "Escape" || event.key === "Esc") {
        this.$emit("dismiss");
      }
    },
    // Build a mailto: to the single contact inbox, with a per-route subject so
    // one inbox can triage data-subject / error-report / child-guardian requests.
    mailto(subject) {
      return `mailto:${this.legal.CONTACT_EMAIL}?subject=${encodeURIComponent(
        `[${this.legal.SERVICE_NAME}] ${subject}`
      )}`;
    },
  },
};
</script>

<style lang="scss" scoped>
.privacy-view {
  position: relative;
  height: 100%;
  overflow-y: auto;
  padding: 2rem 1rem;
  color: var(--bs-body-text);

  &__content {
    max-width: 52rem;
    margin: 0 auto;
  }

  // Explicit dismiss affordance. Sticky so it stays reachable while the panel
  // scrolls (on narrow viewports the top click-away gutter scrolls away).
  &__close {
    position: sticky;
    top: 0;
    float: right;
    z-index: 1;
    margin: -1rem -0.5rem 0 0;
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    transition: background-color 0.2s, color 0.2s;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      color: var(--bs-body-text);
    }

    i {
      font-size: 1.25rem;
    }
  }

  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 0.75rem;
  }

  &__meta {
    color: var(--bs-body-text-secondary);
    font-size: 0.9rem;
  }

  p,
  li {
    font-size: 0.95rem;
    line-height: 1.55;
  }

  ul {
    padding-left: 1.25rem;

    li {
      margin-bottom: 0.5rem;
    }
  }

  hr {
    border: none;
    border-top: 1px solid var(--bs-body-inactive);
    margin: 1.5rem 0;
  }
}
</style>
