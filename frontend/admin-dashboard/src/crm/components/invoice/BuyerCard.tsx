import React from "react";
import { UserRound } from "lucide-react";
import type { PartyDetails } from "./types";
import { displayOrDash } from "./utils";
import styles from "./taxInvoice.module.css";

function PartyBody({ party }: { party: PartyDetails }) {
  return (
    <div className={styles.cardBody}>
      <div className={styles.value} style={{ marginBottom: 4 }}>
        {displayOrDash(party.legal_name || party.name)}
      </div>
      {party.branch_name ? (
        <div className={styles.bodyText} style={{ marginBottom: 2 }}>
          {party.branch_name}
        </div>
      ) : null}
      <div className={styles.bodyText}>{displayOrDash(party.address)}</div>
      <div className={styles.bodyText} style={{ marginTop: 4 }}>
        GSTIN: {displayOrDash(party.gstin)} · PAN: {displayOrDash(party.pan)}
      </div>
      <div className={styles.bodyText}>
        State: {displayOrDash(party.state)}
        {party.state_code ? ` (${party.state_code})` : ""}
      </div>
    </div>
  );
}

export function BuyerCard({ party }: { party: PartyDetails }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <UserRound size={14} aria-hidden />
        Buyer Details
      </div>
      <PartyBody party={party} />
    </section>
  );
}

export function ShippingCard({ party }: { party: PartyDetails }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <UserRound size={14} aria-hidden />
        Shipping Details
      </div>
      <PartyBody party={party} />
    </section>
  );
}
