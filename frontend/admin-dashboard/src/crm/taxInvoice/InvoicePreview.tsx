import React from "react";
import { Building2, IdCard, Mail, MapPin } from "lucide-react";
import type { Invoice, Totals, SellerConstants } from "./types";
import { FIXED_SELLER } from "./types";
import { formatInr, lineAmount, lineDescription, num } from "./math";
import "./preview.css";

const LOGO = `${import.meta.env.BASE_URL}assets/karnex-logo-invoice.png`;
const SEAL = `${import.meta.env.BASE_URL}assets/karnex-seal-sign.png`;

type Props = {
  invoice: Invoice;
  totals: Totals;
  seller?: SellerConstants;
};

export function InvoicePreview({ invoice, totals, seller = FIXED_SELLER }: Props) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const pageRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  const [scaledHeight, setScaledHeight] = React.useState<number | null>(null);
  const items = invoice.items || [];
  const rows = [...items];
  while (rows.length < 5) {
    rows.push({ employee_name: "", sac: "", billing_hours: 0, rate_per_hour: 0 });
  }

  React.useLayoutEffect(() => {
    const updateScale = () => {
      const wrap = wrapRef.current;
      const page = pageRef.current;
      if (!wrap || !page) return;
      const availableWidth = wrap.clientWidth;
      const naturalWidth = page.offsetWidth;
      const naturalHeight = page.offsetHeight;
      if (!availableWidth || !naturalWidth || !naturalHeight) return;
      const nextScale = Math.min(1, availableWidth / naturalWidth);
      setScale(nextScale);
      setScaledHeight(naturalHeight * nextScale);
    };

    updateScale();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateScale())
        : null;
    if (wrapRef.current) ro?.observe(wrapRef.current);
    window.addEventListener("resize", updateScale, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [invoice, totals, seller]);

  return (
    <div className="kxTaxShell">
      <div ref={wrapRef} className="kxTaxPageWrap">
        <div className="kxTaxScaleFrame" style={scaledHeight ? { height: `${scaledHeight}px` } : undefined}>
          <div
            ref={pageRef}
            className="kxTaxPage"
            data-tax-invoice-preview
            style={{ transform: `scale(${scale})` }}
          >
          <div className="kxTaxHeader">
            <div className="kxTaxHeaderLeft">
              <img className="kxTaxLogo" src={LOGO} alt="Karnex" />
              <div className="kxTaxSellerName">{seller.name}</div>
              <div className="kxTaxIconLine">
                <MapPin size={11} aria-hidden />
                <span>{seller.address}</span>
              </div>
              <div className="kxTaxIconLine">
                <Building2 size={11} aria-hidden />
                <span>
                  State Name: {seller.state_name}{" "}
                  &nbsp; State Code: {seller.state_code}
                </span>
              </div>
              <div className="kxTaxIconLine">
                <Mail size={11} aria-hidden />
                <span>Email: {seller.email}</span>
              </div>
              <div className="kxTaxIconLine">
                <IdCard size={11} aria-hidden />
                <span>CIN No.: {seller.cin}</span>
              </div>
            </div>
            <div className="kxTaxHeaderRight">
              <div className="kxTaxTitle">TAX INVOICE</div>
              <div className="kxTaxMetaBody">
                <table className="kxTaxMetaTable">
                  <tbody>
                    <tr>
                      <td className="k">Invoice No.</td>
                      <td className="sep">:</td>
                      <td>{invoice.invoice_no}</td>
                    </tr>
                    <tr>
                      <td className="k">Invoice Date</td>
                      <td className="sep">:</td>
                      <td>{invoice.invoice_date}</td>
                    </tr>
                    <tr>
                      <td className="k">P.O. No.</td>
                      <td className="sep">:</td>
                      <td>{invoice.po_no || "—"}</td>
                    </tr>
                    <tr>
                      <td className="k">P.O. Date</td>
                      <td className="sep">:</td>
                      <td>{invoice.po_date || "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="kxTaxCards">
            <div className="kxTaxCard">
              <div className="kxTaxCardH">BUYER DETAILS</div>
              <div className="kxTaxCardB">
                <strong>{invoice.buyer.name || "—"}</strong>
                {"\n"}{invoice.buyer.address || "—"}
                {"\n"}
                <span className="muted">PAN:</span> {invoice.buyer.pan || "—"}{" "}
                <span className="muted">GSTIN:</span> {invoice.buyer.gstn || "—"}
                {"\n"}
                <span className="muted">State Code:</span> {invoice.buyer.state_code || "—"}{" "}
                <span className="muted">State Name:</span> {invoice.buyer.state_name || "—"}
                {"\n"}
                <span className="muted">Shipping:</span> {invoice.buyer.shipping || "—"}
                {"\n"}{invoice.buyer.shipping_address || ""}
              </div>
            </div>
            <div className="kxTaxCard">
              <div className="kxTaxCardH">SUPPLIER / BANK DETAILS</div>
              <div className="kxTaxCardB">
                <span className="muted">PAN No.:</span> {seller.pan}
                {"\n"}
                <span className="muted">GSTIN No.:</span> {seller.gstin}
                {"\n"}
                <span className="muted">Bank Name & Address:</span> {seller.bank_name}
                {"\n"}
                <span className="muted">Bank Account No.:</span> {seller.bank_acc}
                {"\n"}
                <span className="muted">IFSC Code:</span> {seller.ifsc}
              </div>
            </div>
          </div>

          <table className="kxTaxServices">
            <thead>
              <tr>
                <th style={{ width: "8%" }}>S. No.</th>
                <th style={{ width: "40%" }}>Description of Services</th>
                <th style={{ width: "12%" }}>SAC Code</th>
                <th style={{ width: "12%" }}>Billing Hours</th>
                <th style={{ width: "14%" }}>Rate/Hour (INR)</th>
                <th style={{ width: "14%" }}>Amount (INR)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it, i) => {
                const empty = i >= items.length;
                return (
                  <tr key={i}>
                    <td className="c">{empty ? "" : i + 1}</td>
                    <td>{empty ? "" : lineDescription(it.employee_name, it.service_month)}</td>
                    <td className="c">{empty ? "" : it.sac}</td>
                    <td className="r">
                      {empty ? "" : num(it.billing_hours).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="r">{empty ? "" : formatInr(num(it.rate_per_hour))}</td>
                    <td className="r">{empty ? "" : formatInr(lineAmount(it))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="kxTaxGstRow">
            <div className="kxTaxGstBox">
              <table>
                <tbody>
                  <tr><td>CGST @ 9%</td><td className="val">{formatInr(totals.cgst)}</td></tr>
                  <tr><td>SGST @ 9%</td><td className="val">{formatInr(totals.sgst)}</td></tr>
                  <tr><td>IGST @ 18%</td><td className="val">{formatInr(totals.igst)}</td></tr>
                  <tr><td>Total GST</td><td className="val">{formatInr(totals.total_gst)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="kxTaxGstBox">
              <table>
                <tbody>
                  <tr><td>Sub Total</td><td className="val">{formatInr(totals.subtotal)}</td></tr>
                  <tr><td>CGST @ 9%</td><td className="val">{formatInr(totals.cgst)}</td></tr>
                  <tr><td>SGST @ 9%</td><td className="val">{formatInr(totals.sgst)}</td></tr>
                  <tr><td>IGST @ 18%</td><td className="val">{formatInr(totals.igst)}</td></tr>
                  <tr><td>Total GST Tax</td><td className="val">{formatInr(totals.total_gst)}</td></tr>
                  <tr className="kxTaxGrand">
                    <td>GRAND TOTAL</td>
                    <td className="val">{formatInr(totals.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="kxTaxWords">
            <div>
              <strong>Amount Chargeable (in Words):</strong> {totals.amount_in_words}
            </div>
            <div style={{ marginTop: 3 }}>
              <strong>Tax Amount (in Words):</strong> {totals.tax_in_words}
            </div>
          </div>

          <div className="kxTaxFooter3">
            <div>
              <h4>BANK DETAILS</h4>
              Bank Name: {seller.bank_name_short}
              <br />
              Account No.: {seller.bank_acc}
              <br />
              IFSC Code: {seller.ifsc}
              <br />
              Branch: {seller.branch}
            </div>
            <div>
              <h4>Declaration</h4>
              {invoice.footer_text}
              <br />
              <br />
              <strong>For Karnex Software Solutions Pvt. Ltd.</strong>
              <br />
              <img className="kxTaxSeal" src={SEAL} alt="seal" />
              <div>Authorized Signatory</div>
            </div>
          </div>

          <div className="kxTaxContact">
            <span>{seller.contact_web}</span>·
            <span>{seller.contact_email}</span>·
            <span>{seller.contact_phone}</span>·
            <span>{seller.contact_loc}</span>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
